/**
 * Canvas 渲染器
 * 负责画布绘制、刷新、预渲染层管理
 */

import store from '../state/store.js';
import { drawShape, drawSelection, drawLabel } from './shapes.js';
import { drawGrid, drawPositionHints } from './grid.js';

class Renderer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.animationId = null;
    this.showGrid = true;

    // 同步画布尺寸
    this.resize();
    // resize() 内部已通过 store.set 设置了正确的 CSS 像素尺寸

    // 监听状态变化，自动重绘
    store.on('objects', () => this.render());
    store.on('selectedId', () => this.render());
    store.on('preview', () => this.render());
    store.on('detectedKeywords', () => this.render());

    // 监听窗口大小变化
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    // 重置变换矩阵后再 scale，避免累积缩放
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    store.set('canvasWidth', rect.width);
    store.set('canvasHeight', rect.height);
    this.render();
  }

  /**
   * 主渲染函数
   */
  render() {
    const { objects, selectedId, preview, detectedKeywords, canvasWidth, canvasHeight } = store.state;

    const ctx = this.ctx;
    const w = canvasWidth;
    const h = canvasHeight;

    // 清空画布
    ctx.clearRect(0, 0, w, h);

    // 浅色背景（配合网格）
    ctx.fillStyle = '#F8F9FB';
    ctx.fillRect(0, 0, w, h);

    // 绘制网格背景 + 九宫格方位提示
    if (this.showGrid) {
      drawGrid(ctx, w, h);
      drawPositionHints(ctx, w, h);
    }

    // 绘制所有正式对象
    for (const obj of objects) {
      drawShape(ctx, obj, false);
      drawLabel(ctx, obj);
      if (obj.id === selectedId) {
        drawSelection(ctx, obj);
      }
    }

    // 绘制预览对象
    if (preview) {
      drawShape(ctx, preview, true);
      // 预览标签
      ctx.save();
      ctx.font = '12px "Noto Sans SC", sans-serif';
      ctx.fillStyle = 'rgba(255, 152, 0, 0.8)';
      ctx.textAlign = 'center';
      ctx.fillText('预览中...', preview.x, (preview.y || 0) - 40);
      ctx.restore();
    }

    // 绘制检测到的关键词提示
    if (detectedKeywords.color || detectedKeywords.shape) {
      this._drawKeywordHints(ctx, detectedKeywords, w, h);
    }
  }

  /**
   * 绘制关键词检测提示
   */
  _drawKeywordHints(ctx, keywords, w, h) {
    ctx.save();
    let y = 20;
    ctx.font = '13px "Noto Sans SC", sans-serif';
    ctx.textAlign = 'left';

    if (keywords.color) {
      ctx.fillStyle = keywords.color;
      ctx.fillRect(w - 120, y - 12, 16, 16);
      ctx.fillStyle = '#666';
      ctx.fillText(`颜色: ${keywords.colorName || keywords.color}`, w - 98, y);
      y += 24;
    }

    if (keywords.shape) {
      ctx.fillStyle = '#666';
      ctx.fillText(`形状: ${keywords.shape}`, w - 120, y);
    }

    ctx.restore();
  }

  /**
   * 导出画布为 PNG 图片并下载
   * 导出时：
   *   - 使用白色纯净背景（不含网格 / 方位提示）
   *   - 不绘制节点编号标签（drawLabel 跳过）
   *   - 不绘制选中高亮 / 预览对象
   *   - 保持与屏幕相同的 DPR，确保高清
   */
  exportImage() {
    const { objects, canvasWidth: w, canvasHeight: h } = store.state;

    const dpr = window.devicePixelRatio || 1;
    const off = document.createElement('canvas');
    off.width  = w * dpr;
    off.height = h * dpr;
    const ctx = off.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 纯白背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // 绘制所有图形，跳过 drawLabel（节点编号）和 drawSelection
    for (const obj of objects) {
      drawShape(ctx, obj, false);
    }

    // 触发下载
    const link = document.createElement('a');
    const ts   = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    link.download = `voicedraw-${ts}.png`;
    link.href = off.toDataURL('image/png');
    link.click();
  }

  /**
   * 获取画布逻辑尺寸（CSS 像素）
   */
  getSize() {
    return {
      width: store.state.canvasWidth,
      height: store.state.canvasHeight,
    };
  }
}

export default Renderer;
