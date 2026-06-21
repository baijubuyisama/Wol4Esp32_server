import { STATE } from '../utils.js';

// 单个设备卡片。展示信息 + 唤醒/删除按钮。
// 设备离线(超过 10s 未收到心跳)时禁用唤醒按钮 —— 此时 ESP32 不在线,
// 发出的魔术包无人接收,唤醒无意义。
export default function DeviceCard({ device, deviceOnline, onWake, onDelete }) {
  const st = STATE[device.state || 'idle'];
  const busy = device.state === 'waking' || device.state === 'checking';
  const wakeDisabled = busy || !deviceOnline;
  const wakeTitle = !deviceOnline
    ? '网关离线(10s 未收到心跳),无法唤醒'
    : busy ? '处理中…' : '发送唤醒指令';
  return (
    <div className={`device-card ${st.cls}`} data-state={st.cls}>
      <div className="card-top">
        <div className="card-name">{device.name}</div>
        <span className={`state-badge ${st.cls}`}>{st.text}</span>
      </div>
      <div className="card-meta">
        <span className="chip mono">{device.mac}</span>
        {device.ip
          ? <span className="chip mono">{device.ip}</span>
          : <span className="chip muted">无 IP · 仅唤醒</span>}
      </div>
      <div className="card-actions">
        <button className="btn btn-primary btn-sm wake-btn" disabled={wakeDisabled}
          title={wakeTitle} onClick={onWake}>
          {busy ? <span className="btn-spinner" /> : '唤醒'}
        </button>
        <button className="btn btn-ghost btn-sm del-btn" onClick={onDelete}>删除</button>
      </div>
      {!deviceOnline &&
        <div className="offline-hint">网关离线,唤醒已禁用</div>}
    </div>
  );
}
