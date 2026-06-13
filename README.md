# 声绘 VoiceDraw - 纯语音智能绘图助手

> 七牛云 XEngineer 新工程师计划招募赛 - 题目二

## 快速开始

### 1. 安装依赖

```bash
# 后端
cd server && npm install

# 前端
cd client && npm install
```

### 2. 配置阿里云 API Key

```bash
cd server
cp .env.example .env
# 编辑 .env，填入你的阿里云百炼 API Key
```

获取 API Key: https://bailian.console.aliyun.com

### 3. 启动服务

**方式一：一键启动（Windows）**
```bash
双击 start.bat
```

**方式二：分别启动**
```bash
# 终端 1 - 启动后端
cd server && node index.js

# 终端 2 - 启动前端
cd client && npx vite --host
```

### 4. 打开浏览器

访问 http://localhost:3000

> 注意：需要 Chrome 100+ 或 Edge 100+，且通过 HTTPS 或 localhost 访问（麦克风权限要求）

## 支持的语音指令

| 指令类型 | 示例 |
|---------|------|
| 图形绘制 | "画一个圆"、"画一个红色的矩形"、"在左上角画一个三角形" |
| 颜色修改 | "改成红色"、"设置颜色为蓝色" |
| 大小调整 | "放大"、"缩小"、"再大一点" |
| 位置移动 | "往左移一点"、"移到右上角"、"再左一点" |
| 对象选择 | "选中3号"、"选中左上角的圆" |
| 画布操作 | "清除画布"、"撤销"、"重做" |
| 确认/取消 | "确认"、"取消" |
| 帮助 | "帮助"打开面板、"关闭"收起面板 |
| LLM 图表 | "画一个请假流程图"、"画销售柱状图"、"画思维导图" |
| 复合指令 | "先画一个红色的圆，然后画一个蓝色的矩形" |
| 批量操作 | "画三个圆"、"把所有圆改成蓝色" |

## 核心亮点

### 1. 可视化预渲染反馈
用户说话过程中实时检测关键词，画布即时显示半透明预览图形，确认后转为正式图形。

### 2. 空间网格 + 序号标签对象指代
画布划分为九宫格，每个图形自动分配序号标签，支持"选中3号"或"选中左上角的圆"精准指代。

### 3. 对话式纠错微调
自动继承上一步操作上下文，支持"再左一点"、"再大一点"连续微调。

### 4. 复合指令瀑布流执行
"先画一个红色的圆，然后在右边画一个蓝色的矩形"自动拆解为分步任务，可视化执行进度。

### 5. 规则快路径 + LLM 三层路由
单条高频指令走关键词规则（<50ms）；复杂复合指令主动路由 LLM 结构解析；流程图/图表类走 LLM 图形生成（通义千问）。

### 6. 视觉优先反馈（零鼠标纯语音）
全部绘图操作通过语音完成，UI 无鼠标交互入口。操作结果通过 Canvas 即时渲染 + Toast 提示反馈；TTS 默认关闭，避免 Demo 时扬声器声音被 ASR 误识别（可通过 `voiceSynth.setEnabled(true)` 恢复）。

## 技术架构

```
前端 (Browser)                    后端 (Node.js)
┌────────────────────┐            ┌──────────────────┐
│ 麦克风采集          │            │ WebSocket 服务    │
│     ↓              │  WebSocket │     ↓            │
│ 三层指令路由        │ ←────────→ │ 阿里云 Paraformer │
│  (规则 / LLM解析   │            │   流式 ASR        │
│   / LLM图形生成)   │            │     ↓            │
│     ↓              │            │ 通义千问 LLM      │
│ Canvas 渲染器       │            └──────────────────┘
│     ↓              │
│ Toast 视觉反馈      │
└────────────────────┘
```

## 项目结构

```
voicedraw/
├── client/                     # 前端
│   ├── index.html              # 入口页面
│   ├── css/style.css           # 样式
│   ├── js/
│   │   ├── app.js              # 主入口 + 指令执行引擎
│   │   ├── voice/
│   │   │   ├── recorder.js      # 麦克风采集 + WebSocket
│   │   │   └── synthesizer.js   # 语音合成反馈
│   │   ├── parser/
│   │   │   ├── keyword.js       # 关键词匹配指令解析
│   │   │   └── context.js       # 上下文管理
│   │   ├── canvas/
│   │   │   ├── renderer.js      # Canvas 渲染器
│   │   │   ├── shapes.js        # 图形类定义
│   │   │   ├── grid.js          # 九宫格系统
│   │   │   ├── flowchart.js     # 流程图/思维导图生成
│   │   │   └── charts.js        # 柱状图/折线图/饼图生成
│   │   ├── state/
│   │   │   └── store.js         # 全局状态管理
│   │   └── ui/
│   │       ├── waveform.js      # 语音波形指示器
│   │       ├── tasklist.js      # 任务瀑布流
│   │       └── toast.js         # 提示消息
│   └── vite.config.js
├── server/                     # 后端
│   ├── index.js                # WebSocket 服务入口
│   ├── asr.js                  # 阿里云 ASR 封装
│   ├── llmService.js           # 通义千问 LLM 服务
│   ├── package.json
│   └── .env.example            # 环境变量模板
└── start.bat                   # 一键启动脚本
```

## 技术栈

- **前端**: 原生 JavaScript + HTML5 Canvas + Vite
- **后端**: Node.js + ws (WebSocket)
- **语音识别**: 阿里云 DashScope Paraformer 实时流式 ASR
- **大模型**: 阿里云通义千问（复杂指令解析 + 图表/流程图生成）
- **语音合成**: 浏览器 Web Speech API（默认关闭，Demo 防 ASR 回声）
