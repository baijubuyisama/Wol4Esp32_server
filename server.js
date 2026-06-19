// ESP32-C3 Wake-on-LAN 控制器 Web 服务端
// 职责:
//   1. 通过 express 暴露前端静态页面 (React 构建产物 public-react/dist/,
//      或开发时由 Vite 5173 提供;不存在则回退到原生版 public/)
//   2. 作为 MQTT 客户端连接到固件使用的同一个 broker,
//      订阅状态/心跳主题,把消息转发给所有浏览器 (WebSocket)。
//   3. 通过 WebSocket 接收浏览器发来的唤醒指令,发布到 trigger 主题。
//
// 与固件 (src/main.cpp) 的契约:
//   - 固件订阅:   home/wol/trigger   payload 形如 "MAC" 或 "MAC;IP"
//   - 固件发布:   home/wol/status    (魔术包发送结果 / 在线检测结果)
//   - 固件发布:   home/wol/heartbeat payload 为 "alive",每 ~10s 一次
//
// 所有可配置项见下方"配置"区,均可用环境变量覆盖。

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');

// ================= 配置 =================
// MQTT broker —— 必须与固件 (src/main.cpp) 中 mqtt_server 指向同一个 broker
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USER = process.env.MQTT_USER || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const MQTT_CLIENT_ID = process.env.MQTT_CLIENT_ID ||
  'wol-server-' + Math.random().toString(16).slice(2, 8);

// MQTT 主题 —— 与固件保持一致 (src/main.cpp 第 19-21 行)
const TOPIC_TRIGGER = 'home/wol/trigger';
const TOPIC_STATUS = 'home/wol/status';
const TOPIC_HEARTBEAT = 'home/wol/heartbeat';

// HTTP / WebSocket 服务端口
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);

// 心跳判定:超过该时长未收到心跳则认为 ESP32 设备离线
// (固件每 10s 发一次,留 3 倍余量)
const HEARTBEAT_TIMEOUT_MS = 30000;
// 在线状态广播间隔
const ONLINE_BROADCAST_MS = 5000;
// ========================================

const fs = require('fs');

const app = express();
app.use(express.json());

// 静态前端托管:优先用 React 构建产物 (public-react/dist),
// 不存在时回退到原生版 public/(直接可用的旧前端)。
const REACT_DIST = path.join(__dirname, 'public-react', 'dist');
const LEGACY_PUBLIC = path.join(__dirname, 'public');
const STATIC_ROOT = fs.existsSync(path.join(REACT_DIST, 'index.html'))
  ? REACT_DIST
  : LEGACY_PUBLIC;
app.use(express.static(STATIC_ROOT));

// SPA 回退:React Router 等需要把未匹配路由交还 index.html(本应用单页,
// 主要是兼容刷新子路径场景)。
const indexFile = path.join(STATIC_ROOT, 'index.html');
if (fs.existsSync(indexFile)) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/ws') || req.path.startsWith('/api')) return next();
    res.sendFile(indexFile);
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---- 设备在线状态 (服务端侧维护,定期广播给前端) ----
let lastHeartbeatTs = 0;   // 最近一次心跳的 epoch ms
let deviceOnline = false;  // 综合判定:false 表示从未收到或已超时

const nowMs = () => Date.now();

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// 定时广播设备在线状态 (前端据此更新指示灯)
setInterval(() => {
  deviceOnline = lastHeartbeatTs > 0 &&
    (nowMs() - lastHeartbeatTs) < HEARTBEAT_TIMEOUT_MS;
  broadcast({ type: 'online', online: deviceOnline, lastSeen: lastHeartbeatTs });
}, ONLINE_BROADCAST_MS);

// ---- MQTT 客户端 ----
const mqttClient = mqtt.connect(MQTT_URL, {
  clientId: MQTT_CLIENT_ID,
  username: MQTT_USER || undefined,
  password: MQTT_PASSWORD || undefined,
  clean: true,
  reconnectPeriod: 3000,
  connectTimeout: 5000,
});

mqttClient.on('connect', () => {
  console.log(`[MQTT] 已连接 ${MQTT_URL},订阅状态/心跳主题`);
  mqttClient.subscribe([TOPIC_STATUS, TOPIC_HEARTBEAT], { qos: 0 }, (err) => {
    if (err) console.error('[MQTT] 订阅失败', err);
  });
  broadcast({ type: 'log', level: 'info', message: `MQTT 已连接 ${MQTT_URL}` });
});

mqttClient.on('reconnect', () => console.log('[MQTT] 重连中...'));

mqttClient.on('error', (err) => console.error('[MQTT] 错误', err.message));

mqttClient.on('offline', () => {
  console.warn('[MQTT] 离线');
  broadcast({ type: 'log', level: 'warn', message: 'MQTT 连接离线,重连中...' });
});

mqttClient.on('message', (topic, payload) => {
  const message = payload.toString();
  const ts = nowMs();
  if (topic === TOPIC_HEARTBEAT) {
    lastHeartbeatTs = ts;
    deviceOnline = true;
    broadcast({ type: 'heartbeat', ts, payload: message });
  } else if (topic === TOPIC_STATUS) {
    broadcast({ type: 'status', ts, topic, message });
  }
});

// ---- WebSocket: 处理前端唤醒指令 ----
wss.on('connection', (ws) => {
  console.log(`[WS] 浏览器连接 (当前 ${wss.clients.size} 个客户端)`);
  // 连接建立后立即推送一次当前在线状态
  ws.send(JSON.stringify({
    type: 'online',
    online: deviceOnline,
    lastSeen: lastHeartbeatTs,
  }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return ws.send(JSON.stringify({ type: 'error', message: '无效的 JSON' }));
    }

    if (msg.type === 'trigger') {
      // 组装 payload:MAC 或 MAC;IP,与固件 sendWOL() 约定一致
      const mac = (msg.mac || '').trim();
      const ip = (msg.ip || '').trim();

      if (mac.length !== 17) {
        return ws.send(JSON.stringify({
          type: 'ack', reqId: msg.reqId, ok: false,
          error: 'MAC 格式应为 XX:XX:XX:XX:XX:XX',
        }));
      }

      if (!mqttClient.connected) {
        return ws.send(JSON.stringify({
          type: 'ack', reqId: msg.reqId, ok: false,
          error: 'MQTT 未连接,无法发送指令',
        }));
      }

      const payload = ip ? `${mac};${ip}` : mac;
      mqttClient.publish(TOPIC_TRIGGER, payload, { qos: 0 }, (err) => {
        ws.send(JSON.stringify({
          type: 'ack',
          reqId: msg.reqId,
          ok: !err,
          error: err ? err.message : undefined,
        }));
      });
    }
  });

  ws.on('close', () => {
    console.log(`[WS] 浏览器断开 (当前 ${wss.clients.size} 个客户端)`);
  });
});

server.listen(HTTP_PORT, () => {
  console.log('========================================');
  console.log(` WoL 服务端已启动`);
  console.log(`  页面: http://localhost:${HTTP_PORT}`);
  console.log(`  WebSocket: ws://localhost:${HTTP_PORT}/ws`);
  console.log(`  MQTT: ${MQTT_URL}`);
  console.log(`  主题: ${TOPIC_TRIGGER} / ${TOPIC_STATUS} / ${TOPIC_HEARTBEAT}`);
  console.log('========================================');
});
