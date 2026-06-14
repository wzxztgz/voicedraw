# 声绘 VoiceDraw — 纯语音智能绘图助手

> 七牛云 XEngineer 新工程师计划招募赛 · 题目二

通过语音完成绘图、编辑与图表生成。单条指令走规则快路径（<50ms），复杂复合句与流程图/图表走通义千问 LLM。

详细设计见 [`DESIGN.md`](./DESIGN.md)。

**demo视频：**【题目二：AI语言绘图助手    声绘VoiceDraw-哔哩哔哩】 https://b23.tv/XvuNIKL

---

## 快速开始

### 环境要求

- **Node.js** 18+
- **浏览器** Chrome 100+ / Edge 100+（桌面端）
- **网络** `localhost` 或 HTTPS（麦克风权限）
- **API Key** [阿里云百炼](https://bailian.console.aliyun.com)（ASR + LLM 共用）

### 1. 安装依赖

```bash
# 后端
cd server && npm install

# 前端
cd client && npm install
```

### 2. 配置 API Key

```bash
cd server
cp .env.example .env
# 编辑 .env，填入 DASHSCOPE_API_KEY
```

### 3. 启动

**Windows 一键启动**

```bash
双击 start.bat
```

> `start.bat` 使用纯 ASCII 与 `start /D` 启动，避免中文 UTF-8 在 cmd 下乱码导致命令被拆碎。会弹出 Server / Client 两个窗口，关闭即可停止服务。

**手动分别启动**

```bash
# 终端 1 — 后端 WebSocket（默认 8765）
cd server && npm start

# 终端 2 — 前端开发服（默认 3000）
cd client && npm run dev
```

### 4. 打开应用

浏览器访问 **http://localhost:3000**，允许麦克风权限后即可说话。

### 5. 运行解析器回归测试（可选）

```bash
cd client && npm run test:parser
```

---

## 功能一览

### 基础绘制与编辑（规则引擎，<500ms）

| 类别 | 示例指令 |
|------|----------|
| 图形绘制 | 「画一个圆」「画红色矩形」「在左上角画三角形」 |
| 扩展形状 | 「画菱形」「画圆角矩形」「画一条从1号指向3号的箭头」 |
| 相对位置 | 「在1号右边画矩形」 |
| 颜色修改 | 「改成红色」「把3号改为蓝色」 |
| 大小调整 | 「放大」「缩小」「再大一点」 |
| 位置移动 | 「往左移」「移到右上角」「再左一点」 |
| 形状变更 | 「改成矩形」「换成圆形」 |
| 对象选择 | 「选中3号」 |
| 删除 | 「删除1号」 |
| 连线 | 「连接1号和3号」 |
| 文字标注 | 「在2号右边加文字：已审批」 |
| 修改文字 | 「把3号文字改成已完成」（含「文字」走规则；无「文字」交 LLM 消歧） |
| 批量绘制 | 「画三个圆」 |
| 批量改色 | 「把所有圆改成蓝色」 |
| 画布操作 | 「撤销」「重做」「清除画布」「导出图片」 |
| 帮助 | 「帮助」打开面板、「关闭帮助」收起 |
| 确认/取消 | 「确认」「取消」（主要用于放弃预览；说完自动落图时较少用到） |

**规则层支持的基础形状：** 圆、矩形、直线、三角、星形、椭圆、菱形、圆角矩形、箭头线。

### 复合指令（规则快路径 + LLM 结构解析）

| 类别 | 示例指令 |
|------|----------|
| 标准复合 | 「先画红圆，然后画蓝矩形，最后画红矩形」 |
| 口语连接 | 「连接四号和5号，并把五号的文字改成退回」 |
| 跨动作复合 | 句中含两个及以上操作动词（连接/改成/删除/移动等）自动识别为复杂句 |

复合指令执行时，右下角任务弹窗会逐步显示具体操作并保留约 5 秒。

### LLM 图形生成（通义千问，约 2–5s）

| 类别 | 示例指令 |
|------|----------|
| 流程图 | 「画一个请假审批流程图」 |
| 柱状图 | 「画销售数据柱状图」 |
| 折线图 | 「画趋势折线图」 |
| 饼图 | 「画市场份额饼图」 |
| 思维导图 | 「画项目规划思维导图」 |
| 描述模式 | 说出图表意图后分段补充细节，说「完成」提交生成 |

生成后的流程图/图表元素带独立编号，可继续说「把3号改成绿色」「删除2号」继续编辑。

### 容错与兜底

- **同音词纠正**：园→圆、巨形→矩形、挂→画 等
- **ASR 分句合并**：长句被切成多段时自动缓冲拼接
- **LLM 兜底解析**：规则无法理解或低置信时走 `parseBasicCommand`
- **规则降级**：LLM 不可用时，符合条件的 modifyText / connect 等可回退规则执行

---

## 指令路由架构

```
用户说完 (isFinal)
       │
       ▼
 Layer 0  规则复合快路径（先/然后/并…，子句全高置信）
       │ 未命中
       ▼
 Layer 1  hasComplexSignal → LLM 结构解析（compound）
       │ 未命中
       ▼
 Layer 2  单条规则解析（高置信直接执行，低置信 → LLM 兜底）
       │
 Layer 3  parseLLMIntent → LLM 图形生成（图表/流程图/思维导图）
```

**设计原则：** 规则保延迟，LLM 保正确性。

---

## 项目结构

```
voicedraw/
├── client/                     # 前端
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js              # 主入口、三层路由、执行引擎
│       ├── voice/
│       │   ├── recorder.js     # 麦克风 + WebSocket + 分句合并
│       │   └── synthesizer.js  # TTS（默认关闭）
│       ├── parser/
│       │   ├── keyword.js      # 规则解析 + hasComplexSignal
│       │   ├── commandGuard.js # 输入清洗、校验、降级资格
│       │   ├── context.js      # 澄清文案
│       │   └── parser.test.js  # 回归测试
│       ├── canvas/
│       │   ├── renderer.js
│       │   ├── shapes.js
│       │   ├── grid.js         # 九宫格方位
│       │   ├── flowchart.js    # 流程图 / 思维导图
│       │   └── charts.js       # 柱状 / 折线 / 饼图
│       ├── state/store.js
│       └── ui/                 # 波形、任务列表、Toast
├── server/
│   ├── index.js                # WebSocket 路由
│   ├── asr.js                  # Paraformer 流式 ASR
│   ├── llmService.js           # 通义千问（图形生成 + 指令解析）
│   └── .env.example
├── DESIGN.md                   # 设计文档（架构 + 能力对照表）
├── start.bat                   # Windows 一键启动
└── README.md
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 原生 JavaScript (ES Module) + HTML5 Canvas + Vite |
| 后端 | Node.js + ws (WebSocket) |
| 语音识别 | 阿里云 DashScope Paraformer 实时流式 ASR |
| 指令解析 | 规则引擎 + 通义千问 qwen-turbo |
| 图形生成 | 通义千问 → JSON 配置 → Canvas 渲染 |
| 语音合成 | Web Speech API（默认关闭） |

---

## 已知限制（摘要）

- 不支持移动端适配；未实现「画一棵树/房子」等自由图形
- 多候选对象（多个同色圆）不会语音追问，默认取规则匹配结果
- 流程图结构质量依赖 LLM Prompt，极端分支场景可能画错
- **复合指令「先画再连」**：如「在右上角画矩形，然后与1号连接」走 LLM 拆句时，新图形尚未分配编号，`connect` 无法引用「刚画的图形」，该子步骤可能失败；需后续优化（如执行层传递 `lastDrawnId` 或支持「与上一图形连接」语义）
- 完整能力对照与未完成原因见 [`DESIGN.md` §3](./DESIGN.md)

