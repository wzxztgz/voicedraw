/**
 * VoiceDraw 主入口
 * 集成所有模块，管理指令执行流程
 */

import store from './state/store.js';
import Renderer from './canvas/renderer.js';
import { createShape, COLOR_MAP, SHAPE_NAMES, colorToName } from './canvas/shapes.js';
import { parseCommand, detectKeywords } from './parser/keyword.js';
import { positionToCoords } from './canvas/grid.js';
import contextManager from './parser/context.js';
import voiceRecorder from './voice/recorder.js';
import voiceSynth from './voice/synthesizer.js';
import { WaveformVisualizer } from './ui/waveform.js';
import { TaskListUI } from './ui/tasklist.js';
import Toast from './ui/toast.js';

class VoiceDrawApp {
  constructor() {
    this.renderer = null;
    this.waveform = null;
    this.taskList = null;
    this.toast = null;
    this.isProcessing = false;
    this.previewTimeout = null;
  }

  /**
   * 初始化应用
   */
  async init() {
    console.log('[VoiceDraw] Initializing...');

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
    };
    return map[shapeName] || 'circle';
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
      color: keywords.color || '#FF4444', // 阶段1用红色定位圆
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
    this.previewTimeout = setTimeout(() => {
      if (store.state.preview) {
        this._executeCommand({ type: 'confirm' });
      }
    }, 1500);
  }

  /**
   * 处理最终指令
   */
  _processCommand(text) {
    // 清除预览超时
    if (this.previewTimeout) clearTimeout(this.previewTimeout);

    const command = parseCommand(text);

    if (!command) {
      const clarification = contextManager.generateClarification(text);
      voiceSynth.speak(clarification);
      this.toast.warning(clarification, 4000);
      return;
    }

    // 执行指令
    this._executeCommand(command, text);
  }

  /**
   * 执行指令（核心方法）
   */
  async _executeCommand(command, originalText) {
    if (this.isProcessing && command.type !== 'cancel') return;

    let result = null;
    let feedback = '';

    switch (command.type) {
      case 'draw':
        result = this._execDraw(command);
        break;

      case 'select':
        result = this._execSelect(command);
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

      case 'compound':
        await this._execCompound(command);
        return;

      case 'refine':
        result = this._execRefine(command);
        break;

      case 'unknown':
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

    // 清除预览
    store.set('detectedKeywords', { color: null, shape: null, size: null, position: null });
  }

  // ========== 指令执行方法 ==========

  _execDraw(command) {
    const { canvasWidth: W, canvasHeight: H } = store.state;

    // 计算最终尺寸（命令优先，其次沿用预览的 _sizeTag）
    const sizeTag = command.sizeModifier || (store.state.preview && store.state.preview._sizeTag);
    const sizeOverrides = {};
    if (sizeTag === 'large') {
      Object.assign(sizeOverrides, { radius: 80, width: 160, height: 120, size: 90, rx: 120, ry: 75 });
    } else if (sizeTag === 'small') {
      Object.assign(sizeOverrides, { radius: 30, width: 60, height: 50, size: 35, rx: 50, ry: 30 });
    }

    if (store.state.preview) {
      const preview = store.state.preview;

      // 计算最终位置（命令优先，其次沿用预览位置）
      let finalX = preview.x;
      let finalY = preview.y;
      if (command.position) {
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
    if (command.position) {
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
    let obj = null;

    if (command.target.type === 'id') {
      obj = store.getObjectByNumber(command.target.value);
    } else if (command.target.type === 'shape') {
      // 按形状类型查找，选第一个匹配的
      const candidates = store.state.objects.filter((o) => o.type === command.target.shapeType);
      obj = candidates.length > 0 ? candidates[0] : null;
    }

    if (obj) {
      store.selectObject(obj.id);
      return obj;
    } else {
      voiceSynth.speak('未找到指定对象');
      this.toast.warning('未找到指定对象');
      return null;
    }
  }

  _execColor(command) {
    const obj = store.getSelected();
    if (!obj) {
      voiceSynth.speak('请先选中一个对象');
      this.toast.warning('请先选中一个对象');
      return null;
    }
    store.updateObject(obj.id, { color: command.color });
    return obj;
  }

  _execResize(command) {
    const obj = store.getSelected();
    if (!obj) {
      voiceSynth.speak('请先选中一个对象');
      this.toast.warning('请先选中一个对象');
      return null;
    }

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
    const obj = store.getSelected();
    if (!obj) {
      voiceSynth.speak('请先选中一个对象');
      this.toast.warning('请先选中一个对象');
      return null;
    }

    // 形状变更：重建对象，保留位置和颜色
    const newObj = createShape(command.shape, {
      x: obj.x,
      y: obj.y,
      color: obj.color,
    });
    // 保留 id 和选中状态
    newObj.id = obj.id;
    store.replaceObject(obj.id, newObj);
    return newObj;
  }

  _execMove(command) {
    const obj = store.getSelected();
    if (!obj) {
      voiceSynth.speak('请先选中一个对象');
      this.toast.warning('请先选中一个对象');
      return null;
    }

    if (command.dx !== undefined) {
      // 方向移动（相对）
      const dist = command.distance || 30;
      store.updateObject(obj.id, {
        x: obj.x + command.dx * dist,
        y: obj.y + command.dy * dist,
      });
    }

    return obj;
  }

  _execMoveTo(command) {
    const obj = store.getSelected();
    if (!obj) {
      voiceSynth.speak('请先选中一个对象');
      this.toast.warning('请先选中一个对象');
      return null;
    }

    // 绝对位置移动
    const { canvasWidth: W, canvasHeight: H } = store.state;
    const coords = positionToCoords(command.position, W, H);
    store.updateObject(obj.id, { x: coords.x, y: coords.y });
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
    const helpText = `声绘支持以下指令：
      画一个圆形、画一个矩形、画一条直线、画一个三角形、画一个星形、画一个椭圆。
      修改颜色，例如：改成红色。
      调整大小，例如：放大、缩小。
      移动位置，例如：往左移一点、移到右上角。
      选中对象，例如：选中3号、选中左上角的圆。
      清除画布、撤销、重做。
      确认、取消、帮助。`;

    voiceSynth.speak(helpText);
    this._showHelpPanel();
  }

  async _execCompound(command) {
    this.isProcessing = true;

    // 显示任务列表
    const tasks = command.tasks.map((t) => ({
      text: this._commandToDescription(t),
      command: t,
    }));
    this.taskList.show(tasks);

    // 逐个执行
    for (let i = 0; i < command.tasks.length; i++) {
      const subCommand = command.tasks[i];
      await this._executeCommand(subCommand);
      this.taskList.completeCurrent();

      // 短暂延迟，让用户看到进度
      await new Promise((r) => setTimeout(r, 300));
    }

    this.isProcessing = false;
    voiceSynth.speak('所有任务已完成');
    this.toast.success('所有任务已完成');

    setTimeout(() => this.taskList.hide(), 2000);
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

  // ========== 辅助方法 ==========

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
      panel.classList.toggle('visible');
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

    // 帮助按钮
    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => this._execHelp());
    }

    // 关闭帮助面板
    const closeHelp = document.getElementById('closeHelp');
    if (closeHelp) {
      closeHelp.addEventListener('click', () => {
        document.getElementById('helpPanel')?.classList.remove('visible');
      });
    }
  }
}

// 启动应用
const app = new VoiceDrawApp();
document.addEventListener('DOMContentLoaded', () => {
  app.init().catch((err) => {
    console.error('[VoiceDraw] Init failed:', err);
  });
});
