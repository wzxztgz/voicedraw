/**
 * 关键词匹配指令解析引擎
 * 将语音识别文本解析为结构化指令
 */

import store from '../state/store.js';
import { createShape, COLOR_MAP, SHAPE_NAMES, colorToName } from '../canvas/shapes.js';
import { parseMovement, parsePosition, DIRECTION_MAP } from '../canvas/grid.js';

// ─── 形状关键词（长词优先，全局共用）────────────────────────
const SHAPE_KEYWORDS = [
  ['rounded-rect', ['圆角矩形', '圆角方块', '跑道形', '胶囊形']],
  ['diamond',      ['菱形', '钻石形']],
  ['ellipse',      ['椭圆形', '椭圆']],
  ['triangle',     ['三角形', '三角']],
  ['star',         ['五角星', '星形', '星星']],
  ['circle',       ['圆形', '圆圈', '圆']],
  ['rect',         ['矩形', '长方形', '正方形', '方形', '方块']],
  ['line',         ['直线', '线段', '线条', '线']],
];

/** 从文本解析基础形状类型（不含箭头线） */
function resolveShapeType(text) {
  for (const [type, keywords] of SHAPE_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) return type;
  }
  return null;
}

/**
 * 形状关键词误匹配黑名单
 * 单字关键词（如「圆」）容易误命中「花园」「花圆」「圆满」等非形状词
 */
const SHAPE_FALSE_POSITIVES = {
  circle: ['花园', '花圆', '圆满', '原理', '圆桌', '园区', '圆润', '圆滑'],
  line:   [],
  rect:   [],
  triangle: [],
  star:   [],
  ellipse: [],
  diamond: [],
  'rounded-rect': [],
};

/**
 * 严格版形状解析：单字关键词额外过滤误匹配词
 * 用于置信度评估 (_assessConfidence) 和 parseSelect 否定守卫
 */
function resolveShapeTypeStrict(text) {
  for (const [type, keywords] of SHAPE_KEYWORDS) {
    for (const kw of keywords) {
      if (!text.includes(kw)) continue;
      if (kw.length === 1) {
        const fps = SHAPE_FALSE_POSITIVES[type] || [];
        if (fps.some((fp) => text.includes(fp))) continue;
      }
      return type;
    }
  }
  return null;
}

const DRAW_VERBS = [
  '画', '绘制', '绘画', '新建', '创建', '添加', '生成',
  '来个', '来一个', '整个', '整一个', '加个', '加一个',
  '做个', '做一个', '弄个', '弄一个',
  '搞个', '搞一个', '要个', '要一个', '给我画', '给我一个',
  '帮我画', '帮我整', '帮我做', '搞出', '整出', '弄出',
  '来一', '整一', '画出', '弄一', '搞一',
  '一条线', '一根线', '画一条', '画一根',
];

function hasDrawVerb(text) {
  return DRAW_VERBS.some((v) => text.includes(v));
}

/** 预渲染用：长词优先，含箭头线 */
function detectShapeLabel(text) {
  const arrowDetect = [
    ['带箭头的线', '箭头线'], ['有箭头的线', '箭头线'], ['箭头直线', '箭头线'],
    ['箭头线', '箭头线'], ['箭头', '箭头线'],
  ];
  for (const [key, label] of arrowDetect) {
    if (text.includes(key)) return label;
  }
  const labelMap = {
    'rounded-rect': '圆角矩形', diamond: '菱形', ellipse: '椭圆',
    triangle: '三角形', star: '星形', circle: '圆形', rect: '矩形', line: '直线',
  };
  for (const [type, keywords] of SHAPE_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) return labelMap[type];
  }
  return null;
}

/** 解析「从 A 指向 B」端点（编号或九宫格方位） */
function parseDirectedEndpoints(text) {
  const m = text.match(/从\s*(.+?)\s*(?:指向|指到)\s*(.+)/);
  const m2 = !m && /画|绘制|一条线|一根线|箭头/.test(text)
    ? text.match(/从\s*(.+?)\s*到\s*(.+)/)
    : null;
  const seg = m || m2;
  if (!seg) return null;

  const fromStr = seg[1].trim();
  let toStr = seg[2].trim().replace(/(?:的)?(?:箭头线|箭头直线|箭头|线)\s*$/, '');

  let fromId = null;
  let toId = null;
  let fromPosition = null;
  let toPosition = null;

  const fromNum = extractNumber(fromStr.includes('号') ? fromStr : `${fromStr}号`);
  const toNum = extractNumber(toStr.includes('号') ? toStr : `${toStr}号`);
  if (fromNum !== null) fromId = fromNum;
  if (toNum !== null) toId = toNum;

  if (fromId === null) fromPosition = parsePosition(fromStr);
  if (toId === null) toPosition = parsePosition(toStr);

  if (fromId !== null || toId !== null || fromPosition || toPosition) {
    return { fromId, toId, fromPosition, toPosition };
  }
  return null;
}

/** 解析箭头朝向（向右/朝上等） */
function parseArrowDirection(text) {
  for (const [dir, vec] of Object.entries(DIRECTION_MAP)) {
    if (text.includes(dir) || text.includes(`朝${dir}`) || text.includes(`向${dir}`) || text.includes(`往${dir}`)) {
      return vec;
    }
  }
  if (/向右|朝右|往右/.test(text)) return { dx: 1, dy: 0 };
  if (/向左|朝左|往左/.test(text)) return { dx: -1, dy: 0 };
  if (/向上|朝上|往上/.test(text)) return { dx: 0, dy: -1 };
  if (/向下|朝下|往下/.test(text)) return { dx: 0, dy: 1 };
  return null;
}

/**
 * 解析箭头线绘制（须在普通直线之前）
 * 触发：画一个箭头 / 带箭头的线 / 从A指向B / 画一条从左上角指向右下角的线
 */
function parseArrowDraw(text) {
  const hasArrowWord = /箭头/.test(text) || (/带箭头|有箭头/.test(text) && /线|直线/.test(text));
  const endpoints = parseDirectedEndpoints(text);
  const hasDirected = !!endpoints;

  if (!hasArrowWord && !hasDirected) return null;
  // 连接两对象走 parseConnect，不在这里处理
  if (/连接|连线|连到|相连|连起来/.test(text)) return null;
  if (!hasDrawVerb(text) && !hasDirected) return null;

  let color = null;
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) { color = hex; break; }
  }

  const position = parsePosition(text);
  const direction = parseArrowDirection(text);

  return {
    type: 'draw',
    shape: 'arrow-line',
    color,
    position,
    direction,
    fromId: endpoints?.fromId ?? null,
    toId: endpoints?.toId ?? null,
    fromPosition: endpoints?.fromPosition ?? null,
    toPosition: endpoints?.toPosition ?? null,
  };
}

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
  // "清空"同音词（ASR 对 qīng kōng 的常见误识别）
  '晴空': '清空', '星空': '清空', '天空': '清空',
  // 颜色同音词
  '绿色': '绿色', '录色': '绿色', '陆色': '绿色',
  '红色': '红色', '洪色': '红色',
  '黄色': '黄色', '皇色': '黄色',
  // 操作动词同音词（ASR 常将「画」误识为挂/花）
  '画个': '画一个', '花一个': '画一个', '花个': '画一个',
  '挂一个': '画一个', '挂个': '画个',
  '零星': '菱形', '凌形': '菱形',
  '箭头': '箭头', '剑头': '箭头',
  '撤回': '撤销',
};

/**
 * 应用同音词纠错
 * 分两轮：先语境优先纠错（精准），再全局模糊替换（兜底）。
 * 语境纠错必须先于全局替换，防止「花园→花圆」后二次误匹配。
 */
function correctHomophones(text) {
  let corrected = text;

  // 第一轮：语境优先纠错
  // 「在N号+方位词」语境下，「花园/花一个」极大概率是「画圆/画一个」的 ASR 误识
  const relCtxRe = /在\s*[\d一二三四五六七八九十]+\s*号\s*的?\s*(?:右边|右方|右侧|右面|旁边|左边|左方|左侧|左面|上面|上方|上边|上侧|下面|下方|下边|下侧)/;
  if (relCtxRe.test(corrected)) {
    corrected = corrected.replace(/花园/g, '画圆').replace(/花一个/g, '画一个');
  }

  // 第二轮：全局模糊替换
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
/**
 * 复杂信号检测
 * 判断一句话在结构上是否属于「多动作复合指令」。
 * 返回 true 时上层会主动路由到 LLM，而不是等规则引擎误判成单条指令。
 *
 * 触发条件（满足任意一条）：
 *   1. 含复合分隔词（先/然后/接着/最后/并且/还要/之后）
 *   2. 句中出现 ≥2 个绘制动词（如"画…画…"）
 *   3. 句中出现 ≥2 种不同形状词（如同时含"圆"和"矩形"）
 *   4. 长句（>20字）且含至少一个绘制动词（口语化多步指令）
 *
 * 不触发：「再画一个圆」（以"再"开头的微调/续画），交给 parseRefine/parseDraw 处理。
 */
export function hasComplexSignal(text) {
  // 条件1：分隔词
  const separators = ['先', '然后', '接着', '最后', '并且', '还要', '之后', '随后', '紧接着', '接下来'];
  // "再"只在非句首时才算分隔词，以免误判"再大一点"
  if (separators.some((s) => text.includes(s))) return true;
  if (!text.startsWith('再') && text.includes('再')) return true;

  // 条件2：≥2 个绘制动词
  const drawVerbs = ['画', '绘制', '创建', '新建', '添加', '生成'];
  const drawVerbCount = drawVerbs.reduce((n, v) => n + (text.split(v).length - 1), 0);
  if (drawVerbCount >= 2) return true;

  // 条件3：≥2 种不同形状词（长词先掩码，避免「圆角矩形」误判为 圆+矩形）
  let shapeText = text;
  const compoundMasks = [
    '圆角矩形', '圆角方块', '跑道形', '胶囊形',
    '菱形', '钻石形', '椭圆形', '三角形', '五角星',
    '正方形', '长方形', '箭头线', '箭头直线', '带箭头的线', '有箭头的线',
  ];
  for (const m of compoundMasks) {
    shapeText = shapeText.split(m).join(' ');
  }
  const shapeWords = ['圆', '矩形', '方形', '方块', '直线', '线段', '三角', '星形', '星星', '椭圆', '菱形'];
  const matchedShapes = shapeWords.filter((s) => shapeText.includes(s));
  const uniqueShapes = new Set(matchedShapes.map((s) => {
    if (s === '方形' || s === '方块') return 'rect';
    if (s === '星形' || s === '星星') return 'star';
    if (s === '线段') return 'line';
    if (s === '菱形') return 'diamond';
    return s;
  }));
  if (uniqueShapes.size >= 2) return true;

  return false;
}

export function parseCommand(text) {
  const original = text;
  text = correctHomophones(text.trim().toLowerCase());

  console.log(`[Parser] 原始: "${original}" → 纠正: "${text}"`);

  // 0. LLM 复杂图形意图检测（图表/流程图/思维导图/复杂图形）
  //    满足条件就跳过后续所有硬解析，直接交给 LLM 处理
  const llmResult = parseLLMIntent(text, original);
  if (llmResult) return llmResult;

  // 0.5 关闭帮助面板（须在 help 检测之前，避免「关闭帮助」误触发打开）
  if (text.includes('关闭') || text.includes('关掉') || text === '关') {
    return { type: 'closeHelp' };
  }

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

  // 4. 导出图片
  if (text.includes('导出') || text.includes('保存图片') || text.includes('下载图片') || text.includes('导出图片')) {
    return { type: 'export' };
  }

  // 5. 清除画布
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

  // 6.5 复合指令（先...然后.../再...）
  // ★ 必须在 parseDraw 等单条解析之前，防止整句被单条规则"误判成功"。
  //   parseCompound 内部递归调 parseCommand 解析子句，不会二次进入此分支。
  //   "再..." 以句首开头时先让步骤 7 的 parseRefine 处理（微调/续画语义）。
  if (!text.startsWith('再') && !text.startsWith('继续')) {
    const compoundResult = parseCompound(text);
    if (compoundResult) return compoundResult;
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

  // 8.6 连线指令（"用线连接1号和3号" / "把2号连到4号"）
  const connectResult = parseConnect(text);
  if (connectResult) return connectResult;

  // 8.7 添加文字标注（"在2号右边加文字：已审批" / "写上标题"）
  const addTextResult = parseAddText(text);
  if (addTextResult) return addTextResult;

  // 8.8 修改文字内容（"把3号文字改成已完成"）—— 必须在颜色修改前，防止被拦截
  const modifyTextResult = parseModifyText(text);
  if (modifyTextResult) return modifyTextResult;

  // 8.9 批量指令（"画三个圆" / "把所有圆改成蓝色"）
  //     必须在单条 draw/color 之前，防止只解析出一个图形
  const batchResult = parseBatch(text);
  if (batchResult) return batchResult;

  // 8.95 形状变更指令（"改成矩形" / "换成圆形" / "变成三角形"）
  //      必须在颜色修改前，防止"改成红色"被误拦（颜色修改要求颜色词，互不冲突）
  const shapeChangeResult = parseShapeChange(text);
  if (shapeChangeResult) return shapeChangeResult;

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

  // 未识别
  return { type: 'unknown', text };
}

// 所有方位词（与 parseSide 保持一致），用于相对位置的高置信度判断
const SIDE_WORD_PATTERN = '右边|右方|右侧|右面|旁边|左边|左方|左侧|左面|上面|上方|上边|上侧|下面|下方|下边|下侧';
const SIDE_WORD_RE = new RegExp(SIDE_WORD_PATTERN);

// 相对位置主匹配正则：允许编号和方位词之间夹一个「的」字（ASR 常带出）
// 例：在1号右边 / 在1号的右边 / 在三号上面
const REL_MATCH_RE = new RegExp(
  `在\\s*(\\d+|[一二三四五六七八九十]+)\\s*号\\s*的?\\s*(${SIDE_WORD_PATTERN})`
);

/**
 * 全局歧义信号检测（基于纠错后文本）
 * 供 _assessConfidence 和 parseSelect 否定守卫使用，不影响规则解析逻辑本身。
 */
function detectAmbiguitySignals(text) {
  const hasNumberRef = /在\s*[\d一二三四五六七八九十]+\s*号|[\d一二三四五六七八九十]+\s*号/.test(text);
  const hasSideWord = SIDE_WORD_RE.test(text);
  return {
    hasRelativeContext: hasNumberRef && hasSideWord,
    hasDrawVerb: hasDrawVerb(text),
    hasShapeHint: resolveShapeTypeStrict(text) !== null,
    isLongSentence: text.length > 12,
    hasLocationPrefix: text.startsWith('在'),
  };
}

/**
 * 解析绘制指令
 *
 * 相对位置置信度规则：
 *   ① 文本含"在N号"且含方位词，但 REL_MATCH_RE 未匹配 → 低置信度，返回 null 降级 LLM
 *   ② REL_MATCH_RE 匹配但 parseSide 返回 null（方位词无法归类）→ 同上，返回 null 降级 LLM
 * 以上两种情况均不得静默 fallback 到绝对位置，以免「在1号的右边画圆」
 * 被误解析为九宫格的「右边」。
 */
function parseDraw(text) {
  const arrowCmd = parseArrowDraw(text);
  if (arrowCmd) return arrowCmd;

  const shapeType = resolveShapeTypeStrict(text);
  if (!shapeType) return null;
  if (!hasDrawVerb(text)) return null;

  let color = null;
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) { color = hex; break; }
  }

  let sizeModifier = null;
  const sizeText = text.replace(/大小|不大不小|合适大小|适中大小|适当大小/g, '');
  if (sizeText.includes('大') || sizeText.includes('巨')) sizeModifier = 'large';
  else if (sizeText.includes('小')) sizeModifier = 'small';

  // ── 相对位置解析（高置信度检测）──────────────────────────────
  const hasNumberRef = /在\s*[\d一二三四五六七八九十]+\s*号/.test(text);
  const hasSideWord = SIDE_WORD_RE.test(text);

  const relMatch = REL_MATCH_RE.exec(text);

  // ① 明显尝试了相对位置但正则未能精确匹配 → 降级 LLM
  if (hasNumberRef && hasSideWord && !relMatch) return null;

  let relativeToId = null;
  let relativeSide = null;
  if (relMatch) {
    const numStr = relMatch[1];
    relativeToId = parseInt(numStr) || chineseNumToInt(numStr);
    relativeSide = parseSide(relMatch[2]);
    // ② 方位词识别失败（parseSide 兜底不到已知方向）→ 降级 LLM
    if (!relativeSide) return null;
  }

  const position = relativeToId ? null : parsePosition(text);

  return {
    type: 'draw',
    shape: shapeType,
    color,
    sizeModifier,
    position,
    relativeToId,
    relativeSide,
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
 *
 * 置信度策略：「有编号」≠「想选中」，必须结合语境。
 * 三重否定守卫拦截高风险歧义句，避免「在一号右边花园」被误判为选中 1 号。
 */
function parseSelect(text) {
  const num = extractNumber(text);
  if (num === null) return null;

  const hasSelectVerb = text.includes('选中') || text.includes('选择') || text.includes('点击');

  // ── 三重否定守卫：以下情况即使含编号也不默认选中 ──────────────
  if (!hasSelectVerb) {
    // ① 「在N号+方位词」→ 明显是相对绘制/标注意图（如「在一号右边花园」）
    const hasRelCtx = /在\s*[\d一二三四五六七八九十]+\s*号/.test(text) && SIDE_WORD_RE.test(text);
    if (hasRelCtx) return null;

    // ② 含形状词（严格版，过滤「花园→圆」等误匹配）→ 可能是绘制意图
    if (resolveShapeTypeStrict(text) !== null) return null;

    // ③ 以「在」开头的长句（≥8字）→ 描述性语境，绝非选中
    if (text.startsWith('在') && text.length >= 8) return null;

    // ④ 含操作动词 → 交给对应解析器处理
    const hasActionVerb = [
      '移', '放大', '缩小', '变大', '变小',
      '改成', '变成', '换成', '改为', '变为', '换为', '调成', '修改', '调整',
      '删除', '删掉', '移除', '去掉', '擦掉', '擦除',
      '连接', '连线', '连到', '相连',
      '画', '绘制', '新建', '创建',
      '加文字', '添加文字', '写上', '标注',
      '将', '把',
    ].some((v) => text.includes(v));
    if (hasActionVerb) return null;
  }
  // ──────────────────────────────────────────────────────────────

  return { type: 'select', target: { type: 'id', value: num } };
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
 * 提取文本中所有编号（阿拉伯数字 + 中文数字）
 * 用于连线等需要两个 ID 的指令
 */
function extractAllNumbers(text) {
  const results = [];
  const seen = new Set();

  const arabicRe = /(?:第\s*(\d+)|(\d+)\s*号)/g;
  let m;
  while ((m = arabicRe.exec(text)) !== null) {
    const n = parseInt(m[1] ?? m[2]);
    if (!seen.has(n)) { seen.add(n); results.push(n); }
  }

  const CN = '[一二三四五六七八九]';
  const chRe = new RegExp(`(?:第\\s*(二十|十${CN}|${CN}十?|十)\\s*[个号]?|(二十|十${CN}|${CN}|十)\\s*号)`, 'g');
  while ((m = chRe.exec(text)) !== null) {
    const raw = m[1] ?? m[2];
    const n = chineseNumToInt(raw);
    if (n !== null && !seen.has(n)) { seen.add(n); results.push(n); }
  }
  return results;
}

/**
 * 提取方位词（用于相对位置描述和文字标注定位）
 */
/**
 * 提取方位词
 * 无明确方位时返回 null（由调用方决定默认行为）
 * parseDraw 的相对位置匹配在 regex 里已确保有方位词，不受影响
 */
function parseSide(text) {
  if (text.includes('右边') || text.includes('右方') || text.includes('右侧') || text.includes('右面') || text.includes('旁边')) return 'right';
  if (text.includes('左边') || text.includes('左方') || text.includes('左侧') || text.includes('左面')) return 'left';
  if (text.includes('上面') || text.includes('上方') || text.includes('上边') || text.includes('上侧')) return 'above';
  if (text.includes('下面') || text.includes('下方') || text.includes('下边') || text.includes('下侧')) return 'below';
  // 无明确方位 → 返回 null（文字标注默认居中到图形内部）
  return null;
}

/**
 * 解析连线指令
 * "用线连接1号和3号" / "把2号连到4号" / "连接1号和2号"
 */
function parseConnect(text) {
  const connectVerbs = ['连接', '连线', '连到', '相连', '连起来', '串联', '连上'];
  if (!connectVerbs.some((v) => text.includes(v))) return null;

  const nums = extractAllNumbers(text);
  if (nums.length < 2) return null;

  return { type: 'connect', fromId: nums[0], toId: nums[1] };
}

/**
 * 解析添加文字标注指令
 * "在2号右边加文字：已审批" / "写上标题" / "标注完成"
 */
function parseAddText(text) {
  const textVerbs = ['加文字', '添加文字', '写上', '标注', '加标注', '加注', '添加注释', '加一段文字', '写文字'];
  if (!textVerbs.some((v) => text.includes(v))) return null;

  // 提取内容：冒号后的文字优先，否则取动词之后的内容
  let content = '';
  const colonMatch = text.match(/[：:]\s*(.+)$/);
  if (colonMatch) {
    content = colonMatch[1].trim();
  } else {
    for (const verb of textVerbs) {
      const idx = text.indexOf(verb);
      if (idx !== -1) {
        content = text.slice(idx + verb.length).replace(/^[的说叫：:，,\s]+/, '').trim();
        break;
      }
    }
  }
  if (!content) return null;

  // 提取关联对象编号（冒号/内容前的编号）
  const searchZone = colonMatch ? text.slice(0, text.lastIndexOf('：') === -1 ? text.lastIndexOf(':') : text.lastIndexOf('：')) : text;
  const refId = extractNumber(searchZone);

  // 提取方位
  const side = parseSide(text);

  // 绝对位置（无关联对象时使用）
  const position = !refId ? parsePosition(text) : null;

  return { type: 'addText', content, refId, side, position };
}

/**
 * 解析文字内容修改指令
 * "把3号文字改成已完成" / "修改3号的字：新内容" / "3号文字换成待审核"
 * 要求：含"文字"/"字"关键词 + 目标编号 + 修改动词 + 新内容
 */
function parseModifyText(text) {
  // 必须含"文字"或"字体"，与颜色改变指令区分
  if (!text.includes('文字') && !text.includes('字体') && !text.includes('文本')) return null;

  const modVerbs = ['改成', '变成', '换成', '改为', '变为', '替换成', '替换为', '修改成', '改'];
  if (!modVerbs.some((v) => text.includes(v))) return null;

  const refId = extractNumber(text);
  if (!refId) return null;

  // 提取新内容：冒号后优先，其次取动词之后
  let content = '';
  const colonMatch = text.match(/[：:]\s*(.+)$/);
  if (colonMatch) {
    content = colonMatch[1].trim();
  } else {
    for (const verb of modVerbs) {
      const idx = text.indexOf(verb);
      if (idx !== -1) {
        content = text.slice(idx + verb.length).replace(/^[的说叫，,\s]+/, '').trim();
        if (content) break;
      }
    }
  }
  if (!content) return null;

  return { type: 'modifyText', refId, content };
}

/**
 * 解析颜色修改指令
 * 必须包含明确的修改动词，避免绘制/描述指令误触发
 */
function parseColorChange(text) {
  // 必须包含颜色修改动词
  const colorChangeVerbs = [
    '改成', '变成', '换成', '调成', '改为', '变为', '换为',
    '改颜色', '变颜色', '换颜色', '换个', '改个',
    '颜色改', '颜色变', '颜色换',
    '改色', '变色', '换色', '修改颜色', '调整颜色',
    // 口语化扩充
    '涂成', '刷成', '染成', '填成', '给它变', '弄成', '整成',
    // "将1号改为红色" / "把颜色改为蓝色"
    '将', '把',
  ];
  // 含"将/把"时须同时含变更动词，避免"把圆画大"误触发
  const hasChangeVerb = ['改成', '变成', '换成', '改为', '变为', '换为', '调成',
    '涂成', '刷成', '染成', '弄成', '整成', '改色', '变色', '换色'].some((v) => text.includes(v));
  const hasSetPrefix = text.includes('将') || text.includes('把');
  const matchedVerb = colorChangeVerbs.some((v) => text.includes(v));
  if (!matchedVerb) return null;
  if (hasSetPrefix && !hasChangeVerb) return null;

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
  // 含绘制动词时可能是「画一个大圆」等描述句，不是缩放指令
  if (hasDrawVerb(text)) return null;

  // 放大类动词短语
  const enlargeVerbs = [
    '放大', '变大', '调大', '改大', '大一点', '大一些', '大很多',
    '增大', '扩大', '大两倍', '大一倍',
    // 口语化扩充
    '弄大', '整大', '搞大', '大点', '大些',
  ];
  // 缩小类动词短语
  const shrinkVerbs = [
    '缩小', '变小', '调小', '改小', '小一点', '小一些', '小很多',
    '减小', '压缩', '小一半', '小两倍',
    // 口语化扩充
    '弄小', '整小', '搞小', '小点', '小些',
  ];

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

  // 如果文本中指定了新的目标 ID（如"再把1号移到右边"），覆盖 target
  const explicitTarget = extractTarget(text);
  if (explicitTarget) {
    refined.target = explicitTarget;
  }

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
 * 解析批量指令
 * 支持两类：
 *   1. 批量绘制：画三个圆 / 画两个矩形
 *   2. 批量颜色：把所有圆改成蓝色 / 全部改成红色
 */
function parseBatch(text) {
  // ── 批量绘制 ──────────────────────────────
  // 数字词 → 数量
  const countMap = {
    '两': 2, '二': 2, '2': 2,
    '三': 3, '3': 3,
    '四': 4, '4': 4,
    '五': 5, '5': 5,
    '六': 6, '6': 6,
  };

  const drawVerbs = ['画', '绘制', '新建', '创建', '生成', '来', '整', '搞', '加'];
  const hasDrawVerb = drawVerbs.some((v) => text.includes(v));

  if (hasDrawVerb) {
    for (const [word, count] of Object.entries(countMap)) {
      if (!text.includes(word)) continue;

      // 确保数字词后面紧跟"个/条"等量词（避免误匹配"二月"等）
      const qtyRe = new RegExp(`${word}\\s*[个条枚张根]`);
      if (!qtyRe.test(text)) continue;

      const shapeType = resolveShapeTypeStrict(text);
      if (!shapeType) continue;

      let color = null;
      for (const [name, hex] of Object.entries(COLOR_MAP)) {
        if (text.includes(name)) { color = hex; break; }
      }

      return { type: 'batch-draw', shape: shapeType, color, count };
    }
  }

  // ── 批量颜色 ──────────────────────────────
  const batchColorWords = ['所有', '全部', '全都', '都', '每个', '每一个'];
  const hasBatchWord = batchColorWords.some((w) => text.includes(w));
  if (!hasBatchWord) return null;

  // 必须包含颜色修改动词
  const colorChangeVerbs = ['改成', '变成', '换成', '调成', '改为', '变为', '涂成', '刷成', '染成', '弄成', '整成'];
  if (!colorChangeVerbs.some((v) => text.includes(v))) return null;

  let color = null;
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) { color = hex; break; }
  }
  if (!color) return null;

  const filterShape = resolveShapeTypeStrict(text);

  return { type: 'batch-color', color, filterShape };
}

/** 复合指令分隔符（规则快路径与 parseCompound 共用） */
const COMPOUND_SEPARATORS = ['先', '然后', '接着', '最后', '并且', '还要', '之后'];
const COMPOUND_SPLIT_RE = /先|然后|接着|最后|并且|还要|之后|(?<!^)再/;

/** 文本是否含复合分隔词（不含 hasComplexSignal 的「双绘制动词」等条件） */
function hasCompoundSeparator(text) {
  if (COMPOUND_SEPARATORS.some((s) => text.includes(s))) return true;
  if (!text.startsWith('再') && !text.startsWith('继续') && text.includes('再')) return true;
  return false;
}

/** 按分隔符拆分子句 */
function splitCompoundParts(text) {
  return text.split(COMPOUND_SPLIT_RE).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * 复合指令规则快路径（供 _processCommand 在 hasComplexSignal 之前调用）
 * 仅当每个子句 parseCommandWithConfidence 均为 high 时才返回 compound。
 * 任一子句低置信 → 返回 null，交给 hasComplexSignal / LLM 处理。
 */
export function parseCompoundRules(rawText) {
  const text = correctHomophones(rawText.trim().toLowerCase());
  if (!hasCompoundSeparator(text)) return null;
  if (text.startsWith('再') || text.startsWith('继续')) return null;

  const parts = splitCompoundParts(text);
  if (parts.length < 2) return null;

  const results = parts.map((part) => parseCommandWithConfidence(part));
  const allHigh = results.every(
    (r) => r.confidence === 'high' && r.command && r.command.type !== 'unknown',
  );
  if (!allHigh) return null;

  return {
    command: { type: 'compound', tasks: results.map((r) => r.command), skipped: [] },
    confidence: 'high',
  };
}

/**
 * 解析复合指令（规则慢路径，允许跳过 unknown 子句）
 */
function parseCompound(text) {
  if (!hasCompoundSeparator(text)) return null;

  const parts = splitCompoundParts(text);
  if (parts.length < 2) return null;

  const subTasks = parts.map((part) => parseCommand(part));

  const validTasks = [];
  const skipped = [];
  parts.forEach((part, i) => {
    const cmd = subTasks[i];
    if (cmd && cmd.type !== 'unknown') {
      validTasks.push(cmd);
    } else {
      skipped.push(part);
    }
  });

  if (validTasks.length < 1) return null;

  return {
    type: 'compound',
    tasks: validTasks,
    skipped,
  };
}

/**
 * 解析形状变更指令
 * "改成矩形" / "把圆换成三角形" / "变成椭圆"
 * 要求：含变更动词 + 形状关键词；不含绘制动词（避免与 parseDraw 冲突）
 */
function parseShapeChange(text) {
  const changeVerbs = ['改成', '变成', '换成', '改为', '变为', '换为', '换个形', '改个形'];
  if (!changeVerbs.some((v) => text.includes(v))) return null;

  let shape = resolveShapeTypeStrict(text);
  // 形状变更：箭头线
  if (!shape && /箭头线|箭头直线|带箭头的线|有箭头的线|箭头/.test(text)) {
    shape = 'arrow-line';
  }
  if (!shape) return null;

  const drawVerbs = ['画', '绘制', '绘画', '新建', '创建', '添加', '生成'];
  if (drawVerbs.some((v) => text.includes(v))) return null;

  // 可选：同时指定新颜色（"改成红色矩形"）
  let color = null;
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) { color = hex; break; }
  }

  return { type: 'shapeChange', shape, color, target: extractTarget(text) };
}

/**
 * LLM 意图检测
 * 复杂图形（流程图/图表/思维导图等）优先走 LLM 生成。
 * 明确图表类型词（如「流程图」）即使缺少绘制动词（ASR 漏识/误识「画」）也应触发。
 */
function parseLLMIntent(text, original) {
  const prompt = original || text;

  // 明确图表/导图类型：不依赖绘制动词（覆盖「请假流程图」「挂一个请假流程图」等）
  const explicitDiagramTypes = [
    '柱状图', '折线图', '饼图', '条形图', '曲线图', '趋势图',
    '流程图', '思维导图', '脑图', '导图',
  ];
  if (explicitDiagramTypes.some((k) => text.includes(k))) {
    return { type: 'llm-draw', prompt };
  }

  const softLLMShapes = [
    '流程',                      // "请假审批流程" 不带「图」字
  ];
  const drawVerbs = [
    '画', '绘制', '生成', '创建', '新建', '做个', '来一个', '整一个', '帮我画',
    '搞个', '搞一个', '要个', '要一个', '给我画', '帮我整', '帮我做',
    '挂', '挂一个', '挂个',     // ASR 将「画」误识为「挂」
  ];

  const hasLLMShape = softLLMShapes.some((k) => text.includes(k));
  // ASR 将「画一个」误识为「换一个」：仅在含流程/图表语境时视为绘制意图
  const swapAsDraw = /换一个|换个|换一/.test(text) && hasLLMShape;
  const hasDrawVerb = drawVerbs.some((v) => text.includes(v)) || swapAsDraw;

  if (hasLLMShape && hasDrawVerb) {
    return { type: 'llm-draw', prompt };
  }
  return null;
}

/**
 * 置信度评估（仅供 parseCommandWithConfidence 内部调用）
 *
 * 规则：
 *   'high' → 规则直接执行，不走 LLM，<5ms，0 token
 *   'low'  → 转交 LLM 兜底解析
 *
 * 只对容易误判的 select / draw / color / resize 做额外信号校验；
 * 其他类型有明确触发词，匹配即高置信。
 */
function _assessConfidence(command, signals) {
  if (!command || command.type === 'unknown') return 'low';

  switch (command.type) {
    case 'llm-draw':
      return 'high'; // parseLLMIntent 明确触发，直接信任

    case 'select':
      // parseSelect 已加三重否定守卫，能走到这里置信度足够
      return 'high';

    case 'draw':
      if (command.shape === 'arrow-line') return 'high';
      if (command.relativeToId && command.relativeSide) return 'high';
      // 标准绘制：严格形状解析 + 绘制动词同时命中才算高置信
      if (signals.hasDrawVerb && signals.hasShapeHint) return 'high';
      return 'low';

    case 'color':
      // 含绘制动词时，可能是「画一个红色圆」被误分类
      if (signals.hasDrawVerb) return 'low';
      return 'high';

    case 'resize':
      // parseSizeChange 已有 hasDrawVerb 前置守卫，这里作双保险
      if (signals.hasDrawVerb) return 'low';
      return 'high';

    // 以下类型有明确触发词，匹配即高置信
    case 'move':
    case 'moveTo':
    case 'delete':
    case 'connect':
    case 'addText':
    case 'modifyText':
    case 'shapeChange':
    case 'batch-draw':
    case 'batch-color':
    case 'compound':
    case 'refine':
    case 'undo':
    case 'redo':
    case 'clear':
    case 'export':
    case 'help':
    case 'closeHelp':
    case 'confirm':
    case 'cancel':
      return 'high';

    default:
      return 'low';
  }
}

/**
 * 带置信度的主解析入口（供 _processCommand 使用）
 *
 * 在规则解析结果上叠加置信度评估：
 *   confidence === 'high' → 规则直接执行（<5ms，0 LLM token）
 *   confidence !== 'high' → 转交 LLM 兜底（含语义理解）
 *
 * @param {string} rawText 原始 ASR 文本
 * @returns {{ command: object, confidence: 'high'|'low', signals: object }}
 */
export function parseCommandWithConfidence(rawText) {
  const normalized = correctHomophones(rawText.trim().toLowerCase());
  const signals = detectAmbiguitySignals(normalized);
  const command = parseCommand(rawText);
  const confidence = _assessConfidence(command, signals);

  console.log('[Parser]', {
    text: normalized,
    type: command?.type,
    confidence,
    relCtx: signals.hasRelativeContext,
    drawVerb: signals.hasDrawVerb,
    shapeHint: signals.hasShapeHint,
  });

  return { command, confidence, signals };
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
  const keywords = {
    color: null, colorName: null, shape: null, size: null,
    position: null, relativeToId: null, relativeSide: null,
    hasDrawIntent: false,
  };

  const drawIntentWords = [
    '画', '绘制', '绘画', '新建', '创建', '添加',
    '加一个', '来一个', '画一个', '来个', '整一个',
    '搞个', '搞一个', '要个', '要一个', '给我画', '给我一个', '帮我画',
    '一条线', '一根线', '画一条', '画一根', '箭头',
  ];
  keywords.hasDrawIntent = drawIntentWords.some((w) => text.includes(w))
    || /从.+指向/.test(text);

  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (text.includes(name)) {
      keywords.color = hex;
      keywords.colorName = name;
      break;
    }
  }

  // 严格形状识别，避免「花园」等误触发预览
  const strictType = resolveShapeTypeStrict(text);
  if (strictType) {
    const labelMap = {
      circle: '圆形', rect: '矩形', line: '直线', triangle: '三角形',
      star: '星形', ellipse: '椭圆', diamond: '菱形', 'rounded-rect': '圆角矩形',
    };
    keywords.shape = labelMap[strictType] || detectShapeLabel(text);
  }

  if (text.includes('大') || text.includes('放大')) keywords.size = 'large';
  else if (text.includes('小') || text.includes('缩小')) keywords.size = 'small';

  // 相对位置优先于九宫格绝对位置
  const relMatch = REL_MATCH_RE.exec(text);
  if (relMatch) {
    const numStr = relMatch[1];
    const relativeToId = parseInt(numStr) || chineseNumToInt(numStr);
    const relativeSide = parseSide(relMatch[2]);
    if (relativeToId && relativeSide) {
      keywords.relativeToId = relativeToId;
      keywords.relativeSide = relativeSide;
    }
  } else {
    const position = parsePosition(text);
    if (position) keywords.position = position;
  }

  return keywords;
}
