/**
 * 解析器与指令守卫回归测试（Node 直接运行，无额外测试框架）
 * 运行：npm run test:parser
 */

import assert from 'node:assert/strict';
import {
  sanitizeVoiceText,
  validateCommand,
  isRuleFallbackEligible,
  VALID_SHAPES,
} from './commandGuard.js';
import {
  parseCommandWithConfidence,
  hasComplexSignal,
  parseCompoundRules,
} from './keyword.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

/** 解析并返回 command + confidence */
function parse(text, ctx) {
  return parseCommandWithConfidence(text, ctx);
}

// ─────────────────────────────────────────────────────────────
console.log('\n[commandGuard]');

test('sanitizeVoiceText: null/empty → null', () => {
  assert.equal(sanitizeVoiceText(null), null);
  assert.equal(sanitizeVoiceText(''), null);
  assert.equal(sanitizeVoiceText('   '), null);
});

test('sanitizeVoiceText: 正常文本', () => {
  assert.equal(sanitizeVoiceText('  画一个圆  '), '画一个圆');
});

test('sanitizeVoiceText: 超长文本 → null', () => {
  assert.equal(sanitizeVoiceText('a'.repeat(501)), null);
});

test('validateCommand: draw 非法形状', () => {
  const r = validateCommand({ type: 'draw', shape: 'hexagon' });
  assert.equal(r.ok, false);
});

test('validateCommand: draw 合法', () => {
  const r = validateCommand({ type: 'draw', shape: 'circle', color: '#FF6B6B' });
  assert.equal(r.ok, true);
});

test('validateCommand: resize 越界', () => {
  assert.equal(validateCommand({ type: 'resize', factor: 10 }).ok, false);
  assert.equal(validateCommand({ type: 'resize', factor: 1.2 }).ok, true);
});

test('validateCommand: batch-draw count 边界', () => {
  assert.equal(validateCommand({ type: 'batch-draw', shape: 'circle', count: 0 }).ok, false);
  assert.equal(validateCommand({ type: 'batch-draw', shape: 'circle', count: 21 }).ok, false);
  assert.equal(validateCommand({ type: 'batch-draw', shape: 'circle', count: 3 }).ok, true);
});

test('validateCommand: modifyText 缺 refId', () => {
  assert.equal(validateCommand({ type: 'modifyText', content: '已完成' }).ok, false);
});

test('validateCommand: batch-color targetIds 合法', () => {
  const r = validateCommand({ type: 'batch-color', color: '#96CEB4', targetIds: [1, 2, 3] });
  assert.equal(r.ok, true);
});

test('validateCommand: batch-color targetIds 含 0 非法', () => {
  const r = validateCommand({ type: 'batch-color', color: '#96CEB4', targetIds: [0, 1] });
  assert.equal(r.ok, false);
});

test('validateCommand: batch-color filterShape 合法', () => {
  const r = validateCommand({ type: 'batch-color', color: '#45B7D1', filterShape: 'circle' });
  assert.equal(r.ok, true);
});

test('validateCommand: connect 端点编号', () => {
  assert.equal(validateCommand({ type: 'connect', fromId: 1, toId: 2 }).ok, true);
  assert.equal(validateCommand({ type: 'connect', fromId: 0, toId: 2 }).ok, false);
});

test('isRuleFallbackEligible: modifyText 可降级', () => {
  assert.equal(isRuleFallbackEligible({
    type: 'modifyText', refId: 3, content: '已完成',
  }), true);
});

test('isRuleFallbackEligible: connect 可降级', () => {
  assert.equal(isRuleFallbackEligible({
    type: 'connect', fromId: 1, toId: 2,
  }), true);
});

test('isRuleFallbackEligible: unknown 不可降级', () => {
  assert.equal(isRuleFallbackEligible({ type: 'unknown' }), false);
});

test('isRuleFallbackEligible: compound 不可降级', () => {
  assert.equal(isRuleFallbackEligible({
    type: 'compound', tasks: [{ type: 'draw', shape: 'circle' }],
  }), false);
});

// ─────────────────────────────────────────────────────────────
console.log('\n[hasComplexSignal · 分隔词]');

test('先画圆然后画矩形 → 复杂句（分隔词+2段）', () => {
  assert.equal(hasComplexSignal('先画圆然后画矩形'), true);
});

test('先画一个圆 → 非复杂句（分隔词仅1段）', () => {
  assert.equal(hasComplexSignal('先画一个圆'), false);
});

test('并且画圆 → 非复杂句（并且后仅1段）', () => {
  assert.equal(hasComplexSignal('并且画圆'), false);
});

test('之后连接1号和2号 → 非复杂句（之后后仅1段）', () => {
  assert.equal(hasComplexSignal('之后连接1号和2号'), false);
});

test('接着画矩形 → 非复杂句（接着后仅1段）', () => {
  assert.equal(hasComplexSignal('接着画矩形'), false);
});

test('最后删除3号 → 非复杂句（最后后仅1段）', () => {
  assert.equal(hasComplexSignal('最后删除3号'), false);
});

test('还要画一个三角形 → 非复杂句（还要后仅1段）', () => {
  assert.equal(hasComplexSignal('还要画一个三角形'), false);
});

test('画圆还要画矩形 → 复杂句（还要拆2段）', () => {
  assert.equal(hasComplexSignal('画圆还要画矩形'), true);
});

test('删除1号然后删除2号 → 复杂句（然后拆2段）', () => {
  assert.equal(hasComplexSignal('删除1号然后删除2号'), true);
});

// ─────────────────────────────────────────────────────────────
console.log('\n[hasComplexSignal · 双动词]');

test('连接+改文字（并）→ 复杂句', () => {
  assert.equal(
    hasComplexSignal('连接四号和5号，并把五号的文字改成退回'),
    true,
  );
});

test('连接1号并删除2号 → 复杂句（连接+删除）', () => {
  assert.equal(hasComplexSignal('连接1号并删除2号'), true);
});

test('把3号移到右边并改成红色 → 复杂句（移动+改色）', () => {
  assert.equal(hasComplexSignal('把3号移到右边并改成红色'), true);
});

test('画圆再画矩形 → 复杂句（非句首再）', () => {
  assert.equal(hasComplexSignal('画圆再画矩形'), true);
});

test('再画一个圆 → 非复杂句（句首再=续画）', () => {
  assert.equal(hasComplexSignal('再画一个圆'), false);
});

test('画一个圆 → 非复杂句', () => {
  assert.equal(hasComplexSignal('画一个圆'), false);
});

test('把3号改成红色 → 非复杂句（单动词）', () => {
  assert.equal(hasComplexSignal('把3号改成红色'), false);
});

test('连接1号和2号 → 非复杂句（单动词）', () => {
  assert.equal(hasComplexSignal('连接1号和2号'), false);
});

test('将1号2号3号改为绿色 → 非复杂句（单动词多目标）', () => {
  assert.equal(hasComplexSignal('将1号2号3号改为绿色'), false);
});

test('移动3号然后删除4号 → 复杂句（移动+删除）', () => {
  assert.equal(hasComplexSignal('移动3号然后删除4号'), true);
});

// ─────────────────────────────────────────────────────────────
console.log('\n[hasComplexSignal · 双形状]');

test('画圆和矩形 → 复杂句（双形状）', () => {
  assert.equal(hasComplexSignal('画一个圆和一个矩形'), true);
});

test('画一个椭圆和一个圆 → 复杂句（椭圆+圆）', () => {
  assert.equal(hasComplexSignal('画一个椭圆和一个圆'), true);
});

test('画圆角矩形 → 非复杂句（形状掩码）', () => {
  assert.equal(hasComplexSignal('画一个圆角矩形'), false);
});

test('画圆角矩形和一个圆 → 非复杂句（掩码后仅圆）', () => {
  assert.equal(hasComplexSignal('画一个圆角矩形和一个圆'), false);
});

test('画三角形和五角星 → 非复杂句（复合形状掩码）', () => {
  assert.equal(hasComplexSignal('画三角形和五角星'), false);
});

test('画一个大圆 → 非复杂句（单形状）', () => {
  assert.equal(hasComplexSignal('画一个大圆'), false);
});

// ─────────────────────────────────────────────────────────────
console.log('\n[parseCompoundRules · Layer 0 快路径]');

test('先画圆然后画矩形 → compound high', () => {
  const r = parseCompoundRules('先画圆然后画矩形');
  assert.ok(r);
  assert.equal(r.confidence, 'high');
  assert.equal(r.command.type, 'compound');
  assert.equal(r.command.tasks.length, 2);
  assert.equal(r.command.tasks[0].type, 'draw');
  assert.equal(r.command.tasks[0].shape, 'circle');
  assert.equal(r.command.tasks[1].shape, 'rect');
});

test('先画圆然后连接1号和2号 → compound high', () => {
  const r = parseCompoundRules('先画圆然后连接1号和2号');
  assert.ok(r);
  assert.equal(r.confidence, 'high');
  assert.equal(r.command.tasks[0].type, 'draw');
  assert.equal(r.command.tasks[1].type, 'connect');
});

test('删除1号然后删除2号 → compound high', () => {
  const r = parseCompoundRules('删除1号然后删除2号');
  assert.ok(r);
  assert.equal(r.confidence, 'high');
  assert.equal(r.command.tasks[0].target.value, 1);
  assert.equal(r.command.tasks[1].target.value, 2);
});

test('画圆还要画矩形 → compound high', () => {
  const r = parseCompoundRules('画圆还要画矩形');
  assert.ok(r);
  assert.equal(r.confidence, 'high');
});

test('移动3号然后删除4号 → null（移动子句低置信）', () => {
  const r = parseCompoundRules('移动3号然后删除4号');
  assert.equal(r, null);
});

test('先画一个圆 → null（仅1段）', () => {
  assert.equal(parseCompoundRules('先画一个圆'), null);
});

// ─────────────────────────────────────────────────────────────
console.log('\n[parseCommandWithConfidence · 绘制]');

test('画一个圆 → draw high', () => {
  const { command, confidence } = parse('画一个圆');
  assert.equal(command.type, 'draw');
  assert.equal(command.shape, 'circle');
  assert.equal(confidence, 'high');
});

test('画三个圆 → batch-draw high', () => {
  const { command, confidence } = parse('画三个圆');
  assert.equal(command.type, 'batch-draw');
  assert.equal(command.shape, 'circle');
  assert.equal(command.count, 3);
  assert.equal(confidence, 'high');
});

test('在1号右边画一个圆 → draw 相对定位 high', () => {
  const { command, confidence } = parse('在1号右边画一个圆');
  assert.equal(command.type, 'draw');
  assert.equal(command.relativeToId, 1);
  assert.equal(command.relativeSide, 'right');
  assert.equal(confidence, 'high');
});

test('画一个大圆 → draw（非 resize）', () => {
  const { command, confidence } = parse('画一个大圆');
  assert.equal(command.type, 'draw');
  assert.equal(confidence, 'high');
});

test('画一个圆角矩形 → rounded-rect', () => {
  const { command } = parse('画一个圆角矩形');
  assert.equal(command.type, 'draw');
  assert.equal(command.shape, 'rounded-rect');
});

// ─────────────────────────────────────────────────────────────
console.log('\n[parseCommandWithConfidence · 改色]');

test('把3号改成红色 → color 单目标', () => {
  const { command, confidence } = parse('把3号改成红色');
  assert.equal(command.type, 'color');
  assert.equal(command.target.value, 3);
  assert.equal(confidence, 'high');
});

test('把第3个改成绿色 → color 第N个', () => {
  const { command, confidence } = parse('把第3个改成绿色');
  assert.equal(command.type, 'color');
  assert.equal(command.target.value, 3);
  assert.equal(confidence, 'high');
});

test('改成红色 无选中 → color low', () => {
  const { command, confidence } = parse('改成红色', { hasSelection: false });
  assert.equal(command.type, 'color');
  assert.equal(confidence, 'low');
});

test('改成红色 有选中 → color high', () => {
  const { command, confidence } = parse('改成红色', { hasSelection: true });
  assert.equal(command.type, 'color');
  assert.equal(confidence, 'high');
});

test('将1号2号3号改为绿色 → batch-color 三目标', () => {
  const { command, confidence } = parse('将1号2号3号改为绿色');
  assert.equal(command.type, 'batch-color');
  assert.deepEqual(command.targetIds, [1, 2, 3]);
  assert.equal(confidence, 'high');
});

test('把1号和2号和3号改成蓝色 → batch-color 三目标', () => {
  const { command } = parse('把1号和2号和3号改成蓝色');
  assert.equal(command.type, 'batch-color');
  assert.deepEqual(command.targetIds, [1, 2, 3]);
});

test('把一号二号改成红色 → batch-color 中文编号', () => {
  const { command } = parse('把一号二号改成红色');
  assert.equal(command.type, 'batch-color');
  assert.deepEqual(command.targetIds, [1, 2]);
});

test('将10号11号改为蓝色 → batch-color 两位数编号', () => {
  const { command } = parse('将10号11号改为蓝色');
  assert.equal(command.type, 'batch-color');
  assert.deepEqual(command.targetIds, [10, 11]);
});

test('将所有圆改成蓝色 → batch-color filterShape', () => {
  const { command, confidence } = parse('将所有圆改成蓝色');
  assert.equal(command.type, 'batch-color');
  assert.equal(command.filterShape, 'circle');
  assert.equal(command.targetIds, undefined);
  assert.equal(confidence, 'high');
});

test('把3号文字改成红色 → color（非 modifyText）', () => {
  const { command, confidence } = parse('把3号文字改成红色', { hasSelection: false });
  assert.equal(command.type, 'color');
  assert.equal(confidence, 'high');
});

// ─────────────────────────────────────────────────────────────
console.log('\n[parseCommandWithConfidence · 操作]');

test('用线连接1号和3号 → connect', () => {
  const { command, confidence } = parse('用线连接1号和3号');
  assert.equal(command.type, 'connect');
  assert.equal(command.fromId, 1);
  assert.equal(command.toId, 3);
  assert.equal(confidence, 'high');
});

test('把2号连到4号 → connect 有向', () => {
  const { command } = parse('把2号连到4号');
  assert.equal(command.type, 'connect');
  assert.equal(command.fromId, 2);
  assert.equal(command.toId, 4);
});

test('删除1号 → delete', () => {
  const { command, confidence } = parse('删除1号');
  assert.equal(command.type, 'delete');
  assert.equal(command.target.value, 1);
  assert.equal(confidence, 'high');
});

test('放大2号 → resize', () => {
  const { command, confidence } = parse('放大2号');
  assert.equal(command.type, 'resize');
  assert.equal(command.factor, 1.2);
  assert.equal(command.target.value, 2);
  assert.equal(confidence, 'high');
});

test('把3号改成矩形 → shapeChange', () => {
  const { command, confidence } = parse('把3号改成矩形');
  assert.equal(command.type, 'shapeChange');
  assert.equal(command.shape, 'rect');
  assert.equal(confidence, 'high');
});

test('选中2号 → select', () => {
  const { command, confidence } = parse('选中2号');
  assert.equal(command.type, 'select');
  assert.equal(command.target.value, 2);
  assert.equal(confidence, 'high');
});

test('把3号文字改成已完成 → modifyText high', () => {
  const { command, confidence } = parse('把3号文字改成已完成');
  assert.equal(command.type, 'modifyText');
  assert.equal(command.refId, 3);
  assert.equal(confidence, 'high');
});

test('把3号改成已完成 → modifyText low', () => {
  const { command, confidence } = parse('把3号改成已完成');
  assert.equal(command.type, 'modifyText');
  assert.equal(confidence, 'low');
});

// ─────────────────────────────────────────────────────────────
console.log('\n[parseCommandWithConfidence · 系统指令]');

test('确认吧 → confirm', () => {
  const { command, confidence } = parse('确认吧');
  assert.equal(command.type, 'confirm');
  assert.equal(confidence, 'high');
});

test('好的画一个圆 → draw（非 confirm）', () => {
  const { command, confidence } = parse('好的画一个圆');
  assert.equal(command.type, 'draw');
  assert.equal(confidence, 'high');
});

test('撤销 → undo', () => {
  const { command, confidence } = parse('撤销');
  assert.equal(command.type, 'undo');
  assert.equal(confidence, 'high');
});

test('导出图片 → export', () => {
  const { command, confidence } = parse('导出图片');
  assert.equal(command.type, 'export');
  assert.equal(confidence, 'high');
});

test('关闭帮助 → closeHelp', () => {
  const { command, confidence } = parse('关闭帮助');
  assert.equal(command.type, 'closeHelp');
  assert.equal(confidence, 'high');
});

test('关闭3号文字 → 非 closeHelp', () => {
  const { command } = parse('关闭3号文字');
  assert.notEqual(command.type, 'closeHelp');
});

test('星空 → clear（同音词纠正）', () => {
  const { command, confidence } = parse('星空');
  assert.equal(command.type, 'clear');
  assert.equal(confidence, 'high');
});

// ─────────────────────────────────────────────────────────────
console.log('\n[parseCommandWithConfidence · 规则误判防护]');

test('连接1号并删除2号 → 规则仅解析 delete（须走 LLM）', () => {
  assert.equal(hasComplexSignal('连接1号并删除2号'), true);
  const { command } = parse('连接1号并删除2号');
  assert.equal(command.type, 'delete');
});

test('把4号文字改成退回并把5号改成红色 → 复杂句（须走 LLM）', () => {
  assert.equal(hasComplexSignal('把4号文字改成退回并把5号改成红色'), true);
});

test('VALID_SHAPES 包含 arrow-line', () => {
  assert.equal(VALID_SHAPES.has('arrow-line'), true);
});

// ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
