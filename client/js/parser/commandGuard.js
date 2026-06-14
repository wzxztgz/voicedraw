/**
 * 指令守卫：输入清洗、执行前校验、规则降级资格
 * 与 store / UI 解耦，便于单测与长期维护。
 */

export const VALID_SHAPES = new Set([
  'circle', 'rect', 'rounded-rect', 'diamond', 'line',
  'triangle', 'star', 'ellipse', 'arrow-line',
]);

export const VALID_RELATIVE_SIDES = new Set(['right', 'left', 'above', 'below']);

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/** ASR 文本清洗；异常输入返回 null */
export function sanitizeVoiceText(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 500) return null;
  return t;
}

function isValidTarget(target) {
  return target
    && target.type === 'id'
    && Number.isInteger(target.value)
    && target.value > 0;
}

function isValidPosition(pos) {
  if (!pos || typeof pos !== 'object') return false;
  const { dx, dy } = pos;
  return [-1, 0, 1].includes(dx) && [-1, 0, 1].includes(dy);
}

function isValidColor(color) {
  return typeof color === 'string' && HEX_COLOR_RE.test(color);
}

/**
 * 执行前校验 command 结构（防御 LLM 脏数据 / 解析边界）
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateCommand(command) {
  if (!command || typeof command !== 'object' || !command.type) {
    return { ok: false, error: '无效指令结构' };
  }

  switch (command.type) {
    case 'draw': {
      if (!VALID_SHAPES.has(command.shape)) {
        return { ok: false, error: `不支持的形状：${command.shape}` };
      }
      if (command.color != null && !isValidColor(command.color)) {
        return { ok: false, error: '颜色格式无效' };
      }
      if (command.position != null && !isValidPosition(command.position)) {
        return { ok: false, error: '位置参数无效' };
      }
      if (command.relativeSide != null && !VALID_RELATIVE_SIDES.has(command.relativeSide)) {
        return { ok: false, error: '相对方位无效' };
      }
      if (command.relativeToId != null && command.relativeToId < 1) {
        return { ok: false, error: '关联对象编号无效' };
      }
      return { ok: true };
    }

    case 'color':
      if (!isValidColor(command.color)) return { ok: false, error: '颜色格式无效' };
      if (command.target != null && !isValidTarget(command.target)) {
        return { ok: false, error: '目标对象编号无效' };
      }
      return { ok: true };

    case 'move':
      if (![-1, 0, 1].includes(command.dx) || ![-1, 0, 1].includes(command.dy)) {
        return { ok: false, error: '移动方向无效' };
      }
      if (command.target != null && !isValidTarget(command.target)) {
        return { ok: false, error: '目标对象编号无效' };
      }
      return { ok: true };

    case 'moveTo':
      if (!isValidPosition(command.position)) return { ok: false, error: '目标位置无效' };
      if (command.target != null && !isValidTarget(command.target)) {
        return { ok: false, error: '目标对象编号无效' };
      }
      return { ok: true };

    case 'resize':
      if (typeof command.factor !== 'number' || command.factor < 0.1 || command.factor > 5) {
        return { ok: false, error: '缩放倍数超出范围' };
      }
      if (command.target != null && !isValidTarget(command.target)) {
        return { ok: false, error: '目标对象编号无效' };
      }
      return { ok: true };

    case 'select':
      if (!isValidTarget(command.target)) return { ok: false, error: '选中编号无效' };
      return { ok: true };

    case 'delete':
      if (command.target != null && !isValidTarget(command.target)) {
        return { ok: false, error: '删除目标编号无效' };
      }
      return { ok: true };

    case 'connect':
      if (!Number.isInteger(command.fromId) || !Number.isInteger(command.toId)
        || command.fromId < 1 || command.toId < 1) {
        return { ok: false, error: '连线端点编号无效' };
      }
      return { ok: true };

    case 'addText':
      if (!command.content || typeof command.content !== 'string') {
        return { ok: false, error: '文字内容为空' };
      }
      if (command.refId != null && command.refId < 1) {
        return { ok: false, error: '文字关联编号无效' };
      }
      return { ok: true };

    case 'modifyText':
      if (!command.content || typeof command.content !== 'string') {
        return { ok: false, error: '修改内容为空' };
      }
      if (!Number.isInteger(command.refId) || command.refId < 1) {
        return { ok: false, error: '修改目标编号无效' };
      }
      return { ok: true };

    case 'shapeChange':
      if (!VALID_SHAPES.has(command.shape)) {
        return { ok: false, error: `不支持的形状：${command.shape}` };
      }
      if (command.color != null && !isValidColor(command.color)) {
        return { ok: false, error: '颜色格式无效' };
      }
      if (command.target != null && !isValidTarget(command.target)) {
        return { ok: false, error: '目标对象编号无效' };
      }
      return { ok: true };

    case 'batch-draw': {
      const count = command.count;
      if (!VALID_SHAPES.has(command.shape)) {
        return { ok: false, error: `不支持的形状：${command.shape}` };
      }
      if (!Number.isInteger(count) || count < 1 || count > 20) {
        return { ok: false, error: '批量数量须在 1～20 之间' };
      }
      if (command.color != null && !isValidColor(command.color)) {
        return { ok: false, error: '颜色格式无效' };
      }
      return { ok: true };
    }

    case 'batch-color':
      if (!isValidColor(command.color)) return { ok: false, error: '颜色格式无效' };
      if (command.filterShape != null && !VALID_SHAPES.has(command.filterShape)) {
        return { ok: false, error: '筛选形状无效' };
      }
      return { ok: true };

    case 'compound': {
      if (!Array.isArray(command.tasks) || command.tasks.length < 1) {
        return { ok: false, error: '复合指令子任务为空' };
      }
      for (const task of command.tasks) {
        const sub = validateCommand(task);
        if (!sub.ok) return sub;
      }
      return { ok: true };
    }

    case 'undo':
    case 'redo':
    case 'clear':
    case 'export':
    case 'help':
    case 'closeHelp':
    case 'confirm':
    case 'cancel':
    case 'refine':
    case 'llm-draw':
    case 'unknown':
      return { ok: true };

    default:
      return { ok: false, error: `未知指令类型：${command.type}` };
  }
}

/**
 * LLM 失败时，是否允许用规则层已解析结果降级执行（保守白名单）
 */
export function isRuleFallbackEligible(command) {
  if (!command || command.type === 'unknown' || command.type === 'compound' || command.type === 'llm-draw') {
    return false;
  }
  const v = validateCommand(command);
  if (!v.ok) return false;

  switch (command.type) {
    case 'modifyText':
      return true;
    case 'connect':
      return command.fromId !== command.toId;
    default:
      return false;
  }
}
