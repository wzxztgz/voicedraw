/**
 * 图形类定义
 * 每种图形的创建、绘制、碰撞检测方法
 */

/**
 * 创建图形对象
 * @param {string} type - 图形类型
 * @param {object} options - 图形参数
 * @returns {object} 图形对象
 */
export function createShape(type, options = {}) {
  const defaults = {
    circle:   { type: 'circle',   x: 400, y: 300, radius: 50, color: '#FF6B6B', lineWidth: 2 },
    rect:     { type: 'rect',     x: 350, y: 250, width: 100, height: 80, color: '#4ECDC4', lineWidth: 2 },
    line:     { type: 'line',     x: 300, y: 300, x2: 500, y2: 300, color: '#45B7D1', lineWidth: 3 },
    triangle: { type: 'triangle', x: 400, y: 250, size: 60, color: '#96CEB4', lineWidth: 2 },
    star:     { type: 'star',     x: 400, y: 300, size: 40, color: '#FFEAA7', lineWidth: 2 },
    ellipse:  { type: 'ellipse',  x: 400, y: 300, rx: 80, ry: 50, color: '#DDA0DD', lineWidth: 2 },
    // ── LLM 图形新增类型 ──────────────────────────────────
    text:         { type: 'text',         x: 400, y: 300, content: '', fontSize: 14, color: '#333333', textAlign: 'center' },
    arc:          { type: 'arc',          x: 400, y: 300, radius: 120, startAngle: 0, endAngle: Math.PI, color: '#45B7D1', lineWidth: 2 },
    diamond:      { type: 'diamond',      x: 400, y: 300, width: 120, height: 60, color: '#FFEAA7', lineWidth: 2 },
    'rounded-rect': { type: 'rounded-rect', x: 400, y: 300, width: 140, height: 52, color: '#96CEB4', lineWidth: 2 },
  };

  const base = defaults[type] || defaults.circle;
  return { ...base, ...options };
}

/**
 * 在 Canvas 上绘制图形
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} shape - 图形对象
 * @param {boolean} isPreview - 是否为预览模式
 *
 * 预览阶段（shape._stage）：
 *   1 = 仅位置已知 → 红色虚线定位圆，高透明度
 *   2 = 颜色/部分信息已知 → 彩色虚线圆，中等透明度
 *   3 = 形状确认 → 实线实体，轻微透明度
 */
export function drawShape(ctx, shape, isPreview = false) {
  ctx.save();

  if (isPreview) {
    const stage = shape._stage || 2;
    if (stage === 1) {
      ctx.globalAlpha = 0.30;
      ctx.setLineDash([6, 4]);
    } else if (stage === 2) {
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([8, 4]);
    } else {
      // 阶段3：形状已确认，实线但保留轻微透明感
      ctx.globalAlpha = 0.82;
      ctx.setLineDash([]);
    }
  }

  ctx.strokeStyle = shape.color || '#333';
  ctx.fillStyle = shape.color || '#333';
  ctx.lineWidth = shape.lineWidth || 2;

  switch (shape.type) {
    case 'circle':
      drawCircle(ctx, shape);
      break;
    case 'rect':
      drawRect(ctx, shape);
      break;
    case 'line':
      drawLine(ctx, shape);
      break;
    case 'triangle':
      drawTriangle(ctx, shape);
      break;
    case 'star':
      drawStar(ctx, shape);
      break;
    case 'ellipse':
      drawEllipse(ctx, shape);
      break;
    case 'text':
      drawText(ctx, shape);
      break;
    case 'arc':
      drawArc(ctx, shape);
      break;
    case 'diamond':
      drawDiamond(ctx, shape);
      break;
    case 'curve':
      drawCurve(ctx, shape);
      break;
    case 'rounded-rect':
      drawRoundedRect(ctx, shape);
      break;
    case 'ortho':
      drawOrtho(ctx, shape);
      break;
    default:
      drawCircle(ctx, shape);
  }

  ctx.restore();
}

function drawCircle(ctx, shape) {
  const { x, y, radius, color } = shape;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color + '33'; // 半透明填充
  ctx.fill();
  ctx.stroke();
}

function drawRect(ctx, shape) {
  const { x, y, width, height, color } = shape;
  ctx.fillStyle = color + '33';
  ctx.fillRect(x - width / 2, y - height / 2, width, height);
  ctx.strokeRect(x - width / 2, y - height / 2, width, height);
}

function drawLine(ctx, shape) {
  const { x, y, x2, y2, color, lineWidth } = shape;
  ctx.lineWidth = lineWidth || 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawTriangle(ctx, shape) {
  const { x, y, size, color } = shape;
  const h = size * Math.sqrt(3) / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - h * 2 / 3);
  ctx.lineTo(x - size / 2, y + h / 3);
  ctx.lineTo(x + size / 2, y + h / 3);
  ctx.closePath();
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.stroke();
}

function drawStar(ctx, shape) {
  const { x, y, size, color } = shape;
  const spikes = 5;
  const outerRadius = size;
  const innerRadius = size / 2;

  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI * i) / spikes - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.stroke();
}

function drawEllipse(ctx, shape) {
  const { x, y, rx, ry, color } = shape;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.stroke();
}

function drawText(ctx, shape) {
  const { x, y, content, fontSize, color, textAlign, _system } = shape;
  const fs = fontSize || 14;
  ctx.save();
  ctx.font = `${fs}px "Noto Sans SC", sans-serif`;

  // 用户创建的文字（非系统装饰）：加半透明圆角背景，让文字看起来像可编辑标签
  if (!_system) {
    const tw = ctx.measureText(content || '').width;
    const th = fs + 8;
    const bx = x - tw / 2 - 8;
    const by = y - th / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + 16, th, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = color || '#333333';
  ctx.textAlign = textAlign || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(content || '', x, y);
  ctx.restore();
}

function drawArc(ctx, shape) {
  const { x, y, radius, startAngle, endAngle, color } = shape;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, radius, startAngle, endAngle);
  ctx.closePath();
  ctx.fillStyle = color + 'bb';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawDiamond(ctx, shape) {
  const { x, y, width, height, color } = shape;
  const hw = width / 2, hh = height / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, y + hh);
  ctx.lineTo(x - hw, y);
  ctx.closePath();
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.stroke();
}

/**
 * 贝塞尔曲线连线（思维导图专用）
 * x/y 为起点，cx1/cy1、cx2/cy2 为控制点，x2/y2 为终点
 */
function drawCurve(ctx, shape) {
  const { x, y, cx1, cy1, cx2, cy2, x2, y2, color, lineWidth } = shape;
  ctx.save();
  ctx.strokeStyle = color || '#aaa';
  ctx.lineWidth   = lineWidth || 2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 圆角矩形（流程图开始/结束节点，pill 形）
 * 圆角半径 = 高度的一半，形成标准"跑道"形状
 */
function drawRoundedRect(ctx, shape) {
  const { x, y, width, height, color } = shape;
  const r = height / 2; // pill 形：圆角半径等于半高
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, r);
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.stroke();
}

/**
 * 直角折线连线（流程图专用）
 * 路径：起点 → 竖直到中间 → 水平到目标 x → 竖直到终点
 * 箭头以实心三角形绘制在终点处，方向跟随最后一段路径
 */
function drawOrtho(ctx, shape) {
  const { x, y, x2, y2, color, lineWidth } = shape;
  const midY = (y + y2) / 2;
  const isStraight = Math.abs(x - x2) < 2;

  ctx.save();
  ctx.strokeStyle = color || '#888';
  ctx.lineWidth   = lineWidth || 1.8;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';

  // 折线路径
  ctx.beginPath();
  ctx.moveTo(x, y);
  if (isStraight) {
    ctx.lineTo(x2, y2 - 9); // 直线，留出箭头空间
  } else {
    ctx.lineTo(x, midY);
    ctx.lineTo(x2, midY);
    ctx.lineTo(x2, y2 - 9);
  }
  ctx.stroke();

  // 实心箭头三角形（始终指向 y2 方向）
  const dir = y2 >= (isStraight ? y : midY) ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 6, y2 - 10 * dir);
  ctx.lineTo(x2 + 6, y2 - 10 * dir);
  ctx.closePath();
  ctx.fillStyle = color || '#888';
  ctx.fill();

  ctx.restore();
}

/**
 * 绘制选中高亮边框
 */
export function drawSelection(ctx, shape) {
  ctx.save();
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 3]);

  const bounds = getShapeBounds(shape);
  const pad = 8;
  ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);
  ctx.restore();
}

/**
 * 绘制序号标签
 * - _system: true → 不显示（坐标轴、装饰文字等）
 * - _barLabel → 在图形下方显示数据标签（柱子、折线点）
 * - _nodeText → 节点文字已由 sysText 覆盖，不重复显示 ID
 */
export function drawLabel(ctx, shape) {
  // 系统装饰元素（坐标轴、流程图连线等）不显示序号
  if (shape._system) return;

  ctx.save();
  const labelX = shape.x || (shape.x + shape.x2) / 2;
  const labelY = getShapeBounds(shape).y - 12;

  ctx.font = 'bold 14px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const text = `${shape.id}`;
  const metrics = ctx.measureText(text);
  const tw = metrics.width + 8;
  const th = 18;

  ctx.fillStyle = 'rgba(33, 150, 243, 0.8)';
  ctx.beginPath();
  ctx.roundRect(labelX - tw / 2, labelY - th, tw, th, 4);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.fillText(text, labelX, labelY - 3);
  ctx.restore();
}

/**
 * 获取图形边界框
 */
export function getShapeBounds(shape) {
  switch (shape.type) {
    case 'circle':
      return { x: shape.x - shape.radius, y: shape.y - shape.radius, w: shape.radius * 2, h: shape.radius * 2 };
    case 'rect':
      return { x: shape.x - shape.width / 2, y: shape.y - shape.height / 2, w: shape.width, h: shape.height };
    case 'line':
      return {
        x: Math.min(shape.x, shape.x2),
        y: Math.min(shape.y, shape.y2) - 5,
        w: Math.abs(shape.x2 - shape.x),
        h: Math.abs(shape.y2 - shape.y) + 10,
      };
    case 'triangle': {
      const h = shape.size * Math.sqrt(3) / 2;
      return { x: shape.x - shape.size / 2, y: shape.y - h * 2 / 3, w: shape.size, h };
    }
    case 'star':
      return { x: shape.x - shape.size, y: shape.y - shape.size, w: shape.size * 2, h: shape.size * 2 };
    case 'ellipse':
      return { x: shape.x - shape.rx, y: shape.y - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
    case 'text': {
      // 用字符数粗略估算宽度（中文字符约 fontSize × 1.1px）
      const fs = shape.fontSize || 14;
      const approxW = Math.max(40, (shape.content?.length || 2) * fs * 1.0) + 16;
      const approxH = fs + 8;
      return { x: shape.x - approxW / 2, y: shape.y - approxH / 2, w: approxW, h: approxH };
    }
    case 'arc':
      return { x: shape.x - shape.radius, y: shape.y - shape.radius, w: shape.radius * 2, h: shape.radius * 2 };
    case 'diamond':
      return { x: shape.x - shape.width / 2, y: shape.y - shape.height / 2, w: shape.width, h: shape.height };
    case 'rounded-rect':
      return { x: shape.x - shape.width / 2, y: shape.y - shape.height / 2, w: shape.width, h: shape.height };
    case 'ortho':
      return { x: Math.min(shape.x, shape.x2), y: Math.min(shape.y, shape.y2), w: Math.abs(shape.x2 - shape.x), h: Math.abs(shape.y2 - shape.y) };
    case 'curve':
      return { x: Math.min(shape.x, shape.x2) - 10, y: Math.min(shape.y, shape.y2) - 10, w: Math.abs(shape.x2 - shape.x) + 20, h: Math.abs(shape.y2 - shape.y) + 20 };
    default:
      return { x: shape.x - 30, y: shape.y - 30, w: 60, h: 60 };
  }
}

/**
 * 计算从 shape 中心出发、指向 (toX, toY) 的射线与 shape 边界的交点。
 * 用于连线功能：让线段终止于形状轮廓，而不是穿入中心被遮住。
 *
 * @param {object} shape - 图形对象
 * @param {number} toX   - 目标点 x
 * @param {number} toY   - 目标点 y
 * @returns {{ x: number, y: number }}
 */
export function getShapeEdgePoint(shape, toX, toY) {
  const cx = shape.x;
  const cy = shape.y;
  const dx = toX - cx;
  const dy = toY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return { x: cx, y: cy };

  const cos = dx / dist;
  const sin = dy / dist;

  // 圆形：精确边缘
  if (shape.type === 'circle') {
    return { x: cx + cos * shape.radius, y: cy + sin * shape.radius };
  }

  // 椭圆形：参数方程求边缘
  if (shape.type === 'ellipse') {
    const { rx, ry } = shape;
    const t = 1 / Math.sqrt((cos * cos) / (rx * rx) + (sin * sin) / (ry * ry));
    return { x: cx + cos * t, y: cy + sin * t };
  }

  // 其余形状：用包围盒边缘近似（矩形、菱形、圆角矩形、三角形、星形等）
  const bounds = getShapeBounds(shape);
  const hw = bounds.w / 2;
  const hh = bounds.h / 2;
  const absCos = Math.abs(cos);
  const absSin = Math.abs(sin);
  const t = Math.min(
    absCos > 0.0001 ? hw / absCos : Infinity,
    absSin > 0.0001 ? hh / absSin : Infinity,
  );
  return { x: cx + cos * t, y: cy + sin * t };
}

/**
 * 图形类型中文名映射
 */
export const SHAPE_NAMES = {
  circle: '圆形',
  rect: '矩形',
  line: '直线',
  triangle: '三角形',
  star: '星形',
  ellipse: '椭圆',
  text: '文字',
  arc: '扇形',
  diamond: '菱形',
  'rounded-rect': '圆角矩形',
};

/**
 * 颜色名称映射
 */
export const COLOR_MAP = {
  '红': '#FF6B6B',
  '红色': '#FF6B6B',
  '蓝': '#45B7D1',
  '蓝色': '#45B7D1',
  '绿': '#96CEB4',
  '绿色': '#96CEB4',
  '黄': '#FFEAA7',
  '黄色': '#FFEAA7',
  '紫': '#DDA0DD',
  '紫色': '#DDA0DD',
  '橙': '#FFA07A',
  '橙色': '#FFA07A',
  '黑': '#333333',
  '黑色': '#333333',
  '白': '#FFFFFF',
  '白色': '#FFFFFF',
  '粉': '#FFB6C1',
  '粉色': '#FFB6C1',
  '青': '#00CED1',
  '青色': '#00CED1',
  '灰': '#999999',
  '灰色': '#999999',
};

/**
 * 颜色 hex 转中文名
 */
export function colorToName(hex) {
  for (const [name, value] of Object.entries(COLOR_MAP)) {
    if (value.toLowerCase() === hex.toLowerCase()) return name;
  }
  return hex;
}
