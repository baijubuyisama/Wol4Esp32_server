import { useState, useEffect, useRef, useCallback } from 'react';
import { genReqId } from '../utils.js';

// 连接服务端 /ws,管理与 ESP32 间接通信的 WebSocket。
// 协议(与 server.js 对应):
//   in:  {type:'online'|'heartbeat'|'status'|'ack'|'log'|'error', ...}
//   out: {type:'trigger', mac, ip, reqId}
//
// 鉴权:握手时把 token 作为 ?token= 查询参数附加。服务端 verifyClient
// 校验失败会以 401 关闭握手 —— 此时停止重试并回调 onAuthFail,让 App 退回登录页。
//
// 回调注册:
//   onMessage(msg)        —— 接收所有服务端消息(由 App 分发)
//   onAuthFail()          —— 会话失效(token 无效/过期)
export function useWebSocket(onMessage, token, onAuthFail) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  const onAuthFailRef = useRef(onAuthFail);
  // 用 ref 持有最新回调与 token,避免连接重建
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onAuthFailRef.current = onAuthFail; }, [onAuthFail]);

  const authFailedRef = useRef(false);

  const connect = useCallback(() => {
    if (authFailedRef.current) return; // 已知会话失效,不再重连
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const t = token || '';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(t)}`);
    wsRef.current = ws;

    ws.onopen = () => { retryRef.current = 0; setConnected(true); };
    ws.onclose = (ev) => {
      setConnected(false);
      // 1008 / 4001 / 401 这类表示服务端拒绝鉴权;code 1000 正常关闭也不重连
      // ws 标准未直接传 HTTP 状态,这里用 close code 近似判断:未授权时浏览器给出 1006/1008
      if (ev.code === 1008 || ev.code === 4001) {
        authFailedRef.current = true;
        onAuthFailRef.current && onAuthFailRef.current();
        return;
      }
      retryRef.current += 1;
      setTimeout(connect, Math.min(1000 * retryRef.current, 8000));
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      onMessageRef.current && onMessageRef.current(m);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return; // 未登录不连
    authFailedRef.current = false;
    connect();
    return () => { if (wsRef.current) { try { wsRef.current.close(); } catch {} } };
  }, [connect, token]);

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
