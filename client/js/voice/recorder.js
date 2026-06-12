/**
 * 麦克风采集 + WebSocket 通信
 * 负责音频采集、WebSocket 连接管理、ASR 结果接收
 */

import store from '../state/store.js';

class VoiceRecorder {
  constructor() {
    this.ws = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.scriptProcessor = null;
    this.reconnectTimer = null;
    this.isConnecting = false;
    this.silenceTimer = null;
    this.silenceThreshold = 1500;
    this.onResult = null;       // (text, isFinal) => {}
    this.onStatusChange = null; // (status) => {}

    // ---- 句子累积缓冲 ----
    // Paraformer 可能把一句长指令切成多个 sentence_end=true 片段。
    // 这里把连续片段在合并窗口内拼接，窗口到期后再作为最终命令执行。
    // 全程对 app.js 透明：累积期间发 isFinal=false，到期才发 isFinal=true。
    this._accumulatedText = '';
    this._mergeTimer = null;
    this._mergeWindowMs = 500; // 相邻句子片段之间的最大间隔（ms）
  }

  /**
   * 初始化 WebSocket 连接
   */
  connect(serverUrl = `ws://${window.location.hostname}:8765`) {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.ws = new WebSocket(serverUrl);

      this.ws.onopen = () => {
        console.log('[VoiceRecorder] WebSocket connected');
        this.isConnecting = false;
        store.set('isConnected', true);
        this.onStatusChange?.('connected');

        // 启动 ASR
        this._send({ type: 'start-asr' });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch (e) {
          console.error('[VoiceRecorder] Parse error:', e);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[VoiceRecorder] WebSocket closed:', event.code);
        this.isConnecting = false;
        store.set('isConnected', false);
        this.onStatusChange?.('disconnected');

        // 自动重连
        if (!event.wasClean) {
          this.reconnectTimer = setTimeout(() => this.connect(serverUrl), 3000);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[VoiceRecorder] WebSocket error');
        this.isConnecting = false;
        this.onStatusChange?.('error');
      };
    } catch (e) {
      this.isConnecting = false;
      console.error('[VoiceRecorder] Connect failed:', e);
      this.onStatusChange?.('error');
    }
  }

  /**
   * 开始录音
   */
  async startRecording() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 使用 ScriptProcessorNode 获取 PCM 数据
      // bufferSize 4096 在 16kHz 下约 256ms 一帧
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.scriptProcessor.onaudioprocess = (e) => {
        if (this.ws?.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Float32 → Int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // 转 base64 发送
        const base64 = this._arrayBufferToBase64(pcmData.buffer);
        this._send({ type: 'audio', data: base64 });
      };

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      store.set('isListening', true);
      this.onStatusChange?.('listening');
      console.log('[VoiceRecorder] Recording started');
    } catch (err) {
      console.error('[VoiceRecorder] Failed to start recording:', err);
      this.onStatusChange?.('mic-error');
      throw err;
    }
  }

  /**
   * 停止录音
   */
  stopRecording() {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    // 通知后端停止 ASR
    this._send({ type: 'stop-asr' });

    // 清理句子累积缓冲，避免停录后残留内容被误执行
    this._accumulatedText = '';
    if (this._mergeTimer) {
      clearTimeout(this._mergeTimer);
      this._mergeTimer = null;
    }

    store.set('isListening', false);
    this.onStatusChange?.('stopped');
    console.log('[VoiceRecorder] Recording stopped');
  }

  /**
   * 处理后端消息
   */
  _handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        console.log('[VoiceRecorder] Server acknowledged connection');
        break;

      case 'asr-ready':
        console.log('[VoiceRecorder] ASR ready');
        this.onStatusChange?.('asr-ready');
        break;

      case 'asr-result':
        this._handleASRResult(msg.text, msg.isFinal);
        break;

      case 'asr-complete':
        console.log('[VoiceRecorder] ASR session complete');
        break;

      case 'asr-error':
        console.error('[VoiceRecorder] ASR error:', msg.error);
        this.onStatusChange?.('asr-error');
        break;

      case 'pong':
        break;

      case 'llm-result':
        this.onLLMResult?.(msg.data);
        break;

      case 'llm-error':
        this.onLLMError?.(msg.error);
        break;

      default:
        console.log('[VoiceRecorder] Unknown message:', msg.type);
    }
  }

  /**
   * 处理 ASR 识别结果（含句子累积逻辑）
   *
   * Paraformer 有时会把一句长指令切成多个 sentence_end=true 片段。
   * 处理策略：
   *   - isFinal=false（中间结果）：拼上已累积前缀后发 false，供实时预览使用
   *   - isFinal=true（句子结束）：追加到累积缓冲，重置合并窗口计时器，
   *     发 false 继续更新预览；窗口到期后才发 true 触发命令执行
   */
  _handleASRResult(text, isFinal) {
    if (!text) return;

    const trimmed = text.trim();
    if (trimmed.length < 2) return;
    if (/^[\s\p{P}]+$/u.test(trimmed)) return;

    this._resetSilenceTimer();

    if (!isFinal) {
      // 中间结果：拼上累积前缀，仅用于实时预览
      const display = this._accumulatedText ? this._accumulatedText + trimmed : trimmed;
      store.set('currentTranscript', display);
      this.onResult?.(display, false);
    } else {
      // Paraformer 判定句子结束：去掉尾部标点后追加到缓冲
      const clean = trimmed.replace(/[，。！？、,.!?\s]+$/, '');
      if (!clean) return;

      this._accumulatedText = this._accumulatedText ? this._accumulatedText + clean : clean;

      // 以完整累积内容更新预览（仍为 false，不触发命令执行）
      store.set('currentTranscript', this._accumulatedText);
      this.onResult?.(this._accumulatedText, false);

      // 重置合并窗口：窗口内如果又来了新片段会再次延迟
      this._resetMergeTimer();
    }
  }

  /**
   * 重置句子合并窗口计时器
   */
  _resetMergeTimer() {
    if (this._mergeTimer) clearTimeout(this._mergeTimer);
    this._mergeTimer = setTimeout(() => this._fireMergedCommand(), this._mergeWindowMs);
  }

  /**
   * 合并窗口到期：将累积文本作为最终命令发出
   */
  _fireMergedCommand() {
    const text = this._accumulatedText;
    this._accumulatedText = '';
    this._mergeTimer = null;
    if (!text) return;

    store.set('finalTranscript', text);
    this.onResult?.(text, true);
  }

  /**
   * 静音检测计时器（保留原有接口，Paraformer 侧已处理静音）
   */
  _resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {}, this.silenceThreshold);
  }

  /**
   * 发送 WebSocket 消息
   */
  _send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * ArrayBuffer 转 Base64
   */
  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * 发送 LLM 绘图请求到后端
   * @param {string} prompt - 用户语音指令原文
   */
  sendLLMDraw(prompt) {
    this._send({ type: 'llm-draw', prompt });
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.stopRecording();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    store.set('isConnected', false);
    store.set('isListening', false);
  }
}

export default new VoiceRecorder();
