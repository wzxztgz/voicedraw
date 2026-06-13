/**
 * 统计图表生成器
 * 将 LLM 返回的图表配置 JSON 转换为可添加到 store 的 shape 对象数组
 *
 * 规则：
 *  - 数据图形（柱子、折线点、饼图扇区）→ 普通 shape，有 ID，可语音选中/改色/移动/删除
 *  - 坐标轴、标题、刻度标签 → _system:true，不显示 ID 徽章，不被语音操作
 */

const CHART_COLORS = ['#45B7D1', '#FF6B6B', '#96CEB4', '#FFEAA7', '#DDA0DD', '#FFA07A', '#7EC8E3', '#FF9A8B'];

// ─── 工具函数 ──────────────────────────────────────────────

function sysLine(x, y, x2, y2, color = '#999', lineWidth = 1) {
  return { type: 'line', x, y, x2, y2, color, lineWidth, _system: true };
}

function sysText(x, y, content, fontSize = 12, color = '#555', textAlign = 'center') {
  return { type: 'text', x, y, content: String(content), fontSize, color, textAlign, _system: true };
}

// ─── 柱状图 ────────────────────────────────────────────────

export function renderBarChart(config, W, H) {
  const { title = '', xAxis = [], data = [], unit = '' } = config;
  const shapes = [];

  const ml = 72, mr = 30, mt = 55, mb = 60;
  const cx = ml, cy = mt;
  const cw = W - ml - mr;
  const ch = H - mt - mb;
  const maxVal = Math.max(...data, 1) * 1.2;

  // 标题
  if (title) shapes.push(sysText(W / 2, 28, title, 18, '#222'));

  // X 轴 / Y 轴
  shapes.push(sysLine(cx, cy + ch, cx + cw, cy + ch, '#888', 2));
  shapes.push(sysLine(cx, cy, cx, cy + ch, '#888', 2));

  // Y 轴刻度
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxVal / yTicks) * i;
    const ty = cy + ch - (ch * i / yTicks);
    shapes.push(sysLine(cx - 4, ty, cx, ty, '#888', 1));
    shapes.push(sysText(cx - 8, ty, `${Math.round(val)}${unit}`, 11, '#666', 'right'));
  }

  // 柱子
  const barGroupW = cw / data.length;
  const barW = Math.max(barGroupW * 0.55, 8);

  data.forEach((val, i) => {
    const barH = Math.max((val / maxVal) * ch, 2);
    const bx = cx + (i + 0.5) * barGroupW;
    const by = cy + ch - barH / 2;

    // 可编辑柱子 rect
    shapes.push({
      type: 'rect',
      x: bx, y: by,
      width: barW, height: barH,
      color: CHART_COLORS[i % CHART_COLORS.length],
      lineWidth: 1,
      _barLabel: xAxis[i] ?? `${i + 1}`,
      _barValue: val,
      _barUnit: unit,
    });

    // X 轴标签
    shapes.push(sysText(bx, cy + ch + 18, xAxis[i] ?? `${i + 1}`, 12, '#555'));
    // 柱顶数值
    shapes.push(sysText(bx, cy + ch - barH - 10, `${val}${unit}`, 11, '#333'));
  });

  return shapes;
}

// ─── 折线图 ────────────────────────────────────────────────

export function renderLineChart(config, W, H) {
  const { title = '', xAxis = [], data = [], unit = '' } = config;
  const shapes = [];

  const ml = 72, mr = 30, mt = 55, mb = 60;
  const cx = ml, cy = mt;
  const cw = W - ml - mr;
  const ch = H - mt - mb;
  const maxVal = Math.max(...data, 1) * 1.2;
  const lineColor = '#45B7D1';

  if (title) shapes.push(sysText(W / 2, 28, title, 18, '#222'));

  shapes.push(sysLine(cx, cy + ch, cx + cw, cy + ch, '#888', 2));
  shapes.push(sysLine(cx, cy, cx, cy + ch, '#888', 2));

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxVal / yTicks) * i;
    const ty = cy + ch - (ch * i / yTicks);
    shapes.push(sysLine(cx - 4, ty, cx, ty, '#888', 1));
    shapes.push(sysText(cx - 8, ty, `${Math.round(val)}${unit}`, 11, '#666', 'right'));
    // 横向参考线
    if (i > 0) shapes.push(sysLine(cx, ty, cx + cw, ty, '#ddd', 1));
  }

  const n = data.length;
  const stepX = n > 1 ? cw / (n - 1) : cw;

  // 连接线（系统层，不可选）
  for (let i = 0; i < n - 1; i++) {
    const x1 = cx + i * stepX;
    const y1 = cy + ch - (data[i] / maxVal) * ch;
    const x2 = cx + (i + 1) * stepX;
    const y2 = cy + ch - (data[i + 1] / maxVal) * ch;
    shapes.push(sysLine(x1, y1, x2, y2, lineColor, 2));
  }

  // 数据点圆（可编辑）
  data.forEach((val, i) => {
    const px = n > 1 ? cx + i * stepX : cx + cw / 2;
    const py = cy + ch - (val / maxVal) * ch;

    shapes.push({
      type: 'circle',
      x: px, y: py,
      radius: 7,
      color: lineColor,
      lineWidth: 2,
      _barLabel: xAxis[i] ?? `${i + 1}`,
      _barValue: val,
      _barUnit: unit,
    });

    shapes.push(sysText(px, cy + ch + 18, xAxis[i] ?? `${i + 1}`, 12, '#555'));
    shapes.push(sysText(px, py - 16, `${val}${unit}`, 11, '#333'));
  });

  return shapes;
}

// ─── 饼图 ─────────────────────────────────────────────────

export function renderPieChart(config, W, H) {
  const { title = '', labels = [], data = [] } = config;
  const shapes = [];

  const cx = W / 2 - 40;
  const cy = H / 2 + 10;
  const radius = Math.min(W, H) * 0.32;

  if (title) shapes.push(sysText(W / 2, 28, title, 18, '#222'));

  const total = data.reduce((s, v) => s + v, 0) || 1;
  let startAngle = -Math.PI / 2; // 从正上方开始

  data.forEach((val, i) => {
    const sweep = (val / total) * Math.PI * 2;
    const endAngle = startAngle + sweep;

    // 扇形（可编辑）
    shapes.push({
      type: 'arc',
      x: cx, y: cy,
      radius,
      startAngle,
      endAngle,
      color: CHART_COLORS[i % CHART_COLORS.length],
      lineWidth: 2,
      _barLabel: labels[i] ?? `${i + 1}`,
      _barValue: val,
      _barUnit: '',
    });

    // 扇形中心标签
    const midAngle = startAngle + sweep / 2;
    const lx = cx + Math.cos(midAngle) * radius * 0.65;
    const ly = cy + Math.sin(midAngle) * radius * 0.65;
    const pct = Math.round((val / total) * 100);
    shapes.push(sysText(lx, ly, `${pct}%`, 13, '#fff'));

    startAngle = endAngle;
  });

  // 图例（右侧）
  const legendX = cx + radius + 30;
  labels.forEach((label, i) => {
    const ly = cy - (labels.length / 2 - i) * 26;
    shapes.push({
      type: 'rect',
      x: legendX + 8, y: ly,
      width: 16, height: 16,
      color: CHART_COLORS[i % CHART_COLORS.length],
      lineWidth: 0,
      _system: true,
    });
    shapes.push(sysText(legendX + 30, ly, label, 13, '#333', 'left'));
  });

  return shapes;
}
