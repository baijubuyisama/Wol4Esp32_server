import { fmtTime } from '../utils.js';

// 实时日志面板。最新日志在顶部,最多保留 N 条。
export default function LogPanel({ logs, onClear }) {
  return (
    <aside className="panel log-panel">
      <div className="panel-head">
        <h2>实时日志</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClear}>清空</button>
      </div>
      <div className="log-list">
        {logs.length === 0 && <div className="empty-hint">暂无日志,唤醒设备后这里会显示实时消息流</div>}
        {logs.map((l) => (
          <div key={l.id} className={`log-row log-${l.level}`}>
            <span className="log-time">{fmtTime(l.ts)}</span>
            <span className="log-tag">{l.tag}</span>
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
