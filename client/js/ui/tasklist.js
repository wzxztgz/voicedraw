/**
 * 任务瀑布流 UI
 * 显示复合指令的拆解任务和执行进度
 */

import store from '../state/store.js';

const HIDE_DELAY_MS = 5200;
const FADE_MS = 420;

export class TaskListUI {
  constructor(containerEl) {
    this.container = containerEl;
    this.isVisible = false;
    this._hideTimer = null;
    this._fadeTimer = null;

    store.on('taskQueue', () => this.render());
    store.on('currentTaskIndex', () => this.render());
  }

  /**
   * 显示任务列表（新指令到来时会立即清除上一条弹窗）
   * @param {{ text?: string, description?: string, command?: object }[]} tasks
   */
  show(tasks) {
    this._cancelTimers();
    this._resetPanel();

    const taskList = tasks.map((t) => ({
      text: t.text || t.description || this._taskToText(t.command || t),
      completed: false,
      command: t.command || t,
    }));

    store.addTasks(taskList);
    this.isVisible = true;
    requestAnimationFrame(() => {
      this.container.classList.add('visible');
    });
    this.render();
  }

  completeCurrent() {
    store.completeCurrentTask();
    this.render();
  }

  scheduleHide(delay = HIDE_DELAY_MS) {
    this._cancelTimers();
    this._hideTimer = setTimeout(() => this.hide(), delay);
  }

  hide() {
    this._cancelTimers();
    if (!this.isVisible) {
      this._resetPanel();
      return;
    }

    this.container.classList.remove('visible');
    this.container.classList.add('hiding');
    this.isVisible = false;

    this._fadeTimer = setTimeout(() => {
      this._resetPanel();
    }, FADE_MS);
  }

  _resetPanel() {
    this.container.classList.remove('visible', 'hiding');
    this.isVisible = false;
    store.clearTasks();
    this.container.innerHTML = '';
  }

  _cancelTimers() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  render() {
    const { taskQueue, currentTaskIndex } = store.state;

    if (taskQueue.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    const allDone = currentTaskIndex >= taskQueue.length;
    const header = allDone ? '已执行以下操作' : '正在执行';

    let html = `<div class="task-header">${header}</div>`;

    taskQueue.forEach((task, i) => {
      const isActive = !allDone && i === currentTaskIndex;
      const statusClass = task.completed ? 'completed' : isActive ? 'active' : 'pending';
      const icon = task.completed ? '✓' : isActive ? '●' : '○';

      let statusHtml = '';
      if (task.completed) {
        statusHtml = '<span class="task-done-tag">已完成</span>';
      } else if (isActive) {
        statusHtml = '<span class="task-status">执行中…</span>';
      }

      html += `
        <div class="task-item ${statusClass}">
          <span class="task-icon">${icon}</span>
          <span class="task-text">${this._escapeHtml(task.text)}</span>
          ${statusHtml}
        </div>
      `;
    });

    this.container.innerHTML = html;
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _taskToText(command) {
    if (!command?.type) return '执行操作';
    switch (command.type) {
      case 'draw':
        return `绘制${command.shape || '图形'}`;
      case 'color':
        return '修改颜色';
      case 'move':
        return '移动对象';
      case 'moveTo':
        return '移动到指定位置';
      case 'resize':
        return command.factor > 1 ? '放大对象' : '缩小对象';
      case 'connect':
        return `连接 ${command.fromId}号和${command.toId}号`;
      case 'delete':
        return command.target ? `删除 ${command.target.value} 号` : '删除对象';
      case 'addText':
        return `添加文字：${command.content || ''}`;
      case 'modifyText':
        return `修改 ${command.refId} 号文字`;
      default:
        return '执行操作';
    }
  }
}

export default TaskListUI;
