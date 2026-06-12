/**
 * 阿里云 DashScope Paraformer 实时语音识别封装
 * 使用 WebSocket 协议与阿里云 ASR 服务通信
 * 官方文档: https://help.aliyun.com/zh/model-studio/websocket-for-paraformer-real-time-service
 */

const WebSocket = require('ws');

class DashScopeASR {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY;
    this.model = options.model || 'paraformer-realtime-v2';
    this.sampleRate = options.sampleRate || 16000;
    this.format = options.format || 'pcm';
    this.tasks = new Map();
  }

  /**
   * 创建一个实时识别任务
   * @returns {object} { taskId, sendAudio, onResult, onComplete, onError, close }
   */
  createTask() {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      // 阿里云百炼 WebSocket 固定端点
      const url = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

      // 鉴权通过请求头传递
      const ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'user-agent': 'VoiceDraw/1.0',
        },
      });

      const task = {
        ws,
        taskId,
        closed: false,
        callbacks: {
          onResult: null,
          onComplete: null,
          onError: null,
        },
      };

      ws.on('open', () => {
        console.log(`[ASR] Task ${taskId} WebSocket connected`);

        // 发送 run-task 指令开启任务
        const startMsg = {
          header: {
            action: 'run-task',
            task_id: taskId,
            streaming: 'duplex',
          },
          payload: {
            model: this.model,
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            input: {},
            parameters: {
              format: this.format,
              sample_rate: this.sampleRate,
              language_hints: ['zh'],
            },
          },
        };

        ws.send(JSON.stringify(startMsg));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          console.log(`[ASR] Received:`, JSON.stringify(msg).slice(0, 200));

          // 处理服务端事件
          const event = msg.header?.event || msg.header?.action;

          // 任务已启动
          if (event === 'task-started') {
            console.log(`[ASR] Task ${taskId} started`);

            const api = {
              taskId,
              /**
               * 发送音频数据（二进制 PCM）
               * @param {Buffer} audioData - PCM 16-bit little-endian
               */
              sendAudio(audioData) {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(audioData);
                }
              },
              /**
               * 通知音频发送完毕
               */
              finish() {
                if (ws.readyState === WebSocket.OPEN) {
                  const finishMsg = {
                    header: {
                      action: 'finish-task',
                      task_id: taskId,
                      streaming: 'duplex',
                    },
                    payload: {
                      input: {},
                    },
                  };
                  ws.send(JSON.stringify(finishMsg));
                }
              },
              onResult(callback) {
                task.callbacks.onResult = callback;
              },
              onComplete(callback) {
                task.callbacks.onComplete = callback;
              },
              onError(callback) {
                task.callbacks.onError = callback;
              },
              close() {
                task.closed = true;
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                  ws.close();
                }
              },
            };

            resolve(api);
            return;
          }

          // 识别结果
          if (event === 'result-generated' || msg.payload?.output) {
            const output = msg.payload?.output;
            if (!output) return;

            const sentence = output.sentence;
            if (sentence) {
              const text = sentence.text || '';
              if (!text) return;

              // 判断是否为最终结果
              // 阿里云 Paraformer 使用 sentence_end 字段标记句子是否结束
              // sentence_end: true  → 最终结果
              // sentence_end: false → 中间结果（流式返回的片段）
              const sentenceEnd = sentence.sentence_end;
              const isFinal = sentenceEnd === true;

              console.log(`[ASR] text="${text}", sentence_end=${sentenceEnd}, isFinal=${isFinal}`);

              if (task.callbacks.onResult) {
                task.callbacks.onResult(text, isFinal);
              }

              if (isFinal && task.callbacks.onComplete) {
                task.callbacks.onComplete();
              }
            }
          }

          // 任务完成
          if (event === 'task-finished') {
            console.log(`[ASR] Task ${taskId} finished`);
            if (task.callbacks.onComplete) {
              task.callbacks.onComplete();
            }
          }

          // 错误处理
          if (msg.header?.code && msg.header.code !== 200) {
            const errorMsg = msg.header.message || `Error code: ${msg.header.code}`;
            console.error(`[ASR] Error: ${errorMsg}`);
            if (task.callbacks.onError) {
              task.callbacks.onError(new Error(errorMsg));
            }
          }
        } catch (e) {
          // 忽略非 JSON 消息（二进制音频响应等）
        }
      });

      ws.on('error', (err) => {
        console.error(`[ASR] WebSocket error for task ${taskId}:`, err.message);
        if (task.callbacks.onError) {
          task.callbacks.onError(err);
        }
        reject(err);
      });

      ws.on('close', (code, reason) => {
        console.log(`[ASR] Task ${taskId} WebSocket closed: ${code} ${reason}`);
        task.closed = true;
      });
    });
  }
}

module.exports = DashScopeASR;
