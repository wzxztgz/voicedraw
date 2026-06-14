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
import { parseCommandWithConfidence, hasComplexSignal } from './keyword.js';

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

test('isRuleFallbackEligible: modifyText 可降级', () => {
  assert.equal(isRuleFallbackEligible({
    type: 'modifyText', refId: 3, content: '已完成',
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

console.log('\n[hasComplexSignal]');

test('连接+改文字（并）→ 复杂句', () => {
  assert.equal(
    hasComplexSignal('连接四号和5号，并把五号的文字改成退回'),
    true,
  );
});

test('画一个圆 → 非复杂句', () => {
  assert.equal(hasComplexSignal('画一个圆'), false);
});

test('把3号改成红色 → 非复杂句（单动词）', () => {
  assert.equal(hasComplexSignal('把3号改成红色'), false);
});

test('画圆再画矩形 → 复杂句（双绘制动词）', () => {
  assert.equal(hasComplexSignal('画圆再画矩形'), true);
});

test('连接1号和2号 → 非复杂句（单动词）', () => {
  assert.equal(hasComplexSignal('连接1号和2号'), false);
});

console.log('\n[parseCommandWithConfidence]');

test('画一个圆 → draw high', () => {
  const { command, confidence } = parseCommandWithConfidence('画一个圆');
  assert.equal(command.type, 'draw');
  assert.equal(confidence, 'high');
});

test('把3号改成已完成 → modifyText low', () => {
  const { command, confidence } = parseCommandWithConfidence('把3号改成已完成');
  assert.equal(command.type, 'modifyText');
  assert.equal(confidence, 'low');
});

test('把3号文字改成已完成 → modifyText high', () => {
  const { command, confidence } = parseCommandWithConfidence('把3号文字改成已完成');
  assert.equal(command.type, 'modifyText');
  assert.equal(confidence, 'high');
});

test('把3号文字改成红色 → color（非 modifyText）', () => {
  const { command, confidence } = parseCommandWithConfidence('把3号文字改成红色', { hasSelection: false });
  assert.equal(command.type, 'color');
  assert.equal(confidence, 'high');
});

test('好的画一个圆 → draw（非 confirm）', () => {
  const { command, confidence } = parseCommandWithConfidence('好的画一个圆');
  assert.equal(command.type, 'draw');
  assert.equal(confidence, 'high');
});

test('确认吧 → confirm', () => {
  const { command, confidence } = parseCommandWithConfidence('确认吧');
  assert.equal(command.type, 'confirm');
  assert.equal(confidence, 'high');
});

test('改成红色 无选中 → color low', () => {
  const { command, confidence } = parseCommandWithConfidence('改成红色', { hasSelection: false });
  assert.equal(command.type, 'color');
  assert.equal(confidence, 'low');
});

test('改成红色 有选中 → color high', () => {
  const { command, confidence } = parseCommandWithConfidence('改成红色', { hasSelection: true });
  assert.equal(command.type, 'color');
  assert.equal(confidence, 'high');
});

test('关闭3号文字 → 非 closeHelp', () => {
  const { command } = parseCommandWithConfidence('关闭3号文字');
  assert.notEqual(command.type, 'closeHelp');
});

test('关闭帮助 → closeHelp', () => {
  const { command, confidence } = parseCommandWithConfidence('关闭帮助');
  assert.equal(command.type, 'closeHelp');
  assert.equal(confidence, 'high');
});

test('VALID_SHAPES 包含 arrow-line', () => {
  assert.equal(VALID_SHAPES.has('arrow-line'), true);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
