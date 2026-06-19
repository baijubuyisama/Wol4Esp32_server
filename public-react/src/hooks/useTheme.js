import { useEffect, useState, useCallback } from 'react';

// 主题模式:浅色 / 深色 / 跟随系统(auto)
// CSS 只有 :root(浅) 与 :root[data-theme="dark"](深) 两套。
// auto 模式由本 hook 根据系统 prefers-color-scheme 决定是否挂 dark,
// 这样 CSS 零重复,且系统主题变化时实时切换(仅 auto 模式生效)。
const MODES = ['light', 'dark', 'auto'];
const STORAGE_KEY = 'wol-theme';

const darkMQ = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

// 把逻辑模式解析为实际渲染需要的 data-theme 值(空=浅色, 'dark'=深色)
function resolveDataAttr(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return null;       // 显式浅色:不挂属性,走 :root 浅色
  // auto:跟随系统
  return darkMQ()?.matches ? 'dark' : null;
}

function applyToDom(mode) {
  const attr = resolveDataAttr(mode);
  const root = document.documentElement;
  if (attr) root.setAttribute('data-theme', attr);
  else root.removeAttribute('data-theme');
}

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function useTheme() {
  const [mode, setModeState] = useState(readStored);

  // 模式变化时立即应用到 DOM
  useEffect(() => { applyToDom(mode); }, [mode]);

  // auto 模式下监听系统主题变化,实时跟随
  useEffect(() => {
    if (mode !== 'auto') return;
    const mq = darkMQ();
    if (!mq) return;
    const handler = () => applyToDom('auto');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const persist = useCallback((next) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }, []);

  const cycle = useCallback(() => {
    setModeState((prev) => {
      const next = MODES[(MODES.indexOf(prev) + 1) % MODES.length];
      persist(next);
      return next;
    });
  }, [persist]);

  // 直接设为某个模式(下拉选中用)
  const setMode = useCallback((next) => {
    if (!MODES.includes(next)) return;
    persist(next);
    setModeState(next);
  }, [persist]);

  return { mode, cycle, setMode };
}
