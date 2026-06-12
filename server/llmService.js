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

流程图：
{"drawType":"flowchart","nodes":[{"id":"n1","text":"开始","shape":"oval","level":1},{"id":"n2","text":"处理步骤","shape":"rect","level":2},{"id":"n3","text":"结束","shape":"oval","level":3}],"edges":[{"from":"n1","to":"n2","label":""},{"from":"n2","to":"n3","label":""}]}

思维导图：
{"drawType":"mindmap","root":"中心主题","branches":[{"text":"分支1","children":["子项1","子项2"]},{"text":"分支2","children":["子项3"]}]}`;

class LLMService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY;
    this.model = options.model || 'qwen-turbo';
  }

  async generate(userPrompt) {
    const body = JSON.stringify({
      model: this.model,
      input: {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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

module.exports = LLMService;
