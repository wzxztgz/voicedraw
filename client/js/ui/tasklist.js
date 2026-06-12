/**
 * 任务瀑布流 UI
 * 显示复合指令的拆解任务和执行进度
 */

import store from '../state/store.js';

export class TaskListUI {
  constructor(containerEl) {
    this.container = containerEl;
    this.isVisible = false;

    // 监听任务队列变化
    store.on('taskQueue', () => this.render());
    store.on('currentTaskIndex', () => this.render());
  }

  /**
   * 显示任务列表
   */
  show(tasks) {
    const taskList = tasks.map((t, i) => ({
      text: t.description || this._taskToText(t),
      completed: false,
      command: t,
    }));
    store.addTasks(taskList);
    this.isVisible = true;
    this.container.classList.add('visible');
    this.render();
  }

  /**
   * 标记当前任务完成
   */
  completeCurrent() {
    store.completeCurrentTask();
    this.render();

    // 检查是否全部完成
    const { taskQueue, currentTaskIndex } = store.state;
    if (currentTaskIndex >= taskQueue.length) {
      setTimeout(() => this.hide(), 2000);
    }
  }

  /**
   * 隐藏任务列表
   */
  hide() {
    this.isVisible = false;
    this.container.classList.remove('visible');
    store.clearTasks();
  }

  /**
   * 渲染任务列表
   */
  render() {
    const { taskQueue, currentTaskIndex } = store.state;

    if (taskQueue.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    let html = '<div class="task-header">好的，我将：</div>';

    taskQueue.forEach((task, i) => {
      const statusClass = task.completed ? 'completed' :
                          i === currentTaskIndex ? 'active' : 'pending';

      const icon = task.completed ? '✓' :
                   i === currentTaskIndex ? '●' : '○';

      html += `
        <div class="task-item ${statusClass}">
          <span class="task-icon">${icon}</span>
          <span class="task-text">${task.text}</span>
          ${i === currentTaskIndex && !task.completed ? '<span class="task-status">执行中...</span>' : ''}
        </div>
      `;
    });

    this.container.innerHTML = html;
  }

  /**
   * 将指令转为描述文本
   */
  _taskToText(command) {
    switch (command.type) {
      case 'draw':
        return `画一个${command.color ? '图形' : command.shape}`;
      case 'color':
        return `修改颜色`;
      case 'move':
        return `移动对象`;
      case 'resize':
        return `调整大小`;
      default:
        return '执行操作';
    }
  }
}

export default TaskListUI;
