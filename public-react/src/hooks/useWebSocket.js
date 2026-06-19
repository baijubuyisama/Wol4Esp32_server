import { useState, useEffect, useRef, useCallback } from 'react';
import { genReqId } from '../utils.js';

// 连接服务端 /ws,管理与 ESP32 间接通信的 WebSocket。
// 协议(与 server.js 对应):
//   in:  {type:'online'|'heartbeat'|'status'|'ack'|'log'|'error', ...}
//   out: {type:'trigger', mac, ip, reqId}
//
// 回调注册:
//   onMessage(msg)        —— 接收所有服务端消息(由 App 分发)
//   onAck(reqId, devId)   —— ack 配对(通过 send() 返回的 reqId 关联到设备)
export function useWebSocket(onMessage) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  // 用 ref 持有最新回调,避免连接重建
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const connect = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => { retryRef.current = 0; setConnected(true); };
    ws.onclose = () => {
      setConnected(false);
      retryRef.current += 1;
      setTimeout(connect, Math.min(1000 * retryRef.current, 8000));
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      onMessageRef.current && onMessageRef.current(m);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { if (wsRef.current) { try { wsRef.current.close(); } catch {} } };
  }, [connect]);

  const sendTrigger = useCallback((mac, ip) => {
    const reqId = genReqId();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'trigger', mac, ip: ip || '', reqId }));
      return reqId;
    }
    return null;
  }, []);

  return { connected, sendTrigger };
}
