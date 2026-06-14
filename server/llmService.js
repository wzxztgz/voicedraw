/**
 * 通义千问 LLM 服务
 * 将自然语言绘图指令解析为结构化绘图配置 JSON
 * 使用阿里云 DashScope HTTP API（与 ASR 同一平台，无需额外账号）
 */
const https = require('https');

const SYSTEM_PROMPT = `你是一个绘图配置助手。将用户指令转化为绘图 JSON 配置。画布为 800×600。
支持以下格式，选择最匹配的一种输出，只返回 JSON，不要包含任何其他文字、注释或代码块标记：

柱状图：
{"drawType":"bar","title":"标题","xAxis":["一月","二月"],"data":[10,20],"unit":"万"}

折线图：
{"drawType":"line","title":"标题","xAxis":["一月","二月"],"data":[10,20],"unit":"万"}

饼图：
{"drawType":"pie","title":"标题","labels":["A类","B类"],"data":[30,70]}

流程图（严格遵守节点形状规则）：
节点形状规则（shape 字段必须按此规则填写，不可随意使用）：
- 开始节点、结束节点 → shape 必须为 "oval"（椭圆/圆角矩形）
- 普通流程步骤节点（操作、处理、执行）→ shape 必须为 "rect"（矩形）
- 判断节点、条件分支节点（是/否、通过/不通过、成功/失败等）→ shape 必须为 "diamond"（菱形）
示例（一个包含判断分支的完整流程图）：
{"drawType":"flowchart","nodes":[{"id":"n1","text":"开始","shape":"oval","level":1},{"id":"n2","text":"提交申请","shape":"rect","level":2},{"id":"n3","text":"审批通过？","shape":"diamond","level":3},{"id":"n4","text":"执行处理","shape":"rect","level":4},{"id":"n5","text":"退回修改","shape":"rect","level":4},{"id":"n6","text":"结束","shape":"oval","level":5}],"edges":[{"from":"n1","to":"n2","label":""},{"from":"n2","to":"n3","label":""},{"from":"n3","to":"n4","label":"通过"},{"from":"n3","to":"n5","label":"拒绝"},{"from":"n4","to":"n6","label":""},{"from":"n5","to":"n2","label":"重新提交"}]}

思维导图：
{"drawType":"mindmap","root":"中心主题","branches":[{"text":"分支1","children":["子项1","子项2"]},{"text":"分支2","children":["子项3"]}]}`;

class LLMService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY;
    this.model = options.model || 'qwen-turbo';
    // sessionId → messages[]（多轮会话历史）
    this._sessions = new Map();
    // sessionId → clearTimeout handle（10分钟无活动自动清理）
    this._sessionTimers = new Map();
  }

  /**
   * 获取会话历史
   */
  _getHistory(sessionId) {
    return sessionId ? (this._sessions.get(sessionId) || []) : [];
  }

  /**
   * 追加本轮对话到会话历史，并刷新过期计时器
   */
  _appendHistory(sessionId, userPrompt, assistantContent) {
    if (!sessionId) return;
    const history = this._sessions.get(sessionId) || [];
    history.push({ role: 'user', content: userPrompt });
    history.push({ role: 'assistant', content: assistantContent });
    this._sessions.set(sessionId, history);

    // 刷新 10 分钟过期计时器
    if (this._sessionTimers.has(sessionId)) clearTimeout(this._sessionTimers.get(sessionId));
    this._sessionTimers.set(sessionId, setTimeout(() => this.clearSession(sessionId), 10 * 60 * 1000));
  }

  /**
   * 清除会话历史（生成完成后或手动取消时调用）
   */
  clearSession(sessionId) {
    if (!sessionId) return;
    this._sessions.delete(sessionId);
    if (this._sessionTimers.has(sessionId)) {
      clearTimeout(this._sessionTimers.get(sessionId));
      this._sessionTimers.delete(sessionId);
    }
  }

  /**
   * 调用通义千问生成绘图配置
   * @param {string} userPrompt  - 本轮用户输入
   * @param {string|null} sessionId - 会话 ID（多轮时传入，null 表示单次调用）
   */
  async generate(userPrompt, sessionId = null) {
    const history = this._getHistory(sessionId);

    const body = JSON.stringify({
      model: this.model,
      input: {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: userPrompt },
        ],
      },
      parameters: {
        result_format: 'message',
        temperature: 0.1,
        max_tokens: 1200,
      },
    });

    return new Promise((resolve, reject) => {
      const reqOptions = {
        hostname: 'dashscope.aliyuncs.com',
        path: '/api/v1/services/aigc/text-generation/generation',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 20000,
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.code) {
              return reject(new Error(`LLM API Error: ${response.message || response.code}`));
            }
            const content = response.output?.choices?.[0]?.message?.content;
            if (!content) return reject(new Error('LLM returned empty content'));

            // 容错提取 JSON（去除 markdown 代码块标记）
            const jsonStr = content
              .replace(/^```json\s*/i, '')
              .replace(/^```\s*/i, '')
              .replace(/```\s*$/i, '')
              .trim();

            const parsed = JSON.parse(jsonStr);

            // 保存本轮历史（存原始 JSON 字符串，保持可读性）
            this._appendHistory(sessionId, userPrompt, jsonStr);

            resolve(parsed);
          } catch (e) {
            reject(new Error(`LLM parse failed: ${e.message} | raw: ${data.slice(0, 300)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('LLM request timeout (20s)'));
      });
      req.write(body);
      req.end();
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 基础指令解析（兜底用）
// 当规则解析器返回 unknown 时，用此 prompt 让 LLM 尝试理解用户意图，
// 输出与前端 command 结构完全兼容的 JSON。
// ─────────────────────────────────────────────────────────────────────────────
const PARSE_SYSTEM_PROMPT = `你是一个语音绘图指令解析器。将中文语音输入转化为绘图命令JSON。
只返回合法JSON，不含任何解释、代码块标记或多余文字。
画布：800×600，坐标原点左上角。

【判断规则】
- 若句子包含「先/然后/接着/最后/并且/还要/之后」等分隔词，或者含有两个及以上绘制动作，则输出 compound 类型。
- 否则选择下列单条命令中最匹配的一种。

【单条命令格式】

绘制图形（shape: circle/rect/line/triangle/star/ellipse/diamond/rounded-rect/arrow-line）：
绝对位置：{"type":"draw","shape":"circle","color":"#FF6B6B","position":{"dx":0,"dy":0}}
shape 取值：circle=圆形 rect=矩形 rounded-rect=圆角矩形 diamond=菱形 arrow-line=箭头线
color 未提及时省略；position 未提及时省略；dx/dy 值域[-1,0,1]，左=-1右=1上=-1下=1
箭头线连接两对象（从/由/自 N号指向M号）：{"type":"draw","shape":"arrow-line","fromId":4,"toId":1}
箭头线方位起止：{"type":"draw","shape":"arrow-line","fromPosition":{"dx":-1,"dy":-1},"toPosition":{"dx":1,"dy":1}}
fromId/toId 与 fromPosition/toPosition 可组合（一端编号一端方位）；勿用 connect 表示箭头
若用户描述「在N号（右边/左边/上面/下面/旁边）画某形状」，使用相对位置格式（与 position 互斥）：
{"type":"draw","shape":"rect","relativeToId":1,"relativeSide":"right"}
relativeSide 取值：right=右 left=左 above=上 below=下
注意：即使句中无「画」字，「在N号方位+形状词」也是绘制意图，用相对位置格式
注意：禁止将「在N号方位+形状」解析为 select；「花园」「花圆」在此语境下均代表「画圆」

修改颜色：{"type":"color","color":"#FF6B6B","targetId":3}  （targetId 无指定则 null）

相对移动（方向移动）：{"type":"move","dx":1,"dy":0,"distance":30,"targetId":null}

绝对移动（移动到某位置）：{"type":"moveTo","position":{"dx":1,"dy":-1},"targetId":null}

缩放：{"type":"resize","factor":1.2,"targetId":null}  （放大 1.2-2.0，缩小 0.5-0.8）

删除：{"type":"delete","targetId":null}

选中：{"type":"select","targetId":1}  （targetId 必须有值；禁止用位置或形状描述选中，必须说编号）

撤销/重做/清空：{"type":"undo"} | {"type":"redo"} | {"type":"clear"}

连接两个图形（用线连接）：{"type":"connect","fromId":1,"toId":2}

改变形状（保留位置和颜色，仅换形状）：{"type":"shapeChange","shape":"circle","color":null,"targetId":null}
shape 支持：circle/rect/rounded-rect/diamond/line/triangle/star/ellipse/arrow-line

添加文字标注：{"type":"addText","content":"文字内容","refId":1,"side":null}
side 为方位 right/left/above/below，写在图形内部时为 null

修改文字内容（图形内标签、流程图节点文字或独立文字对象）：
{"type":"modifyText","refId":3,"content":"已完成"}
与 color 区分：「把N号改成红色/蓝色」是 color；「把N号改成已完成」「把N号文字换成待审核」是 modifyText

批量绘制：{"type":"batch-draw","shape":"circle","color":"#FF6B6B","count":3}
count 为数量；color 未提及时省略

批量改色：{"type":"batch-color","color":"#45B7D1","filterShape":"circle"}
filterShape 省略或 null 表示改全部可交互对象；有形状词时填 circle/rect 等

导出图片：{"type":"export"}

打开帮助/查看可用指令：{"type":"help"}
关闭帮助面板：{"type":"closeHelp"}
与修改文字区分：「关闭帮助」「关掉说明」是 closeHelp；「关闭3号文字」不是 closeHelp

编号字段 refId/targetId/fromId/toId 一律用阿拉伯数字（三号→3）

【复合指令格式】（含多个步骤时必须返回 compound，禁止只返回第一步）：
{"type":"compound","tasks":[
  {"type":"draw","shape":"circle","color":"#FF6B6B"},
  {"type":"draw","shape":"rect","color":"#45B7D1"},
  {"type":"color","color":"#96CEB4","targetId":1}
]}
tasks 按句子顺序排列；支持混合类型：draw + color + connect + move + delete + shapeChange + addText + modifyText + batch-draw + batch-color
示例：「先画圆，然后把1号改成红色」→ compound 含 draw + color(targetId:1)
示例：「先画两个圆，然后连接1号和2号」→ compound 含两个 draw + connect
相对位置子句用 relativeToId + relativeSide，不用九宫格 position
无法识别的步骤跳过，不要放入 tasks；但至少放入所有能识别的步骤

无法识别：{"type":"unknown"}

颜色：红=#FF6B6B 蓝=#45B7D1 绿=#96CEB4 黄=#FFEAA7 紫=#DDA0DD 橙=#FFA07A 黑=#333333 白=#FFFFFF 粉=#FFB6C1 青=#00CED1 灰=#999999`;

LLMService.prototype.parseBasicCommand = async function (userText) {
  const body = JSON.stringify({
    model: this.model,
    input: {
      messages: [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    },
    parameters: {
      result_format: 'message',
      temperature: 0.0,   // 解析任务要求确定性输出，温度设为 0
      max_tokens: 600,    // compound 任务数组较长，提升上限
    },
  });

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: 'dashscope.aliyuncs.com',
      path: '/api/v1/services/aigc/text-generation/generation',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,   // 兜底解析超时设短一点（10s），避免 UI 长时间等待
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.code) return reject(new Error(`LLM Parse Error: ${response.message || response.code}`));
          const content = response.output?.choices?.[0]?.message?.content;
          if (!content) return reject(new Error('LLM parse: empty content'));
          const jsonStr = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
          resolve(JSON.parse(jsonStr));
        } catch (e) {
          reject(new Error(`LLM parse failed: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM parse timeout (10s)')); });
    req.write(body);
    req.end();
  });
};

module.exports = LLMService;
