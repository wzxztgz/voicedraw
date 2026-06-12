/**
 * 全局状态管理
 * 集中管理画布状态、选中对象、上下文、任务队列等
 */

class Store {
  constructor() {
    this._state = {
      // 画布对象列表
      objects: [],
      // 下一个可用 ID
      nextId: 1,
      // 当前选中对象 ID
      selectedId: null,
      // 预渲染对象（半透明预览）
      preview: null,
      // 上一步操作（用于 "再..." 微调）
      lastAction: null,
      // 撤销栈
      history: [],
      // 重做栈
      redoStack: [],
      // 最大历史记录数
      maxHistory: 10,
      // 麦克风状态
      isListening: false,
      // WebSocket 连接状态
      isConnected: false,
      // 实时识别文本
      currentTranscript: '',
      // 最终识别文本
      finalTranscript: '',
      // 任务队列（复合指令拆解）
      taskQueue: [],
      // 当前正在执行的任务索引
      currentTaskIndex: -1,
      // 预渲染检测到的关键词
      detectedKeywords: {
        color: null,
        shape: null,
        size: null,
        position: null,
      },
      // 画布尺寸
      canvasWidth: 800,
      canvasHeight: 600,
    };

    this._listeners = new Map();
  }

  get state() {
    return this._state;
  }

  /**
   * 更新状态
   */
  set(key, value) {
    const oldValue = this._state[key];
    this._state[key] = value;
    if (oldValue !== value) {
      this._emit(key, value, oldValue);
      this._emit('change', { key, value, oldValue });
    }
  }

  /**
   * 批量更新状态
   */
  batchUpdate(updates) {
    const changes = [];
    for (const [key, value] of Object.entries(updates)) {
      const oldValue = this._state[key];
      this._state[key] = value;
      if (oldValue !== value) {
        changes.push({ key, value, oldValue });
      }
    }
    for (const change of changes) {
      this._emit(change.key, change.value, change.oldValue);
    }
    if (changes.length > 0) {
      this._emit('change', { changes });
    }
  }

  /**
   * 订阅状态变化
   */
  on(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);
    return () => this._listeners.get(key)?.delete(callback);
  }

  _emit(key, value, oldValue) {
    const callbacks = this._listeners.get(key);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try { cb(value, oldValue); } catch (e) { console.error(`[Store] Listener error for "${key}":`, e); }
      });
    }
  }

  // ========== 便捷方法 ==========

  /**
   * 添加图形对象
   */
  addObject(shape) {
    this.pushHistory();
    const obj = {
      id: this._state.nextId++,
      ...shape,
    };
    this._state.objects.push(obj);
    this.set('objects', [...this._state.objects]);
    this.set('selectedId', obj.id);
    return obj;
  }

  /**
   * 更新图形对象
   */
  updateObject(id, updates) {
    this.pushHistory();
    const idx = this._state.objects.findIndex((o) => o.id === id);
    if (idx !== -1) {
      this._state.objects[idx] = { ...this._state.objects[idx], ...updates };
      this.set('objects', [...this._state.objects]);
    }
  }

  /**
   * 删除图形对象
   */
  removeObject(id) {
    this.pushHistory();
    this._state.objects = this._state.objects.filter((o) => o.id !== id);
    this.set('objects', [...this._state.objects]);
    if (this._state.selectedId === id) {
      this.set('selectedId', null);
    }
  }

  /**
   * 获取选中对象
   */
  getSelected() {
    return this._state.objects.find((o) => o.id === this._state.selectedId) || null;
  }

  /**
   * 选中对象
   */
  selectObject(id) {
    this.set('selectedId', id);
  }

  /**
   * 根据 ID 获取对象
   */
  getObjectById(id) {
    return this._state.objects.find((o) => o.id === id) || null;
  }

  /**
   * 根据 ID 数字获取对象
   */
  getObjectByNumber(num) {
    return this._state.objects.find((o) => o.id === num) || null;
  }

  /**
   * 根据形状类型筛选对象
   */
  getObjectsByShape(shapeType) {
    return this._state.objects.filter((o) => o.type === shapeType);
  }

  /**
   * 保存历史记录（用于撤销）
   */
  pushHistory() {
    const snapshot = JSON.parse(JSON.stringify(this._state.objects));
    this._state.history.push(snapshot);
    if (this._state.history.length > this._state.maxHistory) {
      this._state.history.shift();
    }
    this._state.redoStack = [];
  }

  /**
   * 撤销
   */
  undo() {
    if (this._state.history.length === 0) return false;
    const current = JSON.parse(JSON.stringify(this._state.objects));
    this._state.redoStack.push(current);
    const prev = this._state.history.pop();
    this._state.objects = prev;
    this.set('objects', [...this._state.objects]);
    return true;
  }

  /**
   * 重做
   */
  redo() {
    if (this._state.redoStack.length === 0) return false;
    const current = JSON.parse(JSON.stringify(this._state.objects));
    this._state.history.push(current);
    const next = this._state.redoStack.pop();
    this._state.objects = next;
    this.set('objects', [...this._state.objects]);
    return true;
  }

  /**
   * 清除画布
   */
  clearCanvas() {
    this.pushHistory();
    this._state.objects = [];
    this.set('objects', []);
    this.set('selectedId', null);
    this.set('preview', null);
  }

  /**
   * 设置预览对象
   */
  setPreview(preview) {
    this.set('preview', preview);
  }

  /**
   * 确认预览（转为正式对象）
   */
  confirmPreview() {
    if (this._state.preview) {
      const obj = this.addObject({ ...this._state.preview });
      this.set('preview', null);
      return obj;
    }
    return null;
  }

  /**
   * 取消预览
   */
  cancelPreview() {
    this.set('preview', null);
    this.set('detectedKeywords', { color: null, shape: null, size: null, position: null });
  }

  /**
   * 记录上一步操作（用于 "再..." 微调）
   */
  setLastAction(action) {
    this.set('lastAction', action);
  }

  /**
   * 添加任务到队列
   */
  addTasks(tasks) {
    this.set('taskQueue', tasks);
    this.set('currentTaskIndex', 0);
  }

  /**
   * 完成当前任务，移到下一个
   */
  completeCurrentTask() {
    const idx = this._state.currentTaskIndex;
    if (idx < this._state.taskQueue.length) {
      const queue = [...this._state.taskQueue];
      queue[idx].completed = true;
      this.set('taskQueue', queue);
      this.set('currentTaskIndex', idx + 1);
    }
  }

  /**
   * 清空任务队列
   */
  clearTasks() {
    this.set('taskQueue', []);
    this.set('currentTaskIndex', -1);
  }
}

// 全局单例
const store = new Store();
export default store;
