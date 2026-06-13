/**
 * VoiceDraw 主入口
 * 集成所有模块，管理指令执行流程
 */

import store from './state/store.js';
import Renderer from './canvas/renderer.js';
import { createShape, COLOR_MAP, SHAPE_NAMES, colorToName, getShapeBounds, getShapeEdgePoint } from './canvas/shapes.js';
import { parseCommand, detectKeywords, hasComplexSignal } from './parser/keyword.js';
import { positionToCoords } from './canvas/grid.js';
import contextManager from './parser/context.js';
import voiceRecorder from './voice/recorder.js';
import voiceSynth from './voice/synthesizer.js';
import { WaveformVisualizer } from './ui/waveform.js';
import { TaskListUI } from './ui/tasklist.js';
import Toast from './ui/toast.js';
import { renderBarChart, renderLineChart, renderPieChart } from './canvas/charts.js';
import { renderFlowchart, renderMindmap } from './canvas/flowchart.js';

class VoiceDrawApp {
  constructor() {
    this.renderer = null;
    this.waveform = null;
    this.taskList = null;
    this.toast = null;
    this.isProcessing = false;
    this.previewTimeout = null;

    // ── LLM 描述模式状态机 ──────────────────────────────────────
    // 当用户说出 LLM 图形意图后，进入"描述模式"：
    //   每句 isFinal 结果追加到缓冲，说"完成"时一次性发给 LLM 生成。
    // 与 recorder.js 的"句子合并缓冲"层不同：那个缓冲在帧级别透明，
    // 这个缓冲在指令级别，跨越多轮 isFinal。
    this._llmSessionActive = false;   // 是否在描述模式
    this._llmSessionBuffer = [];      // 已收集的句子片段
    this._llmSessionId = null;        // 本轮会话 ID（传给后端保持历史）
    this._llmParseActive = false;     // 防止并发兜底解析请求导致回调覆盖
  }

  /**
   * 初始化应用
   */
  async init() {
    console.log('[VoiceDraw] Initializing...');

    // 关闭 TTS 播报，避免 Demo 时扬声器声音被 ASR 误识别
    voiceSynth.setEnabled(false);

    // 初始化 UI 组件
    this.renderer = new Renderer(document.getElementById('mainCanvas'));
    this.waveform = new WaveformVisualizer(document.getElementById('waveformCanvas'));
    this.taskList = new TaskListUI(document.getElementById('taskList'));
    this.toast = new Toast(document.getElementById('toastContainer'));

    // 设置波形尺寸
    const waveContainer = document.getElementById('waveformContainer');
    if (waveContainer) {
      this.waveform.resize(waveContainer.clientWidth, waveContainer.clientHeight);
    }

    // 连接语音服务
    this._initVoice();

    // 更新状态 UI
    this._initStatusUI();

    console.log('[VoiceDraw] Ready');
  }

  /**
   * 初始化语音服务
   */
  _initVoice() {
    // 设置回调
    voiceRecorder.onResult = (text, isFinal) => this._onASRResult(text, isFinal);
    voiceRecorder.onStatusChange = (status) => this._onVoiceStatusChange(status);

    // 连接 WebSocket
    voiceRecorder.connect();

    // 连接后自动开始录音
    voiceRecorder.onStatusChange = (status) => {
      this._onVoiceStatusChange(status);
      if (status === 'asr-ready') {
        this._startRecording();
      }
    };
  }

  /**
   * 开始录音（带音频分析器）
   */
  async _startRecording() {
    try {
      await voiceRecorder.startRecording();

      // 创建音频分析器（用于波形可视化）
      const stream = voiceRecorder.mediaStream;
      if (stream) {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        this.waveform.connectAnalyser(analyser);
      }

      this.toast.success('麦克风已开启，请开始说话', 2000);
    } catch (err) {
      this.toast.error('无法访问麦克风，请检查权限设置');
      console.error('[VoiceDraw] Mic error:', err);
    }
  }

  /**
   * 处理 ASR 识别结果
   */
  _onASRResult(text, isFinal) {
    if (!text || !text.trim()) return;

    // 更新实时文本显示
    const transcriptEl = document.getElementById('transcript');
    if (transcriptEl) {
      transcriptEl.textContent = text;
      transcriptEl.classList.toggle('final', isFinal);
    }

    if (!isFinal) {
      // 描述模式下：仅更新实时文字反馈，不触发预渲染
      if (this._llmSessionActive) {
        const preview = this._llmSessionBuffer.join('，');
        const transcriptEl = document.getElementById('transcript');
        if (transcriptEl) transcriptEl.textContent = `🎤 ${preview}${preview ? '，' : ''}${text}...`;
        return;
      }

      // 实时关键词检测 → 触发预渲染
      const keywords = detectKeywords(text);
      store.set('detectedKeywords', keywords);

      // 必须有绘制意图词（画/绘制/创建…）才触发预览，避免"移动三角形"等误触发
      const hasAnyKeyword = keywords.shape || keywords.color || keywords.position || keywords.size;

      if (keywords.hasDrawIntent && hasAnyKeyword && !store.state.preview) {
        // 首次检测到关键词且有绘制意图，生成预览
        this._generatePreview(keywords);
      } else if (store.state.preview && hasAnyKeyword) {
        // 已有预览（说明绘制意图已确认），继续更新参数
        this._updatePreview(keywords);
      }

      return;
    }

    // 描述模式：最终结果追加到缓冲，不走普通指令解析
    if (this._llmSessionActive) {
      this._handleSessionInput(text);
      return;
    }

    // 最终结果 → 解析并执行指令
    this._processCommand(text);
  }

  /**
   * 中文形状名 → 图形类型 ID
   */
  _getShapeType(shapeName) {
    const map = {
      '圆形': 'circle', '方形': 'rect', '矩形': 'rect', '方块': 'rect',
      '直线': 'line', '三角形': 'triangle',
      '星形': 'star', '椭圆': 'ellipse', '椭圆形': 'ellipse',
      '菱形': 'diamond', '圆角矩形': 'rounded-rect',
      '箭头线': 'arrow-line', '箭头': 'arrow-line',
    };
    return map[shapeName] || 'circle';
  }

  /**
   * 解析箭头线起止点（编号 / 方位 / 朝向 / 默认水平）
   */
  _buildArrowLineEndpoints(command, W, H) {
    const len = 200;

    if (command.fromId != null && command.toId != null) {
      const obj1 = store.getObjectByNumber(command.fromId);
      const obj2 = store.getObjectByNumber(command.toId);
      if (!obj1) { this.toast.warning(`未找到 ${command.fromId} 号对象`); return null; }
      if (!obj2) { this.toast.warning(`未找到 ${command.toId} 号对象`); return null; }
      const p1 = getShapeEdgePoint(obj1, obj2.x, obj2.y);
      const p2 = getShapeEdgePoint(obj2, obj1.x, obj1.y);
      return { x: p1.x, y: p1.y, x2: p2.x, y2: p2.y, _fromId: obj1.id, _toId: obj2.id };
    }

    const resolvePoint = (id, pos, fallbackX, fallbackY) => {
      if (id != null) {
        const obj = store.getObjectByNumber(id);
        if (!obj) { this.toast.warning(`未找到 ${id} 号对象`); return null; }
        return { x: obj.x, y: obj.y, obj };
      }
      if (pos) {
        const c = positionToCoords(pos, W, H);
        return { x: c.x, y: c.y, obj: null };
      }
      if (fallbackX != null && fallbackY != null) {
        return { x: fallbackX, y: fallbackY, obj: null };
      }
      return null;
    };

    const from = resolvePoint(command.fromId, command.fromPosition, W * 0.35, H / 2);
    if (!from) return null;
    const to = resolvePoint(command.toId, command.toPosition, null, null);

    if (to) {
      let x1 = from.x;
      let y1 = from.y;
      let x2 = to.x;
      let y2 = to.y;
      if (from.obj) {
        const p1 = getShapeEdgePoint(from.obj, x2, y2);
        x1 = p1.x; y1 = p1.y;
      }
      if (to.obj) {
        const p2 = getShapeEdgePoint(to.obj, x1, y1);
        x2 = p2.x; y2 = p2.y;
      }
      const opts = { x: x1, y: y1, x2, y2 };
      if (from.obj) opts._fromId = from.obj.id;
      if (to.obj) opts._toId = to.obj.id;
      return opts;
    }

    const dir = command.direction || { dx: 1, dy: 0 };
    let x1 = from.x;
    let y1 = from.y;
    let x2 = from.x + dir.dx * len;
    let y2 = from.y + dir.dy * len;

    if (command.position && command.fromId == null && command.fromPosition == null) {
      const c = positionToCoords(command.position, W, H);
      x1 = c.x; y1 = c.y;
      x2 = c.x + dir.dx * len;
      y2 = c.y + dir.dy * len;
    }

    if (from.obj) {
      const p1 = getShapeEdgePoint(from.obj, x2, y2);
      x1 = p1.x; y1 = p1.y;
      return { x: x1, y: y1, x2, y2, _fromId: from.obj.id };
    }

    return { x: x1, y: y1, x2, y2 };
  }

  /**
   * 生成预览对象（三阶段：定位圆 → 彩色圆 → 实体形状）
   *
   * _stage=1：仅位置/无信息 → 红色虚线圆（定位指示器）
   * _stage=2：颜色已知但形状未确认 → 彩色虚线圆
   * _stage=3：形状已确认 → 实线实体形状
   */
  _generatePreview(keywords) {
    const { canvasWidth: W, canvasHeight: H } = store.state;

    // 阶段1只显示圆形定位器，只有检测到形状才切换
    const shapeType = keywords.shape ? this._getShapeType(keywords.shape) : 'circle';

    let x = W / 2, y = H / 2;
    if (keywords.position) {
      const coords = positionToCoords(keywords.position, W, H);
      x = coords.x;
      y = coords.y;
    }

    let sizeModifier = {};
    if (keywords.size === 'large') {
      sizeModifier = { radius: 80, width: 160, height: 120, size: 90, rx: 120, ry: 75 };
    } else if (keywords.size === 'small') {
      sizeModifier = { radius: 30, width: 60, height: 50, size: 35, rx: 50, ry: 30 };
    }

    // 计算阶段
    let stage = 1;
    if (keywords.shape) stage = 3;
    else if (keywords.color) stage = 2;

    const preview = createShape(shapeType, {
      x, y,
      ...(shapeType === 'arrow-line' ? { x2: x + 200, y2: y } : {}),
      color: keywords.color || '#FF4444',
      ...sizeModifier,
    });
    preview._stage = stage;
    preview._sizeTag = keywords.size || null;

    store.setPreview(preview);
    this._resetPreviewTimeout();
  }

  /**
   * 更新预览参数，随关键词逐步推进阶段
   */
  _updatePreview(keywords) {
    const preview = store.state.preview;
    if (!preview) return;

    // 形状变化 → 重建预览并提升为阶段3
    if (keywords.shape) {
      const newShapeType = this._getShapeType(keywords.shape);
      if (newShapeType !== preview.type) {
        const { x, y } = preview;
        let sizeModifier = {};
        if (keywords.size === 'large' || preview._sizeTag === 'large') {
          sizeModifier = { radius: 80, width: 160, height: 120, size: 90, rx: 120, ry: 75 };
        } else if (keywords.size === 'small' || preview._sizeTag === 'small') {
          sizeModifier = { radius: 30, width: 60, height: 50, size: 35, rx: 50, ry: 30 };
        }
        const newPreview = createShape(newShapeType, {
          x, y,
          ...(newShapeType === 'arrow-line' ? { x2: x + 200, y2: y } : {}),
          color: keywords.color || preview.color,
          ...sizeModifier,
        });
        newPreview._sizeTag = keywords.size || preview._sizeTag;
        newPreview._stage = 3;
        store.setPreview(newPreview);
        this._resetPreviewTimeout();
        return;
      }
    }

    const updates = {};

    if (keywords.color && keywords.color !== preview.color) {
      updates.color = keywords.color;
    }

    if (keywords.position) {
      const { canvasWidth: W, canvasHeight: H } = store.state;
      const coords = positionToCoords(keywords.position, W, H);
      updates.x = coords.x;
      updates.y = coords.y;
    }

    if (keywords.size && keywords.size !== preview._sizeTag) {
      if (keywords.size === 'large') {
        Object.assign(updates, { radius: 80, width: 160, height: 120, size: 90, rx: 120, ry: 75 });
      } else if (keywords.size === 'small') {
        Object.assign(updates, { radius: 30, width: 60, height: 50, size: 35, rx: 50, ry: 30 });
      }
      updates._sizeTag = keywords.size;
    }

    // 阶段升级（只升不降）
    const curStage = preview._stage || 1;
    let newStage = curStage;
    if (keywords.shape) newStage = 3;
    else if (keywords.color && curStage < 2) newStage = 2;
    if (newStage !== curStage) updates._stage = newStage;

    if (Object.keys(updates).length > 0) {
      store.setPreview({ ...preview, ...updates });
    }

    this._resetPreviewTimeout();
  }

  /**
   * 重置预览超时
   */
  _resetPreviewTimeout() {
    if (this.previewTimeout) clearTimeout(this.previewTimeout);
    // 超时只取消预览（防止卡死），不自动确认。
    // 确认动作由 ASR isFinal 触发的 _execDraw 负责。
    // 超时设为 3000ms > ASR静音(1500ms)+前端合并(500ms)+网络延迟，
    // 保证正常流程中 isFinal 先到达并清除此计时器。
    this.previewTimeout = setTimeout(() => {
      if (store.state.preview) {
        store.cancelPreview();
      }
    }, 3000);
  }

  /**
   * 处理最终指令
   * 三层路由策略：
   *   Layer 1 (规则快路径)：单动作高频指令，<50ms 响应
   *   Layer 2 (LLM 结构解析)：检测到复杂信号时主动路由，不等规则误判
   *   Layer 3 (LLM 图形生成)：parseLLMIntent 触发，已在 parseCommand 内处理
   */
  _processCommand(text) {
    if (this.previewTimeout) clearTimeout(this.previewTimeout);

    // Layer 2：主动复杂信号检测
    // 当句子结构上就属于多动作复合指令时，直接交给 LLM 解析，
    // 而不是等规则"误判成功"返回一个错误的单条指令。
    if (hasComplexSignal(text)) {
      console.log('[VoiceDraw] Complex signal detected, routing to LLM:', text);
      store.cancelPreview();
      this._llmFallbackParse(text);
      return;
    }

    // Layer 1：规则快路径
    const command = parseCommand(text);

    if (!command || command.type === 'unknown') {
      // 规则无法识别 → LLM 兜底
      store.cancelPreview();
      this._llmFallbackParse(text);
      return;
    }

    this._executeCommand(command, text);
  }

  /**
   * LLM 兜底指令解析
   * 规则引擎返回 unknown 时调用，让 LLM 用语义理解来识别意图。
   * - 先显示"正在理解..."提示，避免用户以为系统没响应
   * - LLM 成功：转换为内部 command 对象并执行
   * - LLM 失败/返回 unknown：降级为普通"没有理解"提示
   */
  _llmFallbackParse(text) {
    // 若已有一个兜底解析请求在飞，直接丢弃新请求，防止回调覆盖导致指令串台
    if (this._llmParseActive) return;
    this._llmParseActive = true;

    this.toast.show('🤔 正在理解指令...', 'info', 8000);

    voiceRecorder.onLLMParseResult = (data) => {
      this._llmParseActive = false;
      voiceRecorder.onLLMParseResult = null;
      voiceRecorder.onLLMParseError = null;

      const command = this._llmResultToCommand(data);
      if (command) {
        console.log('[VoiceDraw] LLM fallback succeeded:', command);
        this._executeCommand(command, text);
      } else {
        const clarification = contextManager.generateClarification(text);
        voiceSynth.speak(clarification);
        this.toast.warning(clarification, 4000);
      }
    };

    voiceRecorder.onLLMParseError = (err) => {
      this._llmParseActive = false;
      voiceRecorder.onLLMParseResult = null;
      voiceRecorder.onLLMParseError = null;
      console.warn('[VoiceDraw] LLM fallback error:', err);
      const clarification = contextManager.generateClarification(text);
      voiceSynth.speak(clarification);
      this.toast.warning(clarification, 4000);
    };

    voiceRecorder.sendLLMParse(text);
  }

  /**
   * 将 LLM 兜底解析结果转换为内部 command 对象
   * LLM 输出的 JSON 字段名与前端内部结构略有差异（targetId vs target），
   * 此方法做适配映射。
   * @param {object} r - LLM 返回的 JSON
   * @returns {object|null} 内部 command，或 null（无法识别时）
   */
  _llmResultToCommand(r) {
    if (!r || r.type === 'unknown') return null;

    const target = (r.targetId != null) ? { type: 'id', value: r.targetId } : null;

    switch (r.type) {
      case 'draw':
        return {
          type: 'draw',
          shape: r.shape || 'circle',
          color: r.color || null,
          position: r.position || null,     // { dx, dy } — 与 positionToCoords 兼容
        };
      case 'color':
        if (!r.color) return null;
        return { type: 'color', color: r.color, target };
      case 'move':
        if (r.dx == null && r.dy == null) return null;
        return { type: 'move', dx: r.dx ?? 0, dy: r.dy ?? 0, distance: r.distance || 30, target };
      case 'moveTo':
        if (!r.position) return null;
        return { type: 'moveTo', position: r.position, target };
      case 'resize':
        if (r.factor == null) return null;
        return { type: 'resize', factor: r.factor, target };
      case 'delete':
        return { type: 'delete', target };
      case 'select':
        if (!target) return null;
        return { type: 'select', target };
      case 'connect':
        if (r.fromId == null || r.toId == null) return null;
        return { type: 'connect', fromId: r.fromId, toId: r.toId };
      case 'addText':
        if (!r.content) return null;
        return {
          type: 'addText',
          content: r.content,
          refId: r.refId ?? null,
          side: r.side ?? null,
        };
      case 'shapeChange':
        if (!r.shape) return null;
        return { type: 'shapeChange', shape: r.shape, color: r.color || null, target };
      case 'compound': {
        // LLM 返回复合指令：将 tasks 数组里的每个子项递归转换
        if (!Array.isArray(r.tasks) || r.tasks.length < 2) return null;
        const tasks = r.tasks.map((t) => this._llmResultToCommand(t)).filter(Boolean);
        if (tasks.length < 2) return null;
        return { type: 'compound', tasks, skipped: [] };
      }
      case 'undo':
      case 'redo':
      case 'clear':
        return { type: r.type };
      default:
        return null;
    }
  }

  /**
   * 执行指令（核心方法）
   * @param {boolean} _isSubTask - true 时跳过 isProcessing 守卫（供复合指令内部调用）
   */
  async _executeCommand(command, originalText, _isSubTask = false) {
    if (!_isSubTask && this.isProcessing && command.type !== 'cancel') return;

    let result = null;
    let feedback = '';

    switch (command.type) {
      case 'draw':
        result = this._execDraw(command);
        break;

      case 'select':
        result = this._execSelect(command);
        break;

      case 'delete':
        result = this._execDelete(command);
        break;

      case 'connect':
        result = this._execConnect(command);
        break;

      case 'addText':
        result = this._execAddText(command);
        break;

      case 'modifyText':
        result = this._execModifyText(command);
        break;

      case 'color':
        result = this._execColor(command);
        break;

      case 'shapeChange':
        result = this._execShapeChange(command);
        break;

      case 'resize':
        result = this._execResize(command);
        break;

      case 'move':
        result = this._execMove(command);
        break;

      case 'moveTo':
        result = this._execMoveTo(command);
        break;

      case 'confirm':
        result = this._execConfirm();
        break;

      case 'cancel':
        result = this._execCancel();
        break;

      case 'undo':
        result = store.undo();
        feedback = result ? '已撤销' : '没有可撤销的操作';
        break;

      case 'redo':
        result = store.redo();
        feedback = result ? '已重做' : '没有可重做的操作';
        break;

      case 'clear':
        store.clearCanvas();
        feedback = '画布已清除';
        break;

      case 'help':
        this._execHelp();
        return;

      case 'closeHelp':
        this._execCloseHelp();
        return;

      case 'compound':
        await this._execCompound(command);
        return;

      case 'batch-draw':
        result = this._execBatchDraw(command);
        break;

      case 'batch-color':
        result = this._execBatchColor(command);
        break;

      case 'refine':
        result = this._execRefine(command);
        break;

      case 'llm-draw':
        // LLM 绘图是异步流程，回调中处理，这里直接返回避免后续同步逻辑干扰
        this._execLLMDraw(command);
        return;

      case 'unknown':
        store.cancelPreview();
        feedback = contextManager.generateClarification(command.text || originalText);
        voiceSynth.speak(feedback);
        this.toast.warning(feedback, 4000);
        return;

      default:
        feedback = '未知指令';
    }

    // 生成反馈
    if (!feedback && result) {
      feedback = contextManager.generateFeedback(command, result);
    }

    // 并行反馈：视觉已通过 Canvas 自动更新，语音异步播报
    if (feedback) {
      voiceSynth.speak(feedback);
      this.toast.success(feedback, 2000);
    }

    // 记录上下文
    if (command.type !== 'unknown' && command.type !== 'help') {
      contextManager.recordInteraction(originalText, command, result);
      if (['draw', 'color', 'resize', 'move', 'refine'].includes(command.type)) {
        contextManager.setActionContext(command);
      }
    }

    // 每次操作完成后清除预览和关键词提示
    if (this.previewTimeout) clearTimeout(this.previewTimeout);
    store.cancelPreview();
    store.set('detectedKeywords', { color: null, shape: null, size: null, position: null });
  }

  // ========== 指令执行方法 ==========

  _execDraw(command) {
    const { canvasWidth: W, canvasHeight: H } = store.state;

    const sizeTag = command.sizeModifier || (store.state.preview && store.state.preview._sizeTag);
    const sizeOverrides = {};
    if (sizeTag === 'large') {
      Object.assign(sizeOverrides, { radius: 80, width: 160, height: 120, size: 90, rx: 120, ry: 75 });
    } else if (sizeTag === 'small') {
      Object.assign(sizeOverrides, { radius: 30, width: 60, height: 50, size: 35, rx: 50, ry: 30 });
    }

    // 箭头线：单独解析起止点
    if (command.shape === 'arrow-line') {
      const endpoints = this._buildArrowLineEndpoints(command, W, H);
      if (!endpoints) return null;

      const shape = createShape('arrow-line', {
        color: command.color || '#45B7D1',
        lineWidth: 3,
        ...endpoints,
      });
      if (store.state.preview) store.cancelPreview();
      return store.addObject(shape);
    }

    if (store.state.preview) {
      const preview = store.state.preview;

      // 计算最终位置（命令优先，其次沿用预览位置）
      let finalX = preview.x;
      let finalY = preview.y;
      if (command.relativeToId) {
        const refObj = store.getObjectByNumber(command.relativeToId);
        if (refObj) {
          const pos = this._sideCoords(refObj, command.relativeSide);
          finalX = pos.x; finalY = pos.y;
        }
      } else if (command.position) {
        const coords = positionToCoords(command.position, W, H);
        finalX = coords.x;
        finalY = coords.y;
      }

      // 用最终命令属性（形状/颜色/尺寸/位置）重建预览再确认
      const finalPreview = createShape(command.shape, {
        x: finalX,
        y: finalY,
        color: command.color || preview.color || '#FF6B6B',
        ...sizeOverrides,
      });
      store.setPreview(finalPreview);
      return store.confirmPreview();
    }

    // 无预览 → 直接绘制
    let x = W / 2, y = H / 2;
    if (command.relativeToId) {
      const refObj = store.getObjectByNumber(command.relativeToId);
      if (refObj) {
        const pos = this._sideCoords(refObj, command.relativeSide);
        x = pos.x; y = pos.y;
      }
    } else if (command.position) {
      const coords = positionToCoords(command.position, W, H);
      x = coords.x;
      y = coords.y;
    }

    const shape = createShape(command.shape, {
      x, y,
      color: command.color || '#FF6B6B',
      ...sizeOverrides,
    });

    return store.addObject(shape);
  }

  _execSelect(command) {
    const num = command.target?.value;
    if (num == null) {
      const msg = '请说「选中3号」指定对象编号';
      voiceSynth.speak(msg);
      this.toast.warning(msg);
      return null;
    }

    const obj = store.getObjectByNumber(num);

    if (obj) {
      store.selectObject(obj.id);
      return obj;
    }

    const msg = `未找到 ${num} 号对象，请说「选中3号」指定编号`;
    voiceSynth.speak(msg);
    this.toast.warning(msg);
    return null;
  }

  _execDelete(command) {
    let obj = null;
    if (command.target && command.target.type === 'id') {
      obj = store.getObjectByNumber(command.target.value);
      if (!obj) {
        const msg = `没有找到 ${command.target.value} 号对象`;
        voiceSynth.speak(msg);
        this.toast.warning(msg);
        return null;
      }
    } else {
      obj = store.getSelected();
      if (!obj) {
        voiceSynth.speak('请先选中一个对象');
        this.toast.warning('请先选中一个对象');
        return null;
      }
    }
    store.removeObject(obj.id);
    return obj;
  }

  _execColor(command) {
    const obj = this._resolveTarget(command);
    if (!obj) return null;
    store.updateObject(obj.id, { color: command.color });
    return obj;
  }

  _execResize(command) {
    const obj = this._resolveTarget(command);
    if (!obj) return null;

    const updates = {};
    if (obj.radius) updates.radius = Math.max(10, obj.radius * command.factor);
    if (obj.width) updates.width = Math.max(10, obj.width * command.factor);
    if (obj.height) updates.height = Math.max(10, obj.height * command.factor);
    if (obj.size) updates.size = Math.max(10, obj.size * command.factor);
    if (obj.rx) updates.rx = Math.max(10, obj.rx * command.factor);
    if (obj.ry) updates.ry = Math.max(10, obj.ry * command.factor);

    store.updateObject(obj.id, updates);
    return obj;
  }

  _execShapeChange(command) {
    const obj = this._resolveTarget(command);
    if (!obj) return null;

    // 形状变更：重建对象，保留位置；颜色优先用指令指定，否则沿用旧色
    const newObj = createShape(command.shape, {
      x: obj.x,
      y: obj.y,
      color: command.color || obj.color,
    });
    newObj.id = obj.id;
    store.replaceObject(obj.id, newObj);
    return newObj;
  }

  _execMove(command) {
    const obj = this._resolveTarget(command);
    if (!obj) return null;

    if (command.dx !== undefined) {
      const dist = command.distance || 30;
      const dx = command.dx * dist;
      const dy = command.dy * dist;
      store.updateObject(obj.id, { x: obj.x + dx, y: obj.y + dy });
      this._syncConnected(obj.id, dx, dy);
    }

    return obj;
  }

  _execMoveTo(command) {
    const obj = this._resolveTarget(command);
    if (!obj) return null;

    const { canvasWidth: W, canvasHeight: H } = store.state;
    const coords = positionToCoords(command.position, W, H);
    const dx = coords.x - obj.x;
    const dy = coords.y - obj.y;
    store.updateObject(obj.id, { x: coords.x, y: coords.y });
    this._syncConnected(obj.id, dx, dy);
    return obj;
  }

  _execConfirm() {
    const obj = store.confirmPreview();
    if (obj) {
      return obj;
    }
    return null;
  }

  _execCancel() {
    store.cancelPreview();
    voiceSynth.speak('已取消');
    this.toast.info('已取消');
    return true;
  }

  _execHelp() {
    this._showHelpPanel();
  }

  _execCloseHelp() {
    const panel = document.getElementById('helpPanel');
    if (panel?.classList.contains('visible')) {
      panel.classList.remove('visible');
      this.toast.info('已关闭帮助');
    } else {
      this.toast.info('帮助面板未打开');
    }
    return true;
  }

  async _execCompound(command) {
    this.isProcessing = true;

    // 如果有跳过的子句，先给一次提示（不影响后续执行）
    if (command.skipped && command.skipped.length > 0) {
      const skippedHint = `跳过无法识别的步骤：${command.skipped.slice(0, 2).join('、')}`;
      this.toast.warning(skippedHint, 3000);
    }

    // 显示任务列表
    const tasks = command.tasks.map((t) => ({
      text: this._commandToDescription(t),
      command: t,
    }));
    this.taskList.show(tasks);

    // 逐个执行（传 _isSubTask=true 绕过 isProcessing 守卫）
    for (let i = 0; i < command.tasks.length; i++) {
      const subCommand = command.tasks[i];
      await this._executeCommand(subCommand, '', true);
      this.taskList.completeCurrent();

      // 短暂延迟，让用户看到进度
      await new Promise((r) => setTimeout(r, 300));
    }

    this.isProcessing = false;
    voiceSynth.speak('所有任务已完成');
    this.toast.success('所有任务已完成');

    setTimeout(() => this.taskList.hide(), 2000);
  }

  /**
   * 批量绘制图形（"画三个圆"）
   * 自动横向均匀排布，避免图形重叠。
   */
  _execBatchDraw(command) {
    const { canvasWidth: W, canvasHeight: H } = store.state;
    const n = command.count;
    const color = command.color || '#FF6B6B';

    // 横向均匀排布：将画布宽度等分为 n+1 份，取中间 n 个间隔位置
    const y = H / 2;
    const step = W / (n + 1);

    const added = [];
    for (let i = 0; i < n; i++) {
      const x = step * (i + 1);
      const shape = createShape(command.shape, { x, y, color });
      added.push(store.addObject(shape));
    }

    const lastName = added[added.length - 1];
    return lastName; // 返回最后一个，供 feedback 使用
  }

  /**
   * 批量改色（"把所有圆改成蓝色" / "全部改成红色"）
   * filterShape 有值时只改该类型，否则改全部可交互对象。
   */
  _execBatchColor(command) {
    const targets = store.state.objects.filter((o) => {
      if (o._system) return false;                              // 跳过系统装饰元素
      if (command.filterShape && o.type !== command.filterShape) return false;
      return true;
    });

    if (targets.length === 0) {
      const hint = command.filterShape ? `画布上没有${command.filterShape}` : '画布上没有可修改的对象';
      this.toast.warning(hint);
      return null;
    }

    // 用 pushHistory 一次，之后静默更新，保证整批是一个撤销步骤
    store.pushHistory();
    for (const obj of targets) {
      store.updateObjectNoHistory(obj.id, { color: command.color });
    }

    return { count: targets.length, color: command.color };
  }

  _execRefine(command) {
    const lastAction = store.state.lastAction;
    if (!lastAction) return null;

    // 根据上一步操作类型执行微调
    switch (lastAction.type) {
      case 'move':
        return this._execMove({
          type: 'move',
          dx: command.dx || lastAction.dx || 0,
          dy: command.dy || lastAction.dy || 0,
          distance: command.distance || 15,
        });

      case 'resize':
        return this._execResize({
          type: 'resize',
          factor: command.factor || (lastAction.factor > 1 ? 1.1 : 0.9),
        });

      case 'color':
        // 颜色微调暂不支持
        voiceSynth.speak('颜色微调暂不支持');
        return null;

      default:
        return null;
    }
  }

  // ========== 连线 / 文字标注 ==========

  /**
   * 把两个已有图形用直线连接
   * "用线连接1号和3号" / "把2号连到4号"
   * 连线端点停在形状边缘（不穿入中心），并记录 _fromId/_toId，
   * 以便形状移动时自动更新连线位置。
   */
  _execConnect(command) {
    const obj1 = store.getObjectByNumber(command.fromId);
    const obj2 = store.getObjectByNumber(command.toId);
    if (!obj1) { this.toast.warning(`未找到 ${command.fromId} 号对象`); return null; }
    if (!obj2) { this.toast.warning(`未找到 ${command.toId} 号对象`); return null; }

    const p1 = getShapeEdgePoint(obj1, obj2.x, obj2.y);
    const p2 = getShapeEdgePoint(obj2, obj1.x, obj1.y);

    const line = createShape('line', {
      x: p1.x, y: p1.y,
      x2: p2.x, y2: p2.y,
      color: '#666666',
      lineWidth: 2,
      _fromId: obj1.id,
      _toId: obj2.id,
    });
    return store.addObject(line);
  }

  /**
   * 添加文字标注
   * "在2号右边加文字：已审批" / "写上标题" / "标注完成"
   */
  _execAddText(command) {
    const { canvasWidth: W, canvasHeight: H } = store.state;
    let x = W / 2, y = H / 2;

    let parentId = null;

    if (command.refId) {
      const ref = store.getObjectByNumber(command.refId);
      if (!ref) { this.toast.warning(`未找到 ${command.refId} 号对象`); return null; }
      if (command.side) {
        // 有明确方位词 → 放在图形外侧，不绑定父对象
        const pos = this._sideCoords(ref, command.side, 55);
        x = pos.x; y = pos.y;
      } else {
        // 无方位词（默认）→ 文字居中于图形内部，绑定父对象随之移动
        x = ref.x; y = ref.y;
        parentId = ref.id;
      }
    } else if (command.position) {
      const coords = positionToCoords(command.position, W, H);
      x = coords.x; y = coords.y;
    }

    const textShape = createShape('text', {
      x, y,
      content: command.content,
      fontSize: 16,
      color: '#333333',
      textAlign: 'center',
      ...(parentId !== null ? { _parentId: parentId } : {}),
    });
    return store.addObject(textShape);
  }

  /**
   * 修改文字对象的内容
   * "把3号文字改成已完成"
   */
  _execModifyText(command) {
    const obj = store.getObjectByNumber(command.refId);
    if (!obj) { this.toast.warning(`未找到 ${command.refId} 号对象`); return null; }
    if (obj.type !== 'text') {
      this.toast.warning(`${command.refId} 号不是文字对象，无法修改内容`);
      return null;
    }
    store.updateObject(obj.id, { content: command.content });
    return obj;
  }

  /**
   * 移动形状后，同步所有关联对象：
   *   1. 有 _parentId === movedId 的子文字对象 → 随父对象平移相同位移
   *   2. 有 _fromId 或 _toId === movedId 的连线 → 重新计算两端边缘交点
   *
   * 使用 updateObjectNoHistory，避免每个关联对象都产生独立历史快照。
   * 撤销时，主对象的历史快照已包含所有关联对象的旧位置，可一次性还原。
   *
   * @param {number} movedId - 刚刚被移动的对象 ID
   * @param {number} dx      - x 方向位移量（像素）
   * @param {number} dy      - y 方向位移量（像素）
   */
  _syncConnected(movedId, dx, dy) {
    const movedObj = store.getObjectById(movedId);
    if (!movedObj) return;

    for (const obj of store.state.objects) {
      // 子文字：随父对象同步平移
      if (obj._parentId === movedId) {
        store.updateObjectNoHistory(obj.id, { x: obj.x + dx, y: obj.y + dy });
      }

      // 连线：重新计算两端边缘交点
      if (obj._fromId || obj._toId) {
        const isFrom = obj._fromId === movedId;
        const isTo   = obj._toId   === movedId;
        if (!isFrom && !isTo) continue;

        const fromObj = isFrom ? movedObj : store.getObjectById(obj._fromId);
        const toObj   = isTo   ? movedObj : store.getObjectById(obj._toId);
        if (!fromObj || !toObj) continue;

        const p1 = getShapeEdgePoint(fromObj, toObj.x, toObj.y);
        const p2 = getShapeEdgePoint(toObj, fromObj.x, fromObj.y);
        store.updateObjectNoHistory(obj.id, { x: p1.x, y: p1.y, x2: p2.x, y2: p2.y });
      }
    }
  }

  /**
   * 根据参考对象和方位词计算目标坐标
   * @param {object} refObj - 参考 shape 对象
   * @param {string} side   - 'right'|'left'|'above'|'below'
   * @param {number} gap    - 额外间距（默认 70px）
   */
  _sideCoords(refObj, side, gap = 70) {
    const b = getShapeBounds(refObj);
    switch (side) {
      case 'left':  return { x: b.x - gap,            y: refObj.y };
      case 'above': return { x: refObj.x,              y: b.y - gap };
      case 'below': return { x: refObj.x,              y: b.y + b.h + gap };
      default:      return { x: b.x + b.w + gap,       y: refObj.y }; // 'right'
    }
  }

  // ========== LLM 图形生成 ==========

  /**
   * 触发 LLM 绘图请求
   * 改为"描述模式"入口：先把用户的初始描述收入缓冲，
   * 等用户补充完细节并说"完成"后，再统一发给 LLM 生成。
   * 这样避免了"一句话说不清"的情况，让复杂图形的描述体验更自然。
   */
  _execLLMDraw(command) {
    store.cancelPreview();
    this._enterLLMSession(command.prompt);
  }

  // ========== LLM 描述模式状态机 ==========

  /**
   * 进入描述模式
   * @param {string} initialPrompt - 触发 LLM 意图的第一句话
   */
  _enterLLMSession(initialPrompt) {
    this._llmSessionActive = true;
    this._llmSessionBuffer = [initialPrompt];
    this._llmSessionId = `sid_${Date.now()}`;

    voiceSynth.speak('好的，请继续补充细节，说完成开始生成');
    this.toast.show('🎤 描述模式 — 请继续说细节，说"完成"开始生成，说"取消"退出', 'info', 60000);

    const transcriptEl = document.getElementById('transcript');
    if (transcriptEl) transcriptEl.textContent = `🎤 ${initialPrompt}`;
  }

  /**
   * 接收描述模式下每一句 isFinal 结果
   * - "完成/好了/结束/就这些/画吧" → 提交
   * - "取消/算了/不画了" → 退出
   * - 其余 → 追加到缓冲
   */
  _handleSessionInput(text) {
    const t = text.trim();

    if (/完成|好了|结束|就这些|就这样|开始画|开始绘制|画吧|行了|可以了/.test(t)) {
      this._submitLLMSession();
      return;
    }

    if (/取消|算了|不画了|退出|不要了/.test(t)) {
      this._exitLLMSession(true);
      return;
    }

    // 追加缓冲
    this._llmSessionBuffer.push(t);
    const count = this._llmSessionBuffer.length;
    const joined = this._llmSessionBuffer.join('，');

    const transcriptEl = document.getElementById('transcript');
    if (transcriptEl) transcriptEl.textContent = `🎤 ${joined}`;

    this.toast.show(
      `📝 已记录 ${count} 句 — 继续描述，或说"完成"生成，"取消"退出`,
      'info', 3000,
    );
  }

  /**
   * 提交描述缓冲 → 触发 LLM 生成
   */
  _submitLLMSession() {
    const fullPrompt = this._llmSessionBuffer.join('，');
    const sessionId = this._llmSessionId;

    this._exitLLMSession(false);

    this.toast.show('⏳ 正在生成图形，请稍候...', 'info', 15000);

    voiceRecorder.onLLMResult = (data) => {
      voiceRecorder.onLLMResult = null;
      voiceRecorder.onLLMError = null;
      this._renderLLMResult(data);
    };
    voiceRecorder.onLLMError = (err) => {
      voiceRecorder.onLLMResult = null;
      voiceRecorder.onLLMError = null;
      console.error('[VoiceDraw] LLM error:', err);
      voiceSynth.speak('图形生成失败，请重试');
      this.toast.error(`生成失败: ${err}`, 4000);
    };

    voiceRecorder.sendLLMDraw(fullPrompt, sessionId);
  }

  /**
   * 退出描述模式（取消或正常完成后均调用）
   * @param {boolean} cancelled - true 表示用户主动取消
   */
  _exitLLMSession(cancelled = false) {
    this._llmSessionActive = false;
    this._llmSessionBuffer = [];
    this._llmSessionId = null;

    const transcriptEl = document.getElementById('transcript');
    if (transcriptEl) transcriptEl.textContent = '';

    if (cancelled) {
      voiceSynth.speak('已退出描述模式');
      this.toast.info('已退出描述模式', 2000);
    }
  }

  /**
   * 将 LLM 返回的配置 JSON 渲染为画布图形
   */
  _renderLLMResult(data) {
    const { canvasWidth: W, canvasHeight: H } = store.state;
    const typeNames = { bar: '柱状图', line: '折线图', pie: '饼图', flowchart: '流程图', mindmap: '思维导图' };
    let shapes = [];

    try {
      switch (data.drawType) {
        case 'bar':
          shapes = renderBarChart(data, W, H);
          break;
        case 'line':
          shapes = renderLineChart(data, W, H);
          break;
        case 'pie':
          shapes = renderPieChart(data, W, H);
          break;
        case 'flowchart':
          shapes = renderFlowchart(data, W, H);
          break;
        case 'mindmap':
          shapes = renderMindmap(data, W, H);
          break;
        default:
          this.toast.warning(`暂不支持图形类型: ${data.drawType}`, 3000);
          return;
      }
    } catch (e) {
      console.error('[VoiceDraw] Render error:', e);
      this.toast.error(`渲染出错: ${e.message}`, 4000);
      return;
    }

    // 批量写入 store（一次性撤销）
    const added = store.addBatch(shapes);
    const interactive = added.filter((o) => !o._system && o.type !== 'text');
    const typeName = typeNames[data.drawType] || '图形';

    // 显示前 4 个可交互对象的 ID，明确告知用户可以用语音继续编辑
    const idHint = interactive.length > 0
      ? `（${interactive.slice(0, 4).map((o) => `${o.id}号`).join('、')}可直接语音改色、移动、删除）`
      : '';
    voiceSynth.speak(`已生成${typeName}`);
    this.toast.success(`✅ 已生成${typeName}${idHint}`, 4000);
  }

  // ========== 辅助方法 ==========

  /**
   * 解析指令中的目标对象（隐式选中）
   * - command.target 有值 → 按 ID 查找并自动选中
   * - command.target 无值 → 返回当前已选中对象
   * - 找不到 → 给出提示并返回 null
   */
  _resolveTarget(command) {
    if (command.target && command.target.type === 'id') {
      const obj = store.getObjectByNumber(command.target.value);
      if (!obj) {
        const msg = `没有找到 ${command.target.value} 号对象`;
        voiceSynth.speak(msg);
        this.toast.warning(msg);
        return null;
      }
      store.selectObject(obj.id);
      this.toast.info(`已选中 ${obj.id} 号`, 1200);
      return obj;
    }
    // 没有指定目标，使用当前选中
    const selected = store.getSelected();
    if (!selected) {
      voiceSynth.speak('请先选中一个对象');
      this.toast.warning('请先选中一个对象');
    }
    return selected;
  }

  _commandToDescription(command) {
    const shapeName = SHAPE_NAMES[command.shape] || '';
    const colorName = command.color ? colorToName(command.color) : '';

    switch (command.type) {
      case 'draw':
        return `画一个${colorName}${shapeName}`;
      case 'color':
        return `修改颜色为${colorName || command.colorName}`;
      case 'resize':
        return command.factor > 1 ? '放大对象' : '缩小对象';
      case 'move':
        return '移动对象';
      case 'select':
        return '选中对象';
      default:
        return '执行操作';
    }
  }

  _showHelpPanel() {
    const panel = document.getElementById('helpPanel');
    if (panel) {
      panel.classList.add('visible');
    }
  }

  _onVoiceStatusChange(status) {
    const statusEl = document.getElementById('micStatus');
    const statusText = document.getElementById('micStatusText');

    const statusMap = {
      'connected': { class: 'status-connected', text: '已连接' },
      'disconnected': { class: 'status-disconnected', text: '未连接' },
      'connecting': { class: 'status-connecting', text: '连接中...' },
      'listening': { class: 'status-listening', text: '正在聆听' },
      'stopped': { class: 'status-stopped', text: '已停止' },
      'asr-ready': { class: 'status-ready', text: '语音识别就绪' },
      'asr-error': { class: 'status-error', text: '识别错误' },
      'mic-error': { class: 'status-error', text: '麦克风错误' },
      'error': { class: 'status-error', text: '连接错误' },
    };

    const info = statusMap[status] || { class: '', text: status };
    if (statusEl) statusEl.className = `status-dot ${info.class}`;
    if (statusText) statusText.textContent = info.text;
  }

  _initStatusUI() {
    // 初始状态
    this._onVoiceStatusChange('connecting');
  }
}

// 启动应用
const app = new VoiceDrawApp();
document.addEventListener('DOMContentLoaded', () => {
  app.init().catch((err) => {
    console.error('[VoiceDraw] Init failed:', err);
  });
});
