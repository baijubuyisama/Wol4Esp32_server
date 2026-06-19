// ESP32 WoL 控制台前端 —— 通过 WebSocket (/ws) 与服务端通信,间接收发 MQTT 消息。
// 设备列表保存在 localStorage,支持多设备管理与在线检测状态可视化。

const $ = (s) => document.querySelector(s);

const STORE_KEY = 'wol.devices';

// 设备状态 → 标签文本 + CSS class
const STATE = {
  idle:     { text: '空闲',   cls: 'state-idle' },
  waking:   { text: '唤醒中', cls: 'state-waking' },
  checking: { text: '检测中', cls: 'state-checking' },
  online:   { text: '已上线', cls: 'state-online' },
  timeout:  { text: '超时',   cls: 'state-timeout' },
  error:    { text: '失败',   cls: 'state-error' },
};

let devices = loadDevices();
const pending = new Map(); // reqId -> deviceId (等待发布确认)
let lastHeartbeatTs = 0;

// ---------- 存储 ----------
function loadDevices() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
  catch { return []; }
}
function saveDevices() { localStorage.setItem(STORE_KEY, JSON.stringify(devices)); }

// ---------- 工具 ----------
function genId() {
  return 'd_' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36));
}
// 把任意常见写法 (aabbccddeeff / AA-BB-... / aa:bb:...) 规范化为 XX:XX:XX:XX:XX:XX
function normalizeMac(raw) {
  const s = (raw || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  return s.length === 12 ? s.match(/.{2}/g).join(':') : null;
}
function validIp(raw) {
  const s = (raw || '').trim();
  if (!s) return '';            // 空表示不检测,合法
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) ? s : null;
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}
function timeAgo(ts) {
  if (!ts) return '从未';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return '刚刚';
  if (sec < 60) return sec + ' 秒前';
  if (sec < 3600) return Math.floor(sec / 60) + ' 分前';
  return Math.floor(sec / 3600) + ' 小时前';
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- WebSocket ----------
let ws, wsRetry = 0;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { wsRetry = 0; setWsBadge(true); addLog('系统', '已连接服务端', 'info'); };
  ws.onclose = () => { setWsBadge(false); addLog('系统', '与服务端连接断开,重连中…', 'warn'); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    handle(m);
  };
}
function scheduleReconnect() {
  wsRetry++;
  setTimeout(connectWS, Math.min(1000 * wsRetry, 8000));
}
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ---------- 消息处理 ----------
function handle(m) {
  switch (m.type) {
    case 'online':
      updateDeviceStatus(m.online, m.lastSeen);
      break;
    case 'heartbeat':
      lastHeartbeatTs = m.ts;
      updateDeviceStatus(true, m.ts);
      break;
    case 'status':
      addLog('设备', m.message, 'device');
      applyStatusToDevice(m.message);
      break;
    case 'ack':
      handleAck(m);
      break;
    case 'log':
      addLog('系统', m.message, m.level || 'info');
      break;
    case 'error':
      addLog('系统', m.message, 'error');
      break;
  }
}

// 根据 status 消息内容推断对应设备的在线检测状态
function applyStatusToDevice(msg) {
  for (const d of devices) {
    if (!d.ip || !msg.includes(d.ip)) continue;
    if (/is Online/i.test(msg)) setDevState(d.id, 'online');
    else if (/Timeout/i.test(msg)) setDevState(d.id, 'timeout');
    else if (/Started checking/i.test(msg)) setDevState(d.id, 'checking');
  }
}

function handleAck(m) {
  const devId = pending.get(m.reqId);
  if (devId == null) return;
  pending.delete(m.reqId);
  if (m.ok) {
    addLog('唤醒', '指令已送达 MQTT', 'info');
  } else {
    addLog('唤醒', '发送失败:' + (m.error || '未知错误'), 'error');
    setDevState(devId, 'error');
    setTimeout(() => setDevState(devId, 'idle'), 3000);
  }
}

// ---------- 状态指示 ----------
function updateDeviceStatus(online, ts) {
  if (ts) lastHeartbeatTs = ts;
  const pill = $('#deviceStatus');
  pill.classList.toggle('online', !!online);
  pill.classList.toggle('offline', !online && lastHeartbeatTs > 0);
  $('#statusText').textContent = online ? '设备在线' : (lastHeartbeatTs ? '设备离线' : '设备未知');
}
function setWsBadge(online) {
  const el = $('#wsStatus');
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
  el.querySelector('.ws-label').textContent = online ? '服务端已连接' : '服务端断开';
}
function setDevState(id, key) {
  const d = devices.find(x => x.id === id);
  if (!d) return;
  d.state = key;
  const card = $(`.device-card[data-id="${id}"]`);
  if (!card) return;
  const badge = card.querySelector('.state-badge');
  badge.textContent = STATE[key].text;
  badge.className = 'state-badge ' + STATE[key].cls;
  card.dataset.state = STATE[key].cls;
  card.querySelector('.wake-btn').disabled = (key === 'waking' || key === 'checking');
}

// ---------- 渲染 ----------
function renderDevices() {
  const list = $('#deviceList');
  $('#emptyHint').classList.toggle('hidden', devices.length > 0);
  list.innerHTML = devices.map(renderCard).join('');
  list.querySelectorAll('.wake-btn').forEach(b => b.addEventListener('click', onWake));
  list.querySelectorAll('.del-btn').forEach(b => b.addEventListener('click', onDel));
}
function renderCard(d) {
  const st = STATE[d.state || 'idle'];
  return `
  <div class="device-card" data-id="${d.id}" data-state="${st.cls}">
    <div class="card-top">
      <div class="card-name">${escapeHtml(d.name)}</div>
      <span class="state-badge ${st.cls}">${st.text}</span>
    </div>
    <div class="card-meta">
      <span class="chip mono">${d.mac}</span>
      ${d.ip ? `<span class="chip mono">${d.ip}</span>` : '<span class="chip muted">无 IP · 仅唤醒</span>'}
    </div>
    <div class="card-actions">
      <button class="btn btn-primary btn-sm wake-btn">唤醒</button>
      <button class="btn btn-ghost btn-sm del-btn">删除</button>
    </div>
  </div>`;
}

function onWake(e) {
  const id = e.currentTarget.closest('.device-card').dataset.id;
  const d = devices.find(x => x.id === id);
  if (!d) return;
  const reqId = genId() + '-' + Date.now().toString(36);
  pending.set(reqId, id);
  setDevState(id, 'waking');
  addLog('唤醒', `向「${d.name}」发送指令 · ${d.mac}${d.ip ? ' · 检测 ' + d.ip : ' (仅唤醒)'}`, 'info');
  send({ type: 'trigger', mac: d.mac, ip: d.ip || '', reqId });
}
function onDel(e) {
  const id = e.currentTarget.closest('.device-card').dataset.id;
  const d = devices.find(x => x.id === id);
  if (!d) return;
  if (confirm(`确定删除设备「${d.name}」?`)) {
    devices = devices.filter(x => x.id !== id);
    saveDevices();
    renderDevices();
    addLog('系统', `已删除设备「${d.name}」`, 'info');
  }
}

// ---------- 添加表单 ----------
function bindAddForm() {
  $('#addBtn').addEventListener('click', () => {
    $('#addForm').classList.toggle('hidden');
    if (!$('#addForm').classList.contains('hidden')) $('#devName').focus();
  });
  $('#cancelAdd').addEventListener('click', () => {
    $('#addForm').classList.add('hidden');
    $('#addForm').reset();
  });
  $('#devMac').addEventListener('input', (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
  });
  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#devName').value.trim() || '未命名设备';
    const mac = normalizeMac($('#devMac').value);
    const ipRaw = $('#devIp').value.trim();
    const ip = validIp(ipRaw);

    if (!mac) { addLog('系统', 'MAC 格式无效,需为 6 段十六进制', 'error'); return; }
    if (ipRaw && ip === null) { addLog('系统', 'IP 格式无效', 'error'); return; }

    devices.push({ id: genId(), name, mac, ip: ip || '', state: 'idle' });
    saveDevices();
    renderDevices();
    addLog('系统', `已添加设备「${name}」`, 'info');
    $('#addForm').reset();
    $('#addForm').classList.add('hidden');
  });
}

// ---------- 日志 ----------
const MAX_LOG = 200;
function addLog(tag, msg, level = 'info') {
  const list = $('#logList');
  const row = document.createElement('div');
  row.className = 'log-row log-' + level;
  row.innerHTML =
    `<span class="log-time">${fmtTime(Date.now())}</span>` +
    `<span class="log-tag">${escapeHtml(tag)}</span>` +
    `<span class="log-msg">${escapeHtml(msg)}</span>`;
  list.prepend(row);
  while (list.children.length > MAX_LOG) list.removeChild(list.lastChild);
}

// ---------- 启动 ----------
bindAddForm();
renderDevices();
connectWS();
addLog('系统', '控制台已启动,等待服务端连接…', 'info');

// 每秒刷新"最近心跳"相对时间
setInterval(() => {
  $('#lastSeenText').textContent = '最近心跳:' + timeAgo(lastHeartbeatTs);
}, 1000);
