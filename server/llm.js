/**
 * LLM 服务
 * 调用阿里云 DashScope Qwen 模型，将自然语言绘图指令转换为结构化配置 JSON
 * 使用 OpenAI 兼容模式接口，方便切换其他供应商
 */

const https = require('https');

const SYSTEM_PROMPT = `你是一个专业的数据可视化助手，将用户的自然语言描述转换为标准化的图表配置JSON。

支持的图表类型：
- bar：柱状图（纵向柱子）
- line：折线图（数据点连线）
- pie：饼图（暂不支持，输出时提示不支持）

输出格式必须是合法的JSON，不要包含代码块标记（\`\`\`）、多余文字或解释，只输出JSON本身。

柱状图/折线图输出格式：
{
  "chartType": "bar",
  "title": "图表标题",
  "xAxis": ["标签1", "标签2", "标签3"],
  "series": [{"name": "系列名称", "data": [数值1, 数值2, 数值3]}],
  "unit": "单位（如万、个、%，无单位则为空字符串）"
}

饼图输出格式：
{
  "chartType": "pie",
  "title": "图表标题",
  "series": [{"name": "系列名称", "data": [{"name": "类别1", "value": 30}, {"name": "类别2", "value": 70}]}],
  "unit": ""
}

注意事项：
1. data 数组中只能是数字，不要包含单位
2. xAxis 标签数量必须与 data 数量一致
3. 如果用户没有提供具体数值，根据描述合理推断示例数据
4. 标题尽量简洁，不超过12个字`;

class LLMService {
  constructor({ apiKey, model = 'qwen-turbo' } = {}) {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * 将自然语言指令解析为图表配置
   * @param {string} userText - 用户语音指令
   * @returns {Promise<object>} 图表配置对象
   */
  async parseChartCommand(userText) {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      temperature: 0.1, // 低温度保证输出稳定
      max_tokens: 512,
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'dashscope.aliyuncs.com',
        path: '/compatible-mode/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);

            if (response.error) {
              return reject(new Error(`LLM API error: ${response.error.message || JSON.stringify(response.error)}`));
            }

            const content = response.choices?.[0]?.message?.content || '';
            console.log(`[LLM] Raw response: ${content.slice(0, 200)}`);

            // 容错提取：从响应中找到第一个完整的 JSON 对象
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              return reject(new Error(`LLM returned no valid JSON. Raw: ${content.slice(0, 100)}`));
            }

            const chartConfig = JSON.parse(jsonMatch[0]);

            // 基础校验
            if (!chartConfig.chartType) {
              return reject(new Error('LLM response missing chartType'));
            }

            resolve(chartConfig);
          } catch (e) {
            reject(new Error(`LLM parse error: ${e.message}. Raw: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('LLM request timeout (15s)'));
      });

      req.on('error', (e) => {
        reject(new Error(`LLM request failed: ${e.message}`));
      });

      req.write(body);
      req.end();
    });
  }
}

module.exports = LLMService;
