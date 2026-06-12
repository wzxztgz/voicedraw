/**
 * 上下文管理器
 * 管理对话上下文，支持连续微调和对象指代继承
 */

import store from '../state/store.js';
import { SHAPE_NAMES, colorToName } from '../canvas/shapes.js';

class ContextManager {
  constructor() {
    this.conversationHistory = [];
    this.maxHistory = 20;
  }

  /**
   * 记录一次交互
   */
  recordInteraction(transcript, command, result) {
    this.conversationHistory.push({
      transcript,
      command,
      result,
      timestamp: Date.now(),
    });

    if (this.conversationHistory.length > this.maxHistory) {
      this.conversationHistory.shift();
    }
  }

  /**
   * 获取上一次交互
   */
  getLastInteraction() {
    return this.conversationHistory.length > 0
      ? this.conversationHistory[this.conversationHistory.length - 1]
      : null;
  }

  /**
   * 获取当前操作上下文（用于 "再..." 微调）
   */
  getCurrentContext() {
    return store.state.lastAction;
  }

  /**
   * 设置操作上下文
   */
  setActionContext(action) {
    store.set('lastAction', action);
  }

  /**
   * 获取当前选中对象的描述
   */
  getSelectedDescription() {
    const obj = store.getSelected();
    if (!obj) return null;

    const shapeName = SHAPE_NAMES[obj.type] || obj.type;
    const colorName = colorToName(obj.color);
    return `${colorName}${shapeName} ${obj.id} 号`;
  }

  /**
   * 生成确认反馈文本
   */
  generateFeedback(command, result) {
    if (!result) return '操作完成';

    switch (command.type) {
      case 'draw': {
        const shapeName = SHAPE_NAMES[command.shape] || command.shape;
        const colorName = command.color ? colorToName(command.color) : '';
        return `已绘制${colorName}${shapeName} ${result.id} 号`;
      }
      case 'color': {
        return `已修改颜色`;
      }
      case 'resize': {
        return command.factor > 1 ? '已放大' : '已缩小';
      }
      case 'move': {
        return '已移动';
      }
      case 'select': {
        return `已选中 ${result.id} 号`;
      }
      case 'delete': {
        return `已删除 ${result.id} 号`;
      }
      case 'clear':
        return '画布已清除';
      case 'undo':
        return '已撤销';
      case 'redo':
        return '已重做';
      case 'confirm':
        return '已确认';
      case 'cancel':
        return '已取消';
      case 'refine':
        return '已微调';
      case 'compound':
        return '所有任务已完成';
      default:
        return '操作完成';
    }
  }

  /**
   * 生成反问文本（识别失败时）
   */
  generateClarification(text) {
    // 检测是否接近某个已知指令
    const suggestions = [];

    if (text.includes('画') || text.includes('添加')) {
      suggestions.push('画一个圆');
      suggestions.push('画一个矩形');
    }
    if (text.includes('颜色') || text.includes('改')) {
      suggestions.push('改成红色');
    }
    if (text.includes('移') || text.includes('动')) {
      suggestions.push('往左移一点');
    }

    if (suggestions.length > 0) {
      return `你是说 ${suggestions.slice(0, 2).join(' 还是 ')} 吗？`;
    }

    return '抱歉没有理解，你可以说"帮助"查看支持的指令';
  }

  /**
   * 清空上下文
   */
  clear() {
    this.conversationHistory = [];
    store.set('lastAction', null);
  }
}

export default new ContextManager();
