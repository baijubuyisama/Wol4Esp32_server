// 共用工具函数

// 生成短设备 ID
export function genId() {
  return 'd_' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36));
}

// 生成请求 ID(用于 WebSocket ack 配对)
export function genReqId() {
  return genId() + '-' + Date.now().toString(36);
}

// 把任意常见写法 (aabbccddeeff / AA-BB-... / aa:bb:...) 规范化为 XX:XX:XX:XX:XX:XX
export function normalizeMac(raw) {
  const s = (raw || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  return s.length === 12 ? s.match(/.{2}/g).join(':') : null;
}

// IP 校验,空串合法(表示不检测)
export function validIp(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) ? s : null;
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

export function timeAgo(ts) {
  if (!ts) return '从未';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return '刚刚';
  if (sec < 60) return sec + ' 秒前';
  if (sec < 3600) return Math.floor(sec / 60) + ' 分前';
  return Math.floor(sec / 3600) + ' 小时前';
}

// 设备状态 → 标签文本 + CSS class
export const STATE = {
  idle:     { text: '空闲',   cls: 'state-idle' },
  waking:   { text: '唤醒中', cls: 'state-waking' },
  checking: { text: '检测中', cls: 'state-checking' },
  online:   { text: '已上线', cls: 'state-online' },
  timeout:  { text: '超时',   cls: 'state-timeout' },
  error:    { text: '失败',   cls: 'state-error' },
};
