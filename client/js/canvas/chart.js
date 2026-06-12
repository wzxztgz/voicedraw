/**
 * 图表计算模块
 * 将 LLM 返回的图表配置转换为可绘制的图形对象数组 + 坐标轴元数据
 *
 * 分工：
 *   shapes  → 存入 store，可被选中/修改/删除
 *   meta    → 存入 store.chartMeta，由 renderer 绘制坐标轴/标签/标题
 */

const CHART_COLORS = [
  '#4ECDC4', '#45B7D1', '#FF6B6B', '#FFEAA7',
  '#96CEB4', '#DDA0DD', '#FFA07A', '#74B9FF',
  '#A29BFE', '#FDCB6E', '#55EFC4', '#FD79A8',
];

// 图表布局边距（CSS 像素）
const MARGIN = { left: 72, right: 28, top: 56, bottom: 64 };

/**
 * 根据图表类型分发计算
 */
export function computeChart(config, canvasWidth, canvasHeight) {
  switch (config.chartType) {
    case 'bar':  return computeBarChart(config, canvasWidth, canvasHeight);
    case 'line': return computeLineChart(config, canvasWidth, canvasHeight);
    case 'pie':  return computePieChart(config, canvasWidth, canvasHeight);
    default:     return computeBarChart(config, canvasWidth, canvasHeight);
  }
}

// ─────────────────────────────────────────────
// 柱状图
// ─────────────────────────────────────────────
function computeBarChart(config, W, H) {
  const { chartLeft, chartRight, chartTop, chartBottom, chartWidth, chartHeight } = getChartArea(W, H);

  const seriesData = config.series?.[0]?.data || [];
  const data = seriesData.map(Number).filter((v) => !isNaN(v));
  const xLabels = config.xAxis || data.map((_, i) => String(i + 1));
  const N = data.length;

  if (N === 0) {
    return { shapes: [], meta: buildMeta('bar', config, [], chartLeft, chartRight, chartTop, chartBottom, 100) };
  }

  const maxValue = Math.max(...data);
  const yMax = maxValue * 1.25; // 留25%顶部空间
  const barAreaWidth = chartWidth / N;
  const barWidth = Math.max(16, barAreaWidth * 0.55);

  const shapes = data.map((val, i) => {
    const barHeight = Math.max(2, (val / yMax) * chartHeight);
    return {
      type: 'rect',
      x: chartLeft + barAreaWidth * i + barAreaWidth / 2,
      y: chartBottom - barHeight / 2,
      width: barWidth,
      height: barHeight,
      color: CHART_COLORS[i % CHART_COLORS.length],
      lineWidth: 0,
      _chartIndex: i,
      _chartValue: val,
      _chartLabel: xLabels[i] || String(i + 1),
    };
  });

  const meta = buildMeta('bar', config, xLabels, chartLeft, chartRight, chartTop, chartBottom, yMax);
  return { shapes, meta };
}

// ─────────────────────────────────────────────
// 折线图
// ─────────────────────────────────────────────
function computeLineChart(config, W, H) {
  const { chartLeft, chartRight, chartTop, chartBottom, chartWidth, chartHeight } = getChartArea(W, H);

  const seriesData = config.series?.[0]?.data || [];
  const data = seriesData.map(Number).filter((v) => !isNaN(v));
  const xLabels = config.xAxis || data.map((_, i) => String(i + 1));
  const N = data.length;

  if (N === 0) {
    return { shapes: [], meta: buildMeta('line', config, [], chartLeft, chartRight, chartTop, chartBottom, 100) };
  }

  const maxValue = Math.max(...data);
  const yMax = maxValue * 1.25;
  const stepX = chartWidth / Math.max(N - 1, 1);

  // 计算各数据点坐标
  const points = data.map((val, i) => ({
    x: N === 1 ? chartLeft + chartWidth / 2 : chartLeft + stepX * i,
    y: chartBottom - (val / yMax) * chartHeight,
  }));

  const lineColor = CHART_COLORS[1]; // 蓝色
  const dotColor  = CHART_COLORS[0]; // 青色

  const shapes = [];

  // 连接线段（N-1 条）
  for (let i = 0; i < points.length - 1; i++) {
    shapes.push({
      type: 'line',
      x: points[i].x,
      y: points[i].y,
      x2: points[i + 1].x,
      y2: points[i + 1].y,
      color: lineColor,
      lineWidth: 2.5,
      _chartIndex: i,
      _chartPart: 'edge',
    });
  }

  // 数据点（小圆圈）
  points.forEach((pt, i) => {
    shapes.push({
      type: 'circle',
      x: pt.x,
      y: pt.y,
      radius: 6,
      color: dotColor,
      lineWidth: 2,
      _chartIndex: i,
      _chartValue: data[i],
      _chartLabel: xLabels[i] || String(i + 1),
      _chartPart: 'node',
    });
  });

  const meta = buildMeta('line', config, xLabels, chartLeft, chartRight, chartTop, chartBottom, yMax);
  // 折线图使用均匀 X 轴间距，不是面积宽
  meta.xStepMode = 'step';
  meta.xStep = N > 1 ? stepX : chartWidth;
  return { shapes, meta };
}

// ─────────────────────────────────────────────
// 饼图
// ─────────────────────────────────────────────
function computePieChart(config, W, H) {
  const pieData = config.series?.[0]?.data || [];
  if (!Array.isArray(pieData) || pieData.length === 0) {
    return { shapes: [], meta: { chartType: 'pie', title: config.title || '', pieMeta: [] } };
  }

  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.32;

  const total = pieData.reduce((s, d) => s + Number(d.value || 0), 0);
  let startAngle = -Math.PI / 2; // 从顶部开始

  // 饼图用椭圆近似圆形扇区（不完美，但无需新增 shape 类型）
  // 实际扇区由 renderer 的 _drawPieFrame 处理，shapes 只保存标签点圆
  const shapes = [];
  const slices = [];

  pieData.forEach((item, i) => {
    const val = Number(item.value || 0);
    const angle = (val / total) * Math.PI * 2;
    const midAngle = startAngle + angle / 2;

    slices.push({
      startAngle,
      endAngle: startAngle + angle,
      color: CHART_COLORS[i % CHART_COLORS.length],
      label: item.name || String(i + 1),
      value: val,
      percent: total > 0 ? Math.round((val / total) * 100) : 0,
    });

    // 每个扇区放一个小圆形作为可选中的"锚点"
    const labelR = radius * 0.68;
    shapes.push({
      type: 'circle',
      x: cx + Math.cos(midAngle) * labelR,
      y: cy + Math.sin(midAngle) * labelR,
      radius: 5,
      color: CHART_COLORS[i % CHART_COLORS.length],
      lineWidth: 0,
      _chartIndex: i,
      _chartValue: val,
      _chartLabel: item.name,
      _chartPart: 'node',
    });

    startAngle += angle;
  });

  return {
    shapes,
    meta: {
      chartType: 'pie',
      title: config.title || '',
      cx, cy, radius,
      unit: config.unit || '',
      slices,
    },
  };
}

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────
function getChartArea(W, H) {
  const chartLeft   = MARGIN.left;
  const chartRight  = W - MARGIN.right;
  const chartTop    = MARGIN.top;
  const chartBottom = H - MARGIN.bottom;
  return {
    chartLeft, chartRight, chartTop, chartBottom,
    chartWidth:  chartRight - chartLeft,
    chartHeight: chartBottom - chartTop,
  };
}

function buildMeta(chartType, config, xLabels, chartLeft, chartRight, chartTop, chartBottom, yMax) {
  return {
    chartType,
    title:      config.title || '',
    xLabels,
    yMax,
    unit:       config.unit || '',
    seriesName: config.series?.[0]?.name || '',
    chartLeft, chartRight, chartTop, chartBottom,
  };
}
