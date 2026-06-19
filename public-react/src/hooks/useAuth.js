import { useState, useCallback, useRef } from 'react';

// 鉴权:纯 TOTP(无用户名)。
// token 存 sessionStorage —— 关浏览器即清空,下次打开需重新输验证码(符合需求)。
// localStorage 故意不用:那样会跨重启保持登录,与"每次关浏览器重验证"相悖。

const TOKEN_KEY = 'wol.token';

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function useAuth() {
  const [token, setToken] = useState(readToken);
  // 用于通知 App:会话失效,退回登录页
  const [expired, setExpired] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const login = useCallback(async (code) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || '登录失败');
    }
    try { sessionStorage.setItem(TOKEN_KEY, data.token); } catch {}
    setToken(data.token);
    setExpired(false);
    return data.token;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
    } catch {}
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    setToken('');
  }, []);

  // WS/API 失效时调用:清 token、标记失效
  const invalidate = useCallback(() => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    setToken('');
    setExpired(true);
  }, []);

  return { token, expired, login, logout, invalidate };
}
