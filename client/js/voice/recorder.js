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
    this.silenceThreshold = 1500; // 1.5秒无语音视为说完
    this.onResult = null;       // (text, isFinal) => {}
    this.onStatusChange = null; // (status) => {}
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

      default:
        console.log('[VoiceRecorder] Unknown message:', msg.type);
    }
  }

  /**
   * 处理 ASR 识别结果
   */
  _handleASRResult(text, isFinal) {
    if (!text) return;

    // 重置静音计时器
    this._resetSilenceTimer();

    if (isFinal) {
      store.set('finalTranscript', text);
      this.onResult?.(text, true);
    } else {
      store.set('currentTranscript', text);
      this.onResult?.(text, false);
    }
  }

  /**
   * 静音检测计时器
   */
  _resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      // 静音超时，视为用户说完
      // 这里不需要额外处理，ASR 服务端会自动结束
    }, this.silenceThreshold);
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
