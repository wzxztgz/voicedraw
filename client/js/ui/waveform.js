/**
 * 语音波形指示器
 * 实时显示麦克风采集状态和音频波形
 */

export class WaveformVisualizer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.analyser = null;
    this.dataArray = null;
    this.animationId = null;
    this.isActive = false;
    this.barCount = 32;
    this.logicalWidth = 0;
    this.logicalHeight = 0;
    this.colors = {
      active: '#4ECDC4',
      inactive: '#E0E0E0',
      bg: '#F5F5F5',
    };
  }

  /**
   * 连接音频分析器
   */
  connectAnalyser(analyserNode) {
    this.analyser = analyserNode;
    this.dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    this.start();
  }

  /**
   * 开始动画
   */
  start() {
    if (this.isActive) return;
    this.isActive = true;
    this._animate();
  }

  /**
   * 停止动画
   */
  stop() {
    this.isActive = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this._drawIdle();
  }

  /**
   * 动画循环
   */
  _animate() {
    if (!this.isActive) return;

    if (this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      this._drawWaveform();
    } else {
      this._drawIdle();
    }

    this.animationId = requestAnimationFrame(() => this._animate());
  }

  /**
   * 绘制波形
   */
  _drawWaveform() {
    const ctx = this.ctx;
    const w = this.logicalWidth;
    const h = this.logicalHeight;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, w, h);

    const barWidth = (w / this.barCount) * 0.6;
    const gap = (w / this.barCount) * 0.4;
    const step = Math.floor(this.dataArray.length / this.barCount);

    for (let i = 0; i < this.barCount; i++) {
      const value = this.dataArray[i * step] / 255;
      const barHeight = Math.max(2, value * h * 0.8);
      const x = i * (barWidth + gap) + gap / 2;
      const y = (h - barHeight) / 2;

      const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
      gradient.addColorStop(0, this.colors.active);
      gradient.addColorStop(1, '#45B7D1');
      ctx.fillStyle = gradient;

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 2);
      ctx.fill();
    }
  }

  /**
   * 绘制空闲状态（静态小点）
   */
  _drawIdle() {
    const ctx = this.ctx;
    const w = this.logicalWidth;
    const h = this.logicalHeight;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, w, h);

    const barWidth = (w / this.barCount) * 0.6;
    const gap = (w / this.barCount) * 0.4;

    for (let i = 0; i < this.barCount; i++) {
      const x = i * (barWidth + gap) + gap / 2;
      const barHeight = 2;
      const y = (h - barHeight) / 2;

      ctx.fillStyle = this.colors.inactive;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1);
      ctx.fill();
    }
  }

  /**
   * 设置尺寸（CSS 逻辑像素，与 renderer.js 一致）
   */
  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    if (this.isActive) {
      this._drawWaveform();
    } else {
      this._drawIdle();
    }
  }

  /**
   * 根据容器元素同步尺寸
   */
  resizeToContainer(containerEl) {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.resize(rect.width, rect.height);
    }
  }
}

export default WaveformVisualizer;
