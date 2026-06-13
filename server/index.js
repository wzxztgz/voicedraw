/**
 * VoiceDraw 后端服务
 * WebSocket 代理：接收前端音频流 → 转发阿里云 ASR → 回传识别结果
 */

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// 加载环境变量
try {
  const dotenvPath = path.join(__dirname, '.env');
  if (fs.existsSync(dotenvPath)) {
    const dotenv = require('dotenv');
    dotenv.config({ path: dotenvPath });
  }
} catch (e) {
  // dotenv 可选
}

const PORT = process.env.WS_PORT || 8765;

// ASR 实例（延迟加载，避免启动时就需要 API Key）
let asrInstance = null;

function getASR() {
  if (!asrInstance) {
    const DashScopeASR = require('./asr');
    asrInstance = new DashScopeASR({
      apiKey: process.env.DASHSCOPE_API_KEY,
      model: process.env.ASR_MODEL || 'paraformer-realtime-v2',
      sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
      maxSentenceSilence: parseInt(process.env.ASR_SILENCE_MS) || 1500,
    });
  }
  return asrInstance;
}

// LLM 单例（跨请求保持会话历史）
let llmInstance = null;

function getLLM() {
  if (!llmInstance) {
    const LLMService = require('./llmService');
    llmInstance = new LLMService({ apiKey: process.env.DASHSCOPE_API_KEY });
  }
  return llmInstance;
}

// 创建 HTTP 服务器（用于健康检查和静态文件）
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server });

// 存储客户端连接的 ASR 任务
const clientTasks = new Map(); // clientId -> { asrTask, lastActivity }

/**
 * 广播消息给所有连接的客户端
 */
function broadcast(message, excludeId = null) {
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.id !== excludeId) {
      client.send(data);
    }
  });
}

/**
 * 发送消息给客户端
 */
function sendToClient(client, type, data = {}) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type, ...data, timestamp: Date.now() }));
  }
}

/**
 * 清理客户端的 ASR 任务
 */
function cleanupClient(clientId) {
  const task = clientTasks.get(clientId);
  if (task) {
    if (task.asrTask) {
      try { task.asrTask.close(); } catch (e) { /* ignore */ }
    }
    clientTasks.delete(clientId);
  }
}

wss.on('connection', (ws, req) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  ws.id = clientId;
  ws.isAlive = true;

  console.log(`[Server] Client connected: ${clientId}`);
  sendToClient(ws, 'connected', { clientId });

  // 心跳检测
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());

      switch (msg.type) {
        case 'start-asr': {
          // 客户端请求开始语音识别
          console.log(`[Server] Starting ASR for ${clientId}`);

          // 清理旧任务
          cleanupClient(clientId);

          try {
            const asr = getASR();
            const asrTask = await asr.createTask();

            // 注册 ASR 结果回调
            asrTask.onResult((text, isFinal) => {
              sendToClient(ws, 'asr-result', {
                text,
                isFinal,
              });
            });

            asrTask.onComplete(() => {
              sendToClient(ws, 'asr-complete', {});
            });

            asrTask.onError((err) => {
              sendToClient(ws, 'asr-error', { error: err.message });
            });

            clientTasks.set(clientId, {
              asrTask,
              lastActivity: Date.now(),
            });

            sendToClient(ws, 'asr-ready', {});
          } catch (err) {
            console.error(`[Server] ASR start failed:`, err.message);
            sendToClient(ws, 'asr-error', { error: err.message });
          }
          break;
        }

        case 'audio': {
          // 接收前端音频数据，转发给 ASR
          const task = clientTasks.get(clientId);
          if (task && task.asrTask) {
            const audioBuffer = Buffer.from(msg.data, 'base64');
            task.asrTask.sendAudio(audioBuffer);
            task.lastActivity = Date.now();
          }
          break;
        }

        case 'stop-asr': {
          // 停止语音识别
          const task = clientTasks.get(clientId);
          if (task && task.asrTask) {
            task.asrTask.finish();
          }
          break;
        }

        case 'ping': {
          sendToClient(ws, 'pong', {});
          break;
        }

        case 'llm-parse': {
          // LLM 兜底指令解析：规则匹配 unknown 后，用 LLM 尝试理解语义
          console.log(`[Server] LLM parse request from ${clientId}: ${msg.text}`);
          try {
            const llm = getLLM();
            const result = await llm.parseBasicCommand(msg.text);
            sendToClient(ws, 'llm-parse-result', { data: result });
          } catch (err) {
            console.error('[Server] LLM parse error:', err.message);
            sendToClient(ws, 'llm-parse-error', { error: err.message });
          }
          break;
        }

        case 'llm-draw': {
          // 调用通义千问将自然语言转化为绘图配置 JSON
          // msg.sessionId 不为空时，携带多轮对话历史（描述模式积累的上下文）
          const sessionId = msg.sessionId || null;
          console.log(`[Server] LLM draw request from ${clientId}${sessionId ? ` [session:${sessionId}]` : ''}: ${msg.prompt}`);
          try {
            const llm = getLLM();
            const result = await llm.generate(msg.prompt, sessionId);
            sendToClient(ws, 'llm-result', { data: result, sessionId });
          } catch (err) {
            console.error('[Server] LLM error:', err.message);
            sendToClient(ws, 'llm-error', { error: err.message });
          }
          break;
        }

        default:
          console.log(`[Server] Unknown message type: ${msg.type}`);
      }
    } catch (e) {
      console.error(`[Server] Message parse error:`, e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[Server] Client disconnected: ${clientId}`);
    cleanupClient(clientId);
  });

  ws.on('error', (err) => {
    console.error(`[Server] Client error (${clientId}):`, err.message);
    cleanupClient(clientId);
  });
});

// 心跳定时器
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log(`[Server] Terminating dead connection: ${ws.id}`);
      cleanupClient(ws.id);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// 超时清理（5 分钟无活动）
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  clientTasks.forEach((task, clientId) => {
    if (now - task.lastActivity > 5 * 60 * 1000) {
      console.log(`[Server] Cleaning up inactive task: ${clientId}`);
      cleanupClient(clientId);
    }
  });
}, 60000);

server.listen(PORT, () => {
  console.log(`[VoiceDraw Server] Running on ws://localhost:${PORT}`);
  console.log(`[VoiceDraw Server] Health check: http://localhost:${PORT}/health`);

  if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === 'your_api_key_here') {
    console.warn('[VoiceDraw Server] WARNING: DASHSCOPE_API_KEY not configured!');
    console.warn('[VoiceDraw Server] ASR will fail until a valid API key is set in .env');
    console.warn('[VoiceDraw Server] Copy .env.example to .env and fill in your key');
  }
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  clearInterval(heartbeatInterval);
  clearInterval(cleanupInterval);
  clientTasks.forEach((_, id) => cleanupClient(id));
  wss.close();
  server.close();
  process.exit(0);
});
