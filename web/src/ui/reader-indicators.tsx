import { DEFAULT_APP_SETTINGS, READOUT_FIELDS, type ReadoutMode } from '../store/settings.ts';
import type { ChromeState } from './reader-chrome.tsx';
import { useEffect, useState } from './vendor/preact.ts';

/** Only this small subtree updates with the clock; the reading surface is untouched. */
export function ReaderIndicators({ state }: { state: ChromeState }) {
  const modes = READOUT_FIELDS.map(({ key }) => state[key] ?? DEFAULT_APP_SETTINGS[key]);
  const clockEnabled = modes.includes('time');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!clockEnabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      setNow(new Date());
      timer = setTimeout(refresh, 60_000 - Date.now() % 60_000);
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [clockEnabled]);

  const text = (mode: ReadoutMode): string => {
    switch (mode) {
      case 'book': return state.title;
      case 'chapter': return state.chapterLabel;
      case 'progress': return `第${Math.max(1, state.pageInChapter)}/${Math.max(1, state.chapterPages)}页 ${Math.round(Math.min(1, Math.max(0, state.progress)) * 100)}%`;
      case 'time': return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      default: return '';
    }
  };
  return <>{(['top', 'bottom'] as const).map((edge, index) => (
    <div key={edge} className={`reading-indicator reading-indicator-${edge}`} aria-label={edge === 'top' ? '顶部阅读信息' : '底部阅读信息'}>
      {(['left', 'right'] as const).map((side, offset) => {
        const mode = modes[index * 2 + offset]!;
        const value = text(mode);
        return <span key={side} className={`indicator-${side}`} data-mode={mode} title={value}>{value}</span>;
      })}
    </div>
  ))}</>;
}
