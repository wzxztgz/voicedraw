/**
 * 提示消息组件
 * 显示操作反馈、错误提示等
 */

export class Toast {
  constructor(containerEl) {
    this.container = containerEl;
    this.timer = null;
    this.hideTimer = null; // 淡出动画后的 remove 计时器
    // 警告消息去重：相同内容在冷却期内不重复弹出
    this._lastWarning = '';
    this._lastWarningTime = 0;
    this._warningCooldownMs = 3000;
  }

  /**
   * 显示消息
   * @param {string} message - 消息文本
   * @param {string} type - 类型: 'info' | 'success' | 'error' | 'warning'
   * @param {number} duration - 显示时长(ms)
   */
  show(message, type = 'info', duration = 3000) {
    // 警告类消息：相同内容在冷却期内不重复弹出
    if (type === 'warning') {
      const now = Date.now();
      if (message === this._lastWarning && now - this._lastWarningTime < this._warningCooldownMs) {
        return;
      }
      this._lastWarning = message;
      this._lastWarningTime = now;
    }

    // 清除所有待执行的定时器
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }

    // 立即移除所有现存 toast DOM，避免旧 toast 永久残留
    Array.from(this.container.children).forEach((el) => el.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || ''}</span>
      <span class="toast-message">${message}</span>
    `;

    this.container.appendChild(toast);

    // 触发入场动画
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // 自动消失：先淡出，再从 DOM 移除
    this.timer = setTimeout(() => {
      this.timer = null;
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-hiding');
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        // 只移除这个特定 toast，避免误删后来的新 toast
        if (toast.parentNode) toast.remove();
      }, 300);
    }, duration);
  }

  success(message, duration) { this.show(message, 'success', duration); }
  error(message, duration)   { this.show(message, 'error',   duration || 5000); }
  warning(message, duration) { this.show(message, 'warning', duration); }
  info(message, duration)    { this.show(message, 'info',    duration); }
}

export default Toast;
