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
    circle: { type: 'circle', x: 400, y: 300, radius: 50, color: '#FF6B6B', lineWidth: 2 },
    rect: { type: 'rect', x: 350, y: 250, width: 100, height: 80, color: '#4ECDC4', lineWidth: 2 },
    line: { type: 'line', x: 300, y: 300, x2: 500, y2: 300, color: '#45B7D1', lineWidth: 3 },
    triangle: { type: 'triangle', x: 400, y: 250, size: 60, color: '#96CEB4', lineWidth: 2 },
    star: { type: 'star', x: 400, y: 300, size: 40, color: '#FFEAA7', lineWidth: 2 },
    ellipse: { type: 'ellipse', x: 400, y: 300, rx: 80, ry: 50, color: '#DDA0DD', lineWidth: 2 },
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
 */
export function drawLabel(ctx, shape) {
  ctx.save();
  const labelX = shape.x || (shape.x + shape.x2) / 2;
  const labelY = getShapeBounds(shape).y - 12;

  ctx.font = 'bold 14px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  // 背景
  const text = `${shape.id}`;
  const metrics = ctx.measureText(text);
  const tw = metrics.width + 8;
  const th = 18;

  ctx.fillStyle = 'rgba(33, 150, 243, 0.8)';
  ctx.beginPath();
  ctx.roundRect(labelX - tw / 2, labelY - th, tw, th, 4);
  ctx.fill();

  // 文字
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
    default:
      return { x: shape.x - 30, y: shape.y - 30, w: 60, h: 60 };
  }
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
