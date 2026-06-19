import { useState, useEffect, useCallback } from 'react';
import { genId } from '../utils.js';

const STORE_KEY = 'wol.devices';

// 设备列表持久化到 localStorage
export function useDevices() {
  const [devices, setDevices] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(devices));
  }, [devices]);

  const addDevice = useCallback((dev) => {
    setDevices(prev => [...prev, { id: genId(), state: 'idle', ...dev }]);
  }, []);

  const removeDevice = useCallback((id) => {
    setDevices(prev => prev.filter(d => d.id !== id));
  }, []);

  // 更新单个设备的状态字段
  const setDeviceState = useCallback((id, state) => {
    setDevices(prev => prev.map(d => (d.id === id ? { ...d, state } : d)));
  }, []);

  return { devices, addDevice, removeDevice, setDeviceState };
}
