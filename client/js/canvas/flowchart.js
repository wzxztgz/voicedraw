/**
 * 流程图 & 思维导图生成器
 */

// ─── 工具 ──────────────────────────────────────────────────

function sysText(x, y, content, fontSize = 13, color = '#fff', textAlign = 'center') {
  return { type: 'text', x, y, content: String(content), fontSize, color, textAlign, _system: true };
}

function sysLine(x, y, x2, y2, color = '#aaa', lineWidth = 1.5) {
  return { type: 'line', x, y, x2, y2, color, lineWidth, _system: true };
}

/** 把点限制在画布安全区内 */
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

// ─── 流程图 ────────────────────────────────────────────────

/**
 * 自上而下层级布局
 * 同层节点水平均分，level 决定 Y 坐标
 */
export function renderFlowchart(config, W, H) {
  const { nodes = [], edges = [] } = config;
  const shapes = [];

  const nodeW = 140, nodeH = 52;
  const vGap   = 65;
  const mt     = 48;
  const pad    = 20; // 左右最小边距

  // 按 level 分组
  const levelMap = {};
  nodes.forEach((n) => {
    const lv = n.level || 1;
    (levelMap[lv] = levelMap[lv] || []).push(n);
  });

  // 动态调整节点宽以防止同级节点重叠
  const maxPerLevel = Math.max(...Object.values(levelMap).map((a) => a.length));
  const availW = W - pad * 2;
  const hGap   = Math.max(20, (availW - nodeW * maxPerLevel) / (maxPerLevel + 1));
  const rowW   = maxPerLevel * nodeW + (maxPerLevel - 1) * hGap;

  // 计算每个节点的中心坐标
  const coordMap = {};
  Object.entries(levelMap).forEach(([lv, nodesAtLevel]) => {
    const y   = mt + (parseInt(lv) - 1) * (nodeH + vGap) + nodeH / 2;
    const n   = nodesAtLevel.length;
    const row = n * nodeW + (n - 1) * hGap;
    const startX = (W - row) / 2 + nodeW / 2;
    nodesAtLevel.forEach((node, i) => {
      coordMap[node.id] = { x: startX + i * (nodeW + hGap), y };
    });
  });

  // 先画连线（在节点下层）
  edges.forEach((e) => {
    const from = coordMap[e.from];
    const to   = coordMap[e.to];
    if (!from || !to) return;

    const x1 = from.x;
    const y1 = from.y + nodeH / 2;
    const x2 = to.x;
    const y2 = to.y - nodeH / 2;

    shapes.push(sysLine(x1, y1, x2, y2, '#888', 1.8));

    // 箭头
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const aLen  = 10;
    shapes.push(sysLine(x2, y2,
      x2 - aLen * Math.cos(angle - 0.38), y2 - aLen * Math.sin(angle - 0.38), '#888', 1.8));
    shapes.push(sysLine(x2, y2,
      x2 - aLen * Math.cos(angle + 0.38), y2 - aLen * Math.sin(angle + 0.38), '#888', 1.8));

    // 边标签（避免遮住箭头，偏移到线段中间靠一侧）
    if (e.label) {
      const mx = (x1 + x2) / 2 + (x1 === x2 ? 14 : 0);
      const my = (y1 + y2) / 2;
      shapes.push(sysText(mx, my, e.label, 11, '#666'));
    }
  });

  // 再画节点（覆盖在连线上层）
  nodes.forEach((n) => {
    const coord = coordMap[n.id];
    if (!coord) return;
    const { x, y } = coord;

    const COLORS = { oval: '#96CEB4', diamond: '#FFEAA7', rect: '#45B7D1' };
    const shapeKey = n.shape === 'oval' ? 'oval' : n.shape === 'diamond' ? 'diamond' : 'rect';
    const color = COLORS[shapeKey];

    if (shapeKey === 'oval') {
      shapes.push({ type: 'ellipse', x, y, rx: nodeW / 2, ry: nodeH / 2, color, lineWidth: 2, _nodeText: n.text });
    } else if (shapeKey === 'diamond') {
      shapes.push({ type: 'diamond', x, y, width: nodeW, height: nodeH, color, lineWidth: 2, _nodeText: n.text });
    } else {
      shapes.push({ type: 'rect', x, y, width: nodeW, height: nodeH, color, lineWidth: 2, _nodeText: n.text });
    }

    // 节点文字（白色，居中）
    shapes.push(sysText(x, y, n.text, 13, '#fff'));
  });

  return shapes;
}

// ─── 思维导图 ──────────────────────────────────────────────

const BRANCH_COLORS = ['#45B7D1', '#FF6B6B', '#96CEB4', '#FFEAA7', '#DDA0DD', '#FFA07A', '#7EC8E3'];
const CHILD_COLORS  = ['#6BCFE3', '#FF8C8C', '#A8D8B9', '#FFD166', '#C9A0DC', '#FFB38A', '#96D9EC'];

/**
 * 中心辐射布局
 * 主题居中，一级分支环绕，二级分支沿同方向辐射延伸
 */
export function renderMindmap(config, W, H) {
  const { root = '主题', branches = [] } = config;
  const shapes = [];

  const cx = W / 2;
  const cy = H / 2;

  // 根据分支数量自适应半径，保证不超出画布
  const nBranches = branches.length || 1;
  const r1 = clamp(Math.min(W, H) * 0.30, 130, 220); // 主分支半径
  const r2 = clamp(Math.min(W, H) * 0.20, 90, 160);  // 子分支额外距离

  const rootRx = 72, rootRy = 36;
  const branchW = 108, branchH = 38;
  const childW  = 88,  childH  = 30;

  // ── 中心主题 ──
  shapes.push({
    type: 'ellipse', x: cx, y: cy,
    rx: rootRx, ry: rootRy,
    color: '#FF6B6B', lineWidth: 2.5,
    _nodeText: root,
  });
  shapes.push(sysText(cx, cy, root, 15, '#fff'));

  // ── 一级分支 ──
  branches.forEach((branch, bi) => {
    const angle = (Math.PI * 2 / nBranches) * bi - Math.PI / 2;
    const cos   = Math.cos(angle);
    const sin   = Math.sin(angle);

    const bx = clamp(cx + cos * r1, childW / 2 + 10, W - childW / 2 - 10);
    const by = clamp(cy + sin * r1, branchH / 2 + 10, H - branchH / 2 - 10);

    const color = BRANCH_COLORS[bi % BRANCH_COLORS.length];

    // 连线：从根椭圆边缘出发
    const ex = cx + cos * rootRx;
    const ey = cy + sin * rootRy;
    shapes.push(sysLine(ex, ey, bx, by, color, 2));

    // 一级节点
    shapes.push({
      type: 'rect', x: bx, y: by,
      width: branchW, height: branchH,
      color, lineWidth: 2,
      _nodeText: branch.text,
    });
    shapes.push(sysText(bx, by, branch.text, 13, '#fff'));

    // ── 二级分支 ──
    const children = branch.children || [];
    if (children.length === 0) return;

    // 子分支沿主方向展开，扇形角度随数量自适应
    const maxSpread  = Math.PI * 0.7; // 最大展开 126°
    const spread     = Math.min(maxSpread, (children.length - 1) * 0.55 + 0.3);
    const cStep      = children.length > 1 ? spread / (children.length - 1) : 0;
    const cBaseAngle = angle - spread / 2;

    children.forEach((child, ci) => {
      const ca  = children.length > 1 ? cBaseAngle + ci * cStep : angle;
      const ccx = Math.cos(ca);
      const ccy = Math.sin(ca);

      const cx2 = clamp(bx + ccx * r2, childW / 2 + 10, W - childW / 2 - 10);
      const cy2 = clamp(by + ccy * r2, childH / 2 + 10, H - childH / 2 - 10);

      const cColor = CHILD_COLORS[bi % CHILD_COLORS.length];

      // 连线：从一级节点边缘出发
      const ex2 = bx + ccx * (branchW / 2);
      const ey2 = by + ccy * (branchH / 2);
      shapes.push(sysLine(ex2, ey2, cx2, cy2, cColor, 1.5));

      shapes.push({
        type: 'rect', x: cx2, y: cy2,
        width: childW, height: childH,
        color: cColor, lineWidth: 1.5,
        _nodeText: child,
      });
      shapes.push(sysText(cx2, cy2, child, 12, '#fff'));
    });
  });

  return shapes;
}
