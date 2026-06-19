import { STATE } from '../utils.js';

// 单个设备卡片。展示信息 + 唤醒/删除按钮。
export default function DeviceCard({ device, onWake, onDelete }) {
  const st = STATE[device.state || 'idle'];
  const busy = device.state === 'waking' || device.state === 'checking';
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
        <button className="btn btn-primary btn-sm wake-btn" disabled={busy} onClick={onWake}>
          {busy ? <span className="btn-spinner" /> : '唤醒'}
        </button>
        <button className="btn btn-ghost btn-sm del-btn" onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}
