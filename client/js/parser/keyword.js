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
  // 注意：若同时含有绘制动词+形状（如"再画一个圆"），优先走 parseDraw，
  // 否则 parseRefine 会静默失败（_execRefine 不处理 draw 类型）
  if (text.startsWith('再') || text.startsWith('继续')) {
    const drawVerbs = ['画', '绘制', '绘画', '新建', '创建', '添加', '生成', '来个', '来一个'];
    const hasDrawVerb = drawVerbs.some((v) => text.includes(v));
    if (!hasDrawVerb) return parseRefine(text);
    // 有绘制动词时，跳过 parseRefine，让 parseDraw 处理
  }

  // 8. 选中指令
  const selectResult = parseSelect(text);
  if (selectResult) return selectResult;

  // 8.5 删除指令
  const deleteResult = parseDelete(text);
  if (deleteResult) return deleteResult;

  // 9. 颜色修改指令
  const colorResult = parseColorChange(text);
  if (colorResult) return colorResult;

  // 10. 图形绘制指令（必须在大小调整前，防止"画一个大一点的圆"被误判为 resize）
  const drawResult = parseDraw(text);
  if (drawResult) return drawResult;

  // 11. 大小调整指令
  const sizeResult = parseSizeChange(text);
  if (sizeResult) return sizeResult;

  // 12. 位置移动指令
  const moveResult = parseMove(text);
  if (moveResult) return moveResult;

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
  // 匹配形状关键词（有序数组：长词/复合词优先，避免"椭圆形"被"圆"、"三角形"被"三角"误匹配）
  const shapeKeywords = [
    ['ellipse',  ['椭圆形', '椭圆']],
    ['triangle', ['三角形', '三角']],
    ['rect',     ['矩形', '长方形', '正方形', '方形', '方块']],
    ['line',     ['直线', '线段', '线条', '线']],
    ['star',     ['五角星', '星形', '星星']],
    ['circle',   ['圆形', '圆圈', '圆']],
  ];

  let shapeType = null;
  for (const [type, keywords] of shapeKeywords) {
    if (keywords.some((kw) => text.includes(kw))) {
      shapeType = type;
      break;
    }
  }

  if (!shapeType) return null;

  // 必须包含明确的绘制动词才触发
  const drawVerbs = ['画', '绘制', '绘画', '新建', '创建', '添加', '生成', '来个', '来一个', '整个', '整一个', '加个', '加一个', '做个', '做一个', '弄个', '弄一个'];
  if (!drawVerbs.some((v) => text.includes(v))) return null;

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
 * 将中文数字转为阿拉伯数字（支持 一~二十）
 */
function chineseNumToInt(str) {
  const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20 };
  return map[str] ?? null;
}

/**
 * 从文本中提取编号（支持阿拉伯数字和中文数字）
 * 匹配：3号 / 三号 / 第3个 / 第三个
 */
function extractNumber(text) {
  // 阿拉伯数字：3号 / 第3个 / 第3号
  const arabicMatch = text.match(/第\s*(\d+)|(\d+)\s*号/);
  if (arabicMatch) return parseInt(arabicMatch[1] ?? arabicMatch[2]);

  // 中文数字：三号 / 第三个 / 第三号
  // 注意：中文数字 Unicode 码点不连续，必须用枚举而非范围 [一-九]
  const CN = '[一二三四五六七八九]';
  const chineseMatch = text.match(
    new RegExp(`第\\s*(二十|十${CN}|${CN}十?|十)\\s*[个号]?|(二十|十${CN}|${CN}|十)\\s*号`)
  );
  if (chineseMatch) {
    const raw = chineseMatch[1] ?? chineseMatch[2];
    return chineseNumToInt(raw);
  }

  return null;
}

/**
 * 从操作指令文本中提取目标对象（"将1号…" / "把三号…"）
 * 返回 { type: 'id', value: n } 或 null（未指定，使用当前选中）
 */
function extractTarget(text) {
  const num = extractNumber(text);
  if (num !== null) return { type: 'id', value: num };
  return null;
}

/**
 * 解析选中指令
 */
function parseSelect(text) {
  // "选中3号" / "选中三号" / "第2个" / "第二个"
  const num = extractNumber(text);
  if (num !== null) {
    const hasSelectVerb = text.includes('选中') || text.includes('选择') || text.includes('点击');
    // 含有操作动词（移/改/放大等）但无选中词 → 这是针对目标的操作指令，不是选中指令
    // 交给 parseMove / parseColorChange / parseSizeChange 处理（它们会通过 extractTarget 获取目标）
    const hasActionVerb = ['移', '放大', '缩小', '变大', '变小', '改成', '变成', '换成', '调成', '删除', '删掉', '移除', '去掉', '擦掉', '擦除'].some((v) => text.includes(v));
    if (hasActionVerb && !hasSelectVerb) {
      // 不拦截，让操作解析器处理
    } else {
      return { type: 'select', target: { type: 'id', value: num } };
    }
  }

  // "选中红色的圆"
  if (text.includes('选中') || text.includes('选择') || text.includes('点击')) {
    // 提取形状
    let shapeType = null;
    const shapeKeywords = [
      ['ellipse',  ['椭圆形', '椭圆']],
      ['triangle', ['三角形', '三角']],
      ['rect',     ['矩形', '方形', '方块']],
      ['line',     ['直线', '线']],
      ['star',     ['星形', '星星', '星']],
      ['circle',   ['圆形', '圆']],
    ];
    for (const [type, keywords] of shapeKeywords) {
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
 * 解析删除指令
 * "删除1号" / "删掉三号" / "删除它" / "删除选中的" / "删除" (删当前选中)
 */
function parseDelete(text) {
  const deleteVerbs = ['删除', '删掉', '移除', '去掉', '擦掉', '擦除'];
  if (!deleteVerbs.some((v) => text.includes(v))) return null;

  // 提取目标编号
  const target = extractTarget(text);
  return { type: 'delete', target };
}

/**
 * 解析颜色修改指令
 * 必须包含明确的修改动词，避免绘制/描述指令误触发
 */
function parseColorChange(text) {
  // 必须包含颜色修改动词
  const colorChangeVerbs = ['改成', '变成', '换成', '调成', '改为', '变为', '换为', '改颜色', '变颜色', '换颜色', '换个', '改个', '颜色改', '颜色变', '颜色换', '改色', '变色', '换色', '修改颜色', '调整颜色'];
  if (!colorChangeVerbs.some((v) => text.includes(v))) return null;

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

  return { type: 'color', color, colorName, target: extractTarget(text) };
}

/**
 * 解析大小调整指令
 * 必须包含完整的缩放动词短语，避免"画一个大圆"等误触发
 */
function parseSizeChange(text) {
  // 放大类动词短语
  const enlargeVerbs = ['放大', '变大', '调大', '改大', '大一点', '大一些', '大很多', '增大', '扩大', '大两倍', '大一倍'];
  // 缩小类动词短语
  const shrinkVerbs = ['缩小', '变小', '调小', '改小', '小一点', '小一些', '小很多', '减小', '压缩', '小一半', '小两倍'];

  const isEnlarge = enlargeVerbs.some((v) => text.includes(v));
  const isShrink = shrinkVerbs.some((v) => text.includes(v));

  if (!isEnlarge && !isShrink) return null;

  let factor = 1;
  if (isEnlarge) {
    if (text.includes('很多') || text.includes('两倍') || text.includes('一倍') || text.includes('扩大')) {
      factor = 2.0;
    } else if (text.includes('一半')) {
      factor = 1.5;
    } else {
      factor = 1.2;
    }
  } else {
    if (text.includes('很多') || text.includes('一半') || text.includes('两倍') || text.includes('压缩')) {
      factor = 0.5;
    } else {
      factor = 0.8;
    }
  }

  return { type: 'resize', factor, target: extractTarget(text) };
}

/**
 * 解析移动指令
 * "移到X" / "移动到X" → 绝对位置移动 (moveTo)
 * "向/往X移一点" → 相对位移 (move)
 */
function parseMove(text) {
  const target = extractTarget(text);

  // 绝对位置移动："移到右上角" / "移动到中间"
  const isAbsolute = text.includes('移到') || text.includes('移动到');
  if (isAbsolute) {
    const position = parsePosition(text);
    if (position) return { type: 'moveTo', position, target };
    return null;
  }

  // 相对移动："向右移一点" / "往左下移动一些"
  // 只要求含 '移'，避免 '动' 误匹配"活动""运动"等无关词
  if (!text.includes('移')) return null;

  const movement = parseMovement(text);
  if (!movement) return null;

  return { type: 'move', ...movement, target };
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
 * 返回 { color, colorName, shape, size, position, hasDrawIntent }
 *
 * 只有检测到"绘制意图词"时 hasDrawIntent=true，才应触发预览生成。
 * 避免"将三角形往上移动"等操作指令误触发绘制预览。
 */
export function detectKeywords(text) {
  const keywords = { color: null, colorName: null, shape: null, size: null, position: null, hasDrawIntent: false };

  // 检测绘制意图（必须包含这些词才触发预览）
  const drawIntentWords = ['画', '绘制', '绘画', '新建', '创建', '添加', '加一个', '来一个', '画一个', '来个', '整一个'];
  keywords.hasDrawIntent = drawIntentWords.some((w) => text.includes(w));

  // 检测颜色
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) {
      keywords.color = hex;
      keywords.colorName = name;
      break;
    }
  }

  // 检测形状（从长到短匹配，避免"三角"优先于"三角形"）
  const shapeMap = [
    ['三角形', '三角形'], ['矩形', '矩形'], ['椭圆形', '椭圆'], ['椭圆', '椭圆'],
    ['方形', '方形'], ['方块', '方块'], ['直线', '直线'], ['三角', '三角形'],
    ['星星', '星形'], ['星形', '星形'], ['圆形', '圆形'], ['圆', '圆形'],
    ['线', '直线'], ['星', '星形'],
  ];
  for (const [key, value] of shapeMap) {
    if (text.includes(key)) {
      keywords.shape = value;
      break;
    }
  }

  // 检测大小
  if (text.includes('大') || text.includes('放大')) keywords.size = 'large';
  else if (text.includes('小') || text.includes('缩小')) keywords.size = 'small';

  // 检测位置（用于预览定位）
  const position = parsePosition(text);
  if (position) keywords.position = position;

  return keywords;
}
