import { useState, useCallback, useMemo, useRef } from 'react';
import { useDevices } from './hooks/useDevices';
import { useWebSocket } from './hooks/useWebSocket';
import { useAuth } from './hooks/useAuth';
import { timeAgo } from './utils.js';
import StatusPill from './components/StatusPill';
import AddDeviceForm from './components/AddDeviceForm';
import DeviceCard from './components/DeviceCard';
import LogPanel from './components/LogPanel';
import Login from './components/Login';
import { useTheme } from './hooks/useTheme';
import ThemeToggle from './components/ThemeToggle';

const MAX_LOG = 200;

export default function App() {
  const { devices, addDevice, removeDevice, setDeviceState } = useDevices();
  // 主题:浅色 / 深色 / 跟随系统(localStorage 持久)
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  // 鉴权:纯 TOTP,token 存 sessionStorage(关浏览器即失效)
  const { token, login, logout, invalidate } = useAuth();
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [seenTs, setSeenTs] = useState(0);
  const [logs, setLogs] = useState([]);
  // reqId -> deviceId 映射,用于 ack 配对(用 ref 避免重渲染)
  const pendingRef = useRef(new Map());

  // 添加日志(去重用 timestamp+id)
  const addLog = useCallback((tag, message, level = 'info') => {
    setLogs(prev => {
      const entry = { id: Date.now() + Math.random(), ts: Date.now(), tag, message, level };
      return [entry, ...prev].slice(0, MAX_LOG);
    });
  }, []);

  // 推断某条 status 消息对应的设备并更新其状态(按 IP 匹配)
  const applyStatus = useCallback((msg) => {
    for (const d of devices) {
      if (!d.ip || !msg.includes(d.ip)) continue;
      if (/is Online/i.test(msg)) setDeviceState(d.id, 'online');
      else if (/Timeout/i.test(msg)) setDeviceState(d.id, 'timeout');
      else if (/Started checking/i.test(msg)) setDeviceState(d.id, 'checking');
    }
  }, [devices, setDeviceState]);

  // WebSocket 消息总入口
  const handleMessage = useCallback((m) => {
    switch (m.type) {
      case 'online':
        setDeviceOnline(!!m.online);
        if (m.lastSeen) setSeenTs(m.lastSeen);
        break;
      case 'heartbeat':
        setDeviceOnline(true);
        setSeenTs(m.ts);
        break;
      case 'status':
        addLog('设备', m.message, 'device');
        applyStatus(m.message);
        break;
      case 'ack': {
        const devId = pendingRef.current.get(m.reqId);
        if (devId != null) pendingRef.current.delete(m.reqId);
        if (m.ok) addLog('唤醒', '指令已送达 MQTT', 'info');
        else {
          addLog('唤醒', '发送失败:' + (m.error || '未知错误'), 'error');
          if (devId) {
            setDeviceState(devId, 'error');
            setTimeout(() => setDeviceState(devId, 'idle'), 3000);
          }
        }
        break;
      }
      case 'log':
        addLog('系统', m.message, m.level || 'info');
        break;
      case 'error':
        addLog('系统', m.message, 'error');
        break;
    }
  }, [addLog, applyStatus, setDeviceState]);

  const { connected, sendTrigger } = useWebSocket(handleMessage, token, invalidate);

  const handleWake = useCallback((device) => {
    const reqId = sendTrigger(device.mac, device.ip);
    if (!reqId) {
      addLog('唤醒', '服务端未连接,无法发送指令', 'error');
      return;
    }
    pendingRef.current.set(reqId, device.id);
    setDeviceState(device.id, 'waking');
    addLog('唤醒',
      `向「${device.name}」发送指令 · ${device.mac}${device.ip ? ' · 检测 ' + device.ip : ' (仅唤醒)'}`,
      'info');
  }, [sendTrigger, setDeviceState, addLog]);

  const handleAdd = useCallback((dev) => {
    addDevice(dev);
    addLog('系统', `已添加设备「${dev.name}」`, 'info');
  }, [addDevice, addLog]);

  const handleDelete = useCallback((device) => {
    if (window.confirm(`确定删除设备「${device.name}」?`)) {
      removeDevice(device.id);
      addLog('系统', `已删除设备「${device.name}」`, 'info');
    }
  }, [removeDevice, addLog]);

  const deviceStatusLabel = deviceOnline
    ? '设备在线'
    : (seenTs ? '设备离线' : '设备未知');

  const devicesList = useMemo(() => devices.map(d =>
    <DeviceCard key={d.id} device={d}
      onWake={() => handleWake(d)}
      onDelete={() => handleDelete(d)} />
  ), [devices, handleWake, handleDelete]);

  // 未登录:只渲染登录页(TOTP),不连 WS、不加载主界面
  if (!token) {
    return <Login onLogin={login} />;
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="logo">⚡</div>
          <div>
            <h1>ESP32 WoL 控制台</h1>
            <span className="subtitle">Wake-on-LAN 远程唤醒 · MQTT 转发</span>
          </div>
        </div>
        <div className="status-group">
          <StatusPill variant="ws" online={connected}
            label={connected ? '服务端已连接' : '服务端未连接'} />
          <StatusPill online={deviceOnline}
            label={deviceStatusLabel}
            sub={`最近心跳:${timeAgo(seenTs)}`} />
          <ThemeToggle mode={themeMode} onSet={setThemeMode} />
          <button className="btn btn-ghost btn-sm" onClick={logout} title="退出登录">退出</button>
        </div>
      </header>

      <main className="layout">
        <section className="panel devices-panel">
          <div className="panel-head">
            <h2>设备列表</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(o => !o)}>
              {addOpen ? '收起' : '+ 添加设备'}
            </button>
          </div>
          <AddDeviceForm open={addOpen} onAdd={handleAdd} onLog={addLog} onClose={() => setAddOpen(false)} />
          <div className="device-list">
            {devices.length === 0 && <div className="empty-hint">还没有设备,点击「添加设备」开始。</div>}
            {devicesList}
          </div>
        </section>

        <LogPanel logs={logs} onClear={() => setLogs([])} />
      </main>
    </>
  );
}
