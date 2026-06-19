// 顶栏状态药丸:WebSocket 连接状态 / ESP32 设备在线状态
export default function StatusPill({ online, label, sub, variant }) {
  const cls = variant === 'ws'
    ? (online ? 'online' : 'offline')
    : (online ? 'online' : (sub ? 'offline' : ''));
  return (
    <div className={`status-pill ${cls}`}>
      <span className="dot" />
      <div className="status-stack">
        <span>{label}</span>
        {sub && <span className="status-sub">{sub}</span>}
      </div>
    </div>
  );
}
