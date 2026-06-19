import { useState, useRef, useEffect, useCallback } from 'react';

// 主题下拉:浅色 / 深色 / 跟随系统。自定义浮层(不用原生 select,统一 MD 风格)。
const OPTIONS = [
  { value: 'light', icon: '☀️', label: '浅色' },
  { value: 'dark',  icon: '🌙', label: '深色' },
  { value: 'auto',  icon: '🖥️', label: '跟随系统' },
];

export default function ThemeToggle({ mode, onSet }) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(null);
  const rootRef = useRef(null);

  const current = OPTIONS.find((o) => o.value === mode) || OPTIONS[2];

  // 点外面 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); }
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => (i == null ? 0 : (i + 1) % OPTIONS.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => (i == null ? OPTIONS.length - 1 : (i - 1 + OPTIONS.length) % OPTIONS.length));
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 打开时默认聚焦当前项
  useEffect(() => {
    if (open) setFocusIdx(OPTIONS.findIndex((o) => o.value === mode));
  }, [open, mode]);

  const choose = useCallback((value) => {
    onSet && onSet(value);
    setOpen(false);
  }, [onSet]);

  return (
    <div className="theme-select" ref={rootRef}>
      <button
        className="btn btn-ghost btn-sm theme-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`主题:${current.label}`}
      >
        <span className="theme-icon">{current.icon}</span>
        <span className="theme-label">{current.label}</span>
        <span className={`theme-caret ${open ? 'open' : ''}`}>▾</span>
      </button>

      {open && (
        <ul className="theme-menu" role="listbox" aria-label="选择主题">
          {OPTIONS.map((o, i) => {
            const selected = o.value === mode;
            const focused = i === focusIdx;
            return (
              <li key={o.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={`theme-option ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
                  onClick={() => choose(o.value)}
                  onMouseEnter={() => setFocusIdx(i)}
                  ref={focused ? (el) => el && el.focus() : undefined}
                >
                  <span className="theme-icon">{o.icon}</span>
                  <span className="theme-label">{o.label}</span>
                  {selected && <span className="theme-check">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
