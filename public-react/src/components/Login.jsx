import { useState, useEffect, useRef } from 'react';

// 登录页:输入 6 位 TOTP 验证码。
// secret 由服务端管理者带外提供(见本地 .secrets.local),本页面不提供任何"配对/获取 secret"入口。
// 首次使用:在手机验证器中手动录入服务端给定的 secret,之后每次输入其生成的 6 位码登录。
export default function Login({ onLogin, authError }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);
  useEffect(() => { if (authError) setError(authError); }, [authError]);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('请输入 6 位数字验证码'); return; }
    setBusy(true); setError('');
    try {
      await onLogin(code);
    } catch (err) {
      setError(err.message || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">⚡</div>
        <h1>ESP32 WoL 控制台</h1>
        <p className="login-sub">输入手机验证器中的 6 位动态码</p>

        <input
          ref={inputRef}
          className="login-code"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          placeholder="······"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={busy}
          autoComplete="one-time-code"
        />

        {error && <div className="login-error">{error}</div>}

        <button className="btn btn-primary login-btn" type="submit" disabled={busy || code.length !== 6}>
          {busy ? '验证中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
