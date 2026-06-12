/**
 * 提示消息组件
 * 显示操作反馈、错误提示等
 */

export class Toast {
  constructor(containerEl) {
    this.container = containerEl;
    this.timer = null;
    // 警告消息去重：记录上次显示的内容和时间
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

    // 清除之前的计时器，并立即移除所有现存 toast，避免 DOM 堆积
    if (this.timer) clearTimeout(this.timer);
    Array.from(this.container.children).forEach((el) => el.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
      warning: '⚠️',
    };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || ''}</span>
      <span class="toast-message">${message}</span>
    `;

    this.container.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // 自动消失
    this.timer = setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * 显示成功消息
   */
  success(message, duration) {
    this.show(message, 'success', duration);
  }

  /**
   * 显示错误消息
   */
  error(message, duration) {
    this.show(message, 'error', duration || 5000);
  }

  /**
   * 显示警告消息
   */
  warning(message, duration) {
    this.show(message, 'warning', duration);
  }

  /**
   * 显示信息消息
   */
  info(message, duration) {
    this.show(message, 'info', duration);
  }
}

export default Toast;
