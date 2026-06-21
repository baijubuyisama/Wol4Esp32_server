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
// (固件每 10s 发一次;超过一个周期未收到即判离线,前端据此禁用唤醒)
const HEARTBEAT_TIMEOUT_MS = 10000;
// 在线状态广播间隔
const ONLINE_BROADCAST_MS = 5000;
// ========================================

const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ============== 鉴权: TOTP + 会话令牌 ==============
// 设计:纯 TOTP(无用户名),单 secret。登录成功发一个随机 session token,
// 有效期 SESSION_TTL;token 存内存 Set(进程重启即全部失效,需重新登录)。
// 浏览器侧 token 存 sessionStorage —— 关浏览器即失效(符合"每次关浏览器重验证")。
// 受保护:/api/* 带 Authorization 头; /ws 握手带 ?token= 查询参数。

const TOTP_SECRET = process.env.TOTP_SECRET || '';   // base32 (A-Z2-7)
const SESSION_TTL_MS = (parseInt(process.env.SESSION_TTL || '43200', 10)) * 1000;
const sessions = new Map(); // token -> { expire: ms }

if (!TOTP_SECRET) {
  console.error('[AUTH] 缺少 TOTP_SECRET 环境变量,请在 /etc/wol-server.env 配置后重启');
}

// base32 解码(RFC 4648)
function base32Decode(str) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = [];
  for (const ch of str.toUpperCase().replace(/=+$/, '')) {
    const idx = ALPHA.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// 校验 6 位 TOTP 码;允许 ±1 个 30s 窗口容忍时钟漂移
function verifyTotp(code) {
  const key = base32Decode(TOTP_SECRET);
  const step = 30;
  const t = Math.floor(Date.now() / 1000 / step);
  for (const offset of [0, -1, 1]) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(t + offset));
    const hmac = crypto.createHmac('sha1', key).update(counter).digest();
    const o = hmac[hmac.length - 1] & 0x0f;
    const truncated = ((hmac[o] & 0x7f) << 24 | hmac[o+1] << 16 | hmac[o+2] << 8 | hmac[o+3]) % 1000000;
    if (String(truncated).padStart(6, '0') === String(code).trim()) return true;
  }
  return false;
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { expire: Date.now() + SESSION_TTL_MS });
  return token;
}

function isAuthorized(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expire) { sessions.delete(token); return false; }
  return true;
}

// 从请求取 token:头 Authorization: Bearer xxx,或查询参数 ?token= (WS 用)
function extractToken(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

// 统一鉴权中间件:保护 /api/*
function requireAuth(req, res, next) {
  if (!isAuthorized(extractToken(req))) {
    return res.status(401).json({ ok: false, error: '未登录或会话已过期' });
  }
  next();
}
// =================================================

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
    // /ws 由 WebSocket 服务接管; /api/* 走各自路由;其余回退 index.html(SPA)
    if (req.path.startsWith('/api')) return next();
    res.sendFile(indexFile);
  });
}

// ---- 鉴权 API ----
// 登录:POST /api/login { code: "123456" } -> { ok, token }
app.post('/api/login', (req, res) => {
  const code = req.body && req.body.code;
  if (!code || !String(code).match(/^\d{6}$/)) {
    return res.status(400).json({ ok: false, error: '请输入 6 位验证码' });
  }
  if (!TOTP_SECRET) {
    return res.status(500).json({ ok: false, error: '服务端未配置 TOTP_SECRET' });
  }
  if (!verifyTotp(code)) {
    return res.status(401).json({ ok: false, error: '验证码错误或已过期' });
  }
  const token = createSession();
  res.json({ ok: true, token, ttl: Math.floor(SESSION_TTL_MS / 1000) });
});

// 登出:POST /api/logout -> 注销当前 token
app.post('/api/logout', (req, res) => {
  const token = extractToken(req);
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// 检查当前会话是否有效(前端刷新时探测,免得直接打点子页面)
app.get('/api/session', requireAuth, (req, res) => {
  res.json({ ok: true });
});

// 注意:不提供任何获取 TOTP secret 的接口。secret 是登录凭据,
// 只能通过带外途径(本地 .secrets.local 备忘)交给使用者手动录入验证器,
// 绝不通过本服务分发 —— 否则任何人都能自助配对、绕过鉴权。

const server = http.createServer(app);
// WebSocket 握手前校验 token:未携带或无效直接拒绝(返回 401)
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info, cb) => {
    // 从查询串 ?token=xxx 取令牌
    const u = new URL(info.req.url, 'http://localhost');
    const token = u.searchParams.get('token');
    if (isAuthorized(token)) cb(true);
    else cb(false, 401, '未登录');
  },
});

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
