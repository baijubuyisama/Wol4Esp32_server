import { useState } from 'react';
import { normalizeMac, validIp } from '../utils.js';

// 添加设备表单。提交时校验 MAC/IP,合法则调用 onAdd。
// open/onClose 由父组件控制受控开关。
export default function AddDeviceForm({ open, onAdd, onLog, onClose }) {
  const [name, setName] = useState('');
  const [mac, setMac] = useState('');
  const [ip, setIp] = useState('');

  const reset = () => { setName(''); setMac(''); setIp(''); };

  const close = () => { reset(); onClose && onClose(); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const normMac = normalizeMac(mac);
    const normIp = validIp(ip);
    if (!normMac) { onLog('系统', 'MAC 格式无效,需为 6 段十六进制', 'error'); return; }
    if (ip.trim() && normIp === null) { onLog('系统', 'IP 格式无效', 'error'); return; }
    onAdd({ name: name.trim() || '未命名设备', mac: normMac, ip: normIp || '' });
    reset();
    onClose && onClose();
  };

  if (!open) return null;

  return (
    <form className="add-form" autoComplete="off" onSubmit={handleSubmit}>
      <div className="form-row">
        <input type="text" placeholder="昵称(如:主机 PC)" value={name}
          onChange={(e) => setName(e.target.value)} autoFocus />
        <input type="text" placeholder="MAC AA:BB:CC:DD:EE:FF" value={mac}
          onChange={(e) => setMac(e.target.value.toUpperCase())} />
        <input type="text" placeholder="IP 192.168.1.100(可选)" value={ip}
          onChange={(e) => setIp(e.target.value)} />
      </div>
      <div className="form-actions">
        <span className="form-hint">MAC 支持 aabbccddeeff 或 AA-BB-... 格式,会自动规范化</span>
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={close}>取消</button>
          <button type="submit" className="btn btn-primary btn-sm">保存</button>
        </div>
      </div>
    </form>
  );
}
