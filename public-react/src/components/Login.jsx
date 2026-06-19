import { useState, useEffect, useRef } from 'react';

// 登录页:输入 6 位 TOTP 验证码。
// 首次使用需先在手机 Authenticator 里手动录入 secret(点"首次配对"展开查看)。
export default function Login({ onLogin, authError }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [setup, setSetup] = useState(null);
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

  // 拉取 otpauth URL + secret 供手动录入
  const loadSetup = async () => {
    if (setup) { setShowSetup(s => !s); return; }
    try {
      const res = await fetch('/api/otpauth');
      const d = await res.json();
      if (d.ok) { setSetup(d); setShowSetup(true); }
      else setError(d.error || '获取配对信息失败');
    } catch { setError('获取配对信息失败'); }
  };

  const copy = (txt) => {
    navigator.clipboard && navigator.clipboard.writeText(txt).catch(() => {});
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

        <button type="button" className="login-setup-toggle" onClick={loadSetup}>
          {showSetup ? '收起配对信息' : '首次使用? 配对验证器'}
        </button>

        {showSetup && setup && (
          <div className="login-setup">
            <p>在手机验证器(如 Google/Microsoft Authenticator)中选择"手动输入",填入:</p>
            <div className="setup-row">
              <span className="setup-label">账号</span>
              <code>WoL:admin</code>
            </div>
            <div className="setup-row">
              <span className="setup-label">密钥</span>
              <code className="setup-secret" onClick={() => copy(setup.secret)} title="点击复制">
                {setup.secret}
              </code>
            </div>
            <div className="setup-row">
              <span className="setup-label">类型</span>
              <code>基于时间(TOTP),6 位,30 秒</code>
            </div>
            <p className="setup-hint">或用支持扫码的验证器打开此链接(已复制):</p>
            <code className="setup-url" onClick={() => copy(setup.url)} title="点击复制">{setup.url}</code>
          </div>
        )}
      </form>
    </div>
  );
}
