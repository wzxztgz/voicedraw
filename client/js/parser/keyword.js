/**
 * 关键词匹配指令解析引擎
 * 将语音识别文本解析为结构化指令
 */

import store from '../state/store.js';
import { createShape, COLOR_MAP, SHAPE_NAMES, colorToName } from '../canvas/shapes.js';
import { parseMovement, parsePosition } from '../canvas/grid.js';

// 同音词纠错映射
const HOMOPHONE_MAP = {
  '园': '圆', '元': '圆', '原': '圆',
  '巨形': '矩形', '举形': '矩形',
  '直先': '直线', '指线': '直线',
  '三脚形': '三角形', '三叫形': '三角形',
  '星心': '星形', '新形': '星形',
  '椭圆': '椭圆', '托圆': '椭圆',
  '撤小': '撤销', '撤锁': '撤销',
  '重座': '重做', '虫做': '重做',
};

/**
 * 应用同音词纠错
 */
function correctHomophones(text) {
  let corrected = text;
  for (const [wrong, right] of Object.entries(HOMOPHONE_MAP)) {
    corrected = corrected.replace(new RegExp(wrong, 'g'), right);
  }
  return corrected;
}

/**
 * 主解析函数
 * @param {string} text - 语音识别文本
 * @returns {object|null} 解析后的指令
 */
export function parseCommand(text) {
  const original = text;
  text = correctHomophones(text.trim().toLowerCase());

  console.log(`[Parser] 原始: "${original}" → 纠正: "${text}"`);

  // 1. 帮助指令
  if (text.includes('帮助') || text.includes('我能说什么') || text.includes('怎么用') || text.includes('指令')) {
    return { type: 'help' };
  }

  // 2. 确认指令
  if (text === '确认' || text === '好的' || text === '对' || text === '是的' || text === '没错') {
    return { type: 'confirm' };
  }

  // 3. 取消指令
  if (text === '取消' || text === '不要' || text === '算了' || text === '不对') {
    return { type: 'cancel' };
  }

  // 4. 清除画布
  if (text.includes('清除') || text.includes('清空') || text.includes('全部删除') || text.includes('重新开始')) {
    return { type: 'clear' };
  }

  // 5. 撤销
  if (text.includes('撤销') || text.includes('撤回') || text.includes('上一步')) {
    return { type: 'undo' };
  }

  // 6. 重做
  if (text.includes('重做') || text.includes('恢复')) {
    return { type: 'redo' };
  }

  // 7. "再..." 微调指令
  if (text.startsWith('再') || text.startsWith('继续')) {
    return parseRefine(text);
  }

  // 8. 选中指令
  const selectResult = parseSelect(text);
  if (selectResult) return selectResult;

  // 9. 颜色修改指令
  const colorResult = parseColorChange(text);
  if (colorResult) return colorResult;

  // 10. 大小调整指令
  const sizeResult = parseSizeChange(text);
  if (sizeResult) return sizeResult;

  // 11. 位置移动指令
  const moveResult = parseMove(text);
  if (moveResult) return moveResult;

  // 12. 图形绘制指令
  const drawResult = parseDraw(text);
  if (drawResult) return drawResult;

  // 13. 复合指令（包含 "先...然后..." 或 "再..."）
  const compoundResult = parseCompound(text);
  if (compoundResult) return compoundResult;

  // 未识别
  return { type: 'unknown', text };
}

/**
 * 解析绘制指令
 */
function parseDraw(text) {
  // 匹配形状关键词
  const shapeKeywords = {
    circle: ['圆', '圆形', '圆圈'],
    rect: ['矩形', '方形', '长方形', '正方形', '方块'],
    line: ['直线', '线段', '线条'],
    triangle: ['三角形', '三角'],
    star: ['星形', '星星', '五角星'],
    ellipse: ['椭圆', '椭圆形'],
  };

  let shapeType = null;
  for (const [type, keywords] of Object.entries(shapeKeywords)) {
    if (keywords.some((kw) => text.includes(kw))) {
      shapeType = type;
      break;
    }
  }

  if (!shapeType) return null;

  // 检查是否是修改/移动等操作中的形状提及（非绘制）
  if (text.includes('改') || text.includes('变') || text.includes('移') || text.includes('选') || text.includes('删除')) {
    return null;
  }

  // 提取颜色
  let color = null;
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) {
      color = hex;
      break;
    }
  }

  // 提取大小
  let sizeModifier = null;
  if (text.includes('大')) sizeModifier = 'large';
  else if (text.includes('小')) sizeModifier = 'small';

  // 提取位置（如"在右上角画一个三角形"）
  const position = parsePosition(text);

  return {
    type: 'draw',
    shape: shapeType,
    color,
    sizeModifier,
    position,
  };
}

/**
 * 解析选中指令
 */
function parseSelect(text) {
  // "选中 N 号"
  const numMatch = text.match(/(\d+)\s*号/);
  if (numMatch || text.match(/第\s*(\d+)/)) {
    const num = parseInt(numMatch ? numMatch[1] : text.match(/第\s*(\d+)/)[1]);
    return { type: 'select', target: { type: 'id', value: num } };
  }

  // "选中红色的圆"
  if (text.includes('选中') || text.includes('选择') || text.includes('点击')) {
    // 提取形状
    let shapeType = null;
    const shapeKeywords = { circle: ['圆'], rect: ['矩形', '方形', '方块'], line: ['直线', '线'], triangle: ['三角'], star: ['星'], ellipse: ['椭圆'] };
    for (const [type, keywords] of Object.entries(shapeKeywords)) {
      if (keywords.some((kw) => text.includes(kw))) {
        shapeType = type;
        break;
      }
    }

    if (shapeType) {
      return { type: 'select', target: { type: 'shape', shapeType } };
    }
  }

  return null;
}

/**
 * 解析颜色修改指令
 */
function parseColorChange(text) {
  if (!text.includes('颜色') && !text.includes('改成') && !text.includes('变成') && !text.includes('换')) {
    // 检查 "把它变红" 这种简写
    const hasColorWord = Object.keys(COLOR_MAP).some((name) => text.includes(name));
    if (!hasColorWord) return null;
    // 如果有颜色词但没有明确修改意图，不处理（可能是绘制指令）
    if (text.includes('画') || text.includes('添加') || text.includes('创建')) return null;
  }

  let color = null;
  let colorName = null;
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) {
      color = hex;
      colorName = name;
      break;
    }
  }

  if (!color) return null;

  return { type: 'color', color, colorName };
}

/**
 * 解析大小调整指令
 */
function parseSizeChange(text) {
  if (!text.includes('大') && !text.includes('小') && !text.includes('放大') && !text.includes('缩小') && !text.includes('尺寸')) {
    return null;
  }

  let factor = 1;
  if (text.includes('大') || text.includes('放大')) {
    if (text.includes('很多') || text.includes('两倍') || text.includes('一倍')) {
      factor = 2.0;
    } else if (text.includes('一半')) {
      factor = 1.5;
    } else {
      factor = 1.2; // 默认放大 20%
    }
  } else if (text.includes('小') || text.includes('缩小')) {
    if (text.includes('很多') || text.includes('一半') || text.includes('两倍')) {
      factor = 0.5;
    } else {
      factor = 0.8; // 默认缩小 20%
    }
  }

  return { type: 'resize', factor };
}

/**
 * 解析移动指令
 */
function parseMove(text) {
  if (!text.includes('移') && !text.includes('动') && !text.includes('到')) {
    return null;
  }

  const movement = parseMovement(text);
  if (!movement) return null;

  return { type: 'move', ...movement };
}

/**
 * 解析 "再..." 微调指令
 */
function parseRefine(text) {
  const lastAction = store.state.lastAction;
  if (!lastAction) {
    return { type: 'unknown', text: '没有上一步操作可以微调' };
  }

  // 复制上一步操作类型
  const refined = { ...lastAction, type: 'refine', originalText: text };

  // 如果文本中包含新的参数，覆盖
  if (text.includes('大') || text.includes('放大')) {
    refined.factor = 1.1;
  } else if (text.includes('小') || text.includes('缩小')) {
    refined.factor = 0.9;
  }

  // 方向微调
  const movement = parseMovement(text);
  if (movement) {
    refined.dx = movement.dx;
    refined.dy = movement.dy;
    refined.distance = 15; // 微调步长更小
  }

  return refined;
}

/**
 * 解析复合指令
 */
function parseCompound(text) {
  const separators = ['先', '然后', '接着', '再', '最后'];
  let hasSeparator = false;
  for (const sep of separators) {
    if (text.includes(sep)) {
      hasSeparator = true;
      break;
    }
  }

  if (!hasSeparator) return null;

  // 简单按分隔符拆分
  const parts = text.split(/先|然后|接着|再|最后/).filter((s) => s.trim().length > 0);
  if (parts.length < 2) return null;

  const subTasks = parts.map((part) => parseCommand(part.trim()));
  if (subTasks.some((t) => !t || t.type === 'unknown')) {
    return null; // 有无法解析的子任务
  }

  return {
    type: 'compound',
    tasks: subTasks,
  };
}

/**
 * 实时关键词检测（用于预渲染）
 * 在用户说话过程中检测关键词，触发视觉反馈
 */
export function detectKeywords(text) {
  const keywords = { color: null, colorName: null, shape: null, size: null, position: null, isDrawIntent: false };

  // 检测绘制意图（"画/绘画/绘制/画一个/画一个...的"）
  const drawIntentWords = ['画', '绘画', '绘制', '添加', '新增', '创建'];
  keywords.isDrawIntent = drawIntentWords.some((w) => text.includes(w));

  // 检测颜色
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) {
      keywords.color = hex;
      keywords.colorName = name;
      break;
    }
  }

  // 检测形状
  const shapeMap = {
    '圆': '圆形', '矩形': '矩形', '方形': '方形', '方块': '方块',
    '直线': '直线', '线': '直线', '三角形': '三角形', '三角': '三角形',
    '星': '星形', '星星': '星形', '椭圆': '椭圆',
  };
  for (const [key, value] of Object.entries(shapeMap)) {
    if (text.includes(key)) {
      keywords.shape = value;
      break;
    }
  }

  // 检测大小
  if (text.includes('大') || text.includes('放大')) keywords.size = 'large';
  else if (text.includes('小') || text.includes('缩小')) keywords.size = 'small';

  // 检测位置
  const pos = parsePosition(text);
  if (pos) keywords.position = pos;

  return keywords;
}
