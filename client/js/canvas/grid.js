/**
 * 网格背景绘制 + 方位移动系统
 */

/**
 * 在 Canvas 上绘制网格背景
 * 细密小网格 + 大网格，无分区线
 */
export function drawGrid(ctx, canvasWidth, canvasHeight) {
  ctx.save();

  const smallStep = 20;   // 小网格间距
  const bigStep = 100;     // 大网格间距

  // 1. 绘制细密小网格
  ctx.strokeStyle = 'rgba(220, 225, 230, 0.5)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([]);

  for (let x = 0; x <= canvasWidth; x += smallStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  for (let y = 0; y <= canvasHeight; y += smallStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  // 2. 绘制大网格（每 100px）
  ctx.strokeStyle = 'rgba(200, 210, 220, 0.6)';
  ctx.lineWidth = 0.8;

  for (let x = 0; x <= canvasWidth; x += bigStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  for (let y = 0; y <= canvasHeight; y += bigStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * 方位关键词映射
 */
export const DIRECTION_MAP = {
  '左上': { dx: -1, dy: -1 },
  '右上': { dx: 1, dy: -1 },
  '左下': { dx: -1, dy: 1 },
  '右下': { dx: 1, dy: 1 },
  '左': { dx: -1, dy: 0 },
  '右': { dx: 1, dy: 0 },
  '上': { dx: 0, dy: -1 },
  '下': { dx: 0, dy: 1 },
};

/**
 * 位置别名映射（用于"在右上角画一个圆"）
 */
const POSITION_ALIASES = {
  '左上角': { dx: -1, dy: -1 },
  '左上方': { dx: -1, dy: -1 },
  '右上角': { dx: 1, dy: -1 },
  '右上方': { dx: 1, dy: -1 },
  '左下角': { dx: -1, dy: 1 },
  '左下方': { dx: -1, dy: 1 },
  '右下角': { dx: 1, dy: 1 },
  '右下方': { dx: 1, dy: 1 },
  '左边': { dx: -1, dy: 0 },
  '左侧': { dx: -1, dy: 0 },
  '左面': { dx: -1, dy: 0 },
  '右边': { dx: 1, dy: 0 },
  '右侧': { dx: 1, dy: 0 },
  '右面': { dx: 1, dy: 0 },
  '上方': { dx: 0, dy: -1 },
  '上方中间': { dx: 0, dy: -1 },
  '上边': { dx: 0, dy: -1 },
  '上面': { dx: 0, dy: -1 },
  '上侧': { dx: 0, dy: -1 },
  '下方': { dx: 0, dy: 1 },
  '下方中间': { dx: 0, dy: 1 },
  '下边': { dx: 0, dy: 1 },
  '下面': { dx: 0, dy: 1 },
  '下侧': { dx: 0, dy: 1 },
  '中间': { dx: 0, dy: 0 },
  '中央': { dx: 0, dy: 0 },
  '正中': { dx: 0, dy: 0 },
};

/**
 * 从文本中解析位置方向
 * @param {string} text
 * @returns {object|null} { dx, dy } 方向向量，null 表示未指定位置
 */
export function parsePosition(text) {
  // 优先匹配位置别名（更长更精确）
  for (const [alias, vec] of Object.entries(POSITION_ALIASES)) {
    if (text.includes(alias)) {
      return vec;
    }
  }
  return null;
}

/**
 * 根据位置方向计算画布上的实际坐标
 * @param {object} position - { dx, dy } 方向向量
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {{ x: number, y: number }}
 */
export function positionToCoords(position, canvasWidth, canvasHeight) {
  // 将方向向量映射到画布坐标
  // dx/dy 范围 [-1, 1]，映射到画布的 [20%, 80%] 区域
  const cx = canvasWidth / 2 + position.dx * canvasWidth * 0.3;
  const cy = canvasHeight / 2 + position.dy * canvasHeight * 0.3;
  return { x: cx, y: cy };
}

/**
 * 解析移动方向和距离
 * @param {string} text - 如 "往左移一点"、"移到右上角"
 * @returns {object|null} { dx, dy, distance }
 */
export function parseMovement(text) {
  // 解析方向（优先匹配双字方向）
  let dx = 0, dy = 0;
  for (const [dir, vec] of Object.entries(DIRECTION_MAP)) {
    if (text.includes(dir)) {
      dx = vec.dx;
      dy = vec.dy;
      break;
    }
  }

  if (dx === 0 && dy === 0) return null;

  // 解析距离
  let distance = 30; // 默认移动距离
  if (text.includes('很多') || text.includes('大步') || text.includes('远')) {
    distance = 80;
  } else if (text.includes('一点') || text.includes('一点点') || text.includes('些微')) {
    distance = 15;
  } else if (text.includes('一半')) {
    distance = 150;
  }

  return { dx, dy, distance };
}
