/**
 * 提示消息组件
 * 显示操作反馈、错误提示等
 */

export class Toast {
  constructor(containerEl) {
    this.container = containerEl;
    this.timer = null;
  }

  /**
   * 显示消息
   * @param {string} message - 消息文本
   * @param {string} type - 类型: 'info' | 'success' | 'error' | 'warning'
   * @param {number} duration - 显示时长(ms)
   */
  show(message, type = 'info', duration = 3000) {
    // 清除之前的计时器
    if (this.timer) clearTimeout(this.timer);

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
