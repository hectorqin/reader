import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './icon.tsx';
import { IconButton, IconTextButton } from './toolkit.tsx';

/**
 * 小窗阅读 — a second reading view of the same book over the page.
 *
 * This component owns only the frame: dragging, resizing, the border and the
 * background. The chapter itself is a `ReaderView` built by `ReaderScreen` into
 * `stageRef`, for the same reason the big stage is imperative — pagination is
 * measured from the DOM, and a React subtree would re-create the element the
 * paginator measured.
 *
 * The frame is positioned inside `.reader-screen`, so the theme, mode and paper
 * attributes on that container (and the `--reader-*` custom properties they
 * select) reach this box and the shadow host inside it without being copied here.
 * That is what makes its background match the page it floats over, in every
 * theme and paper colour, including 夜间.
 */

export interface CompanionTocRow {
  id: string;
  label: string;
  depth: number;
  spine?: number;
}

export interface CompanionReaderProps {
  title: string;
  chapterLabel: string;
  chapterIndex: number;
  chapterCount: number;
  page: number;
  pages: number;
  navigating: boolean;
  /** Fills an OS-level Picture-in-Picture window; the window itself is the frame. */
  embedded?: boolean;
  /** A colour chosen for the whole window, or null for the page's paper. */
  background?: string | null;
  onBackground?(color: string | null): void;
  toc?: CompanionTocRow[];
  /** 1-based whole-book chapter, for highlighting the contents row. */
  chapter?: number;
  onJump?(spine: number): void;
  onClose(): void;
  onSync(): void;
  onChapter(delta: 1 | -1): void;
  onPage(delta: 1 | -1): void;
  /** Called with the stage element on mount and with null on unmount. */
  onStage(container: HTMLElement | null): void;
}

interface Geometry { x: number; y: number; w: number; h: number }

const MIN_WIDTH = 240;
const MIN_HEIGHT = 180;
const EDGE = 8;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export function CompanionReader({
  title, chapterLabel, chapterIndex, chapterCount, page, pages, navigating, embedded, background, onBackground, toc = [], chapter = 0, onJump,
  onClose, onSync, onChapter, onPage, onStage,
}: CompanionReaderProps): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  // 默认就是无边框：小窗要像正文自己延续出来的一块，而不是浮在上面的一张白卡。
  const [bordered, setBordered] = useState(false);
  const [clear, setClear] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const drag = useRef<{ mode: 'move' | 'resize'; pointerId: number; startX: number; startY: number; from: Geometry } | null>(null);
  // The latest callback, so the mount effect below can keep an empty dependency list
  // and still call the screen's current method.
  const stageCallback = useRef(onStage);
  stageCallback.current = onStage;

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    stageCallback.current(node);
    return () => stageCallback.current(null);
  }, []);

  const begin = (event: ReactPointerEvent, mode: 'move' | 'resize'): void => {
    if (embedded || event.button !== 0) return;
    const host = panel.current?.parentElement;
    const box = panel.current?.getBoundingClientRect();
    if (!host || !box) return;
    if (mode === 'move' && (event.target as Element).closest('button, a, input, select, textarea, [role="slider"]')) return;
    const area = host.getBoundingClientRect();
    const from = { x: box.left - area.left, y: box.top - area.top, w: box.width, h: box.height };
    drag.current = { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from };
    setGeometry(from);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const move = (event: ReactPointerEvent): void => {
    const current = drag.current;
    const host = panel.current?.parentElement;
    if (!current || !host || current.pointerId !== event.pointerId) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (current.mode === 'move') {
      setGeometry({
        x: clamp(current.from.x + dx, EDGE, width - current.from.w - EDGE),
        y: clamp(current.from.y + dy, EDGE, height - current.from.h - EDGE),
        w: current.from.w,
        h: current.from.h,
      });
    } else {
      setGeometry({
        x: current.from.x,
        y: current.from.y,
        w: clamp(current.from.w + dx, MIN_WIDTH, width - current.from.x - EDGE),
        h: clamp(current.from.h + dy, MIN_HEIGHT, height - current.from.y - EDGE),
      });
    }
    event.preventDefault();
  };

  const end = (event: ReactPointerEvent): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };

  const style = geometry
    ? { left: `${geometry.x}px`, top: `${geometry.y}px`, width: `${geometry.w}px`, height: `${geometry.h}px` }
    : undefined;
  const pageLabel = `第 ${Math.max(1, page)}/${Math.max(1, pages)} 页`;

  return (
    <div
      ref={panel}
      className={`reader-companion${embedded ? ' reader-companion-embedded' : ''}`}
      style={style}
      data-border={bordered ? 'on' : 'off'}
      data-backdrop={clear ? 'clear' : 'solid'}
      role="region"
      aria-label="小窗阅读"
      onContextMenu={event => { event.preventDefault(); onClose(); }}
    >
      <div
        className="reader-companion-head"
        onPointerDown={event => begin(event, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="reader-companion-heading">
          <strong>{chapterLabel || title || '小窗阅读'}</strong>
          <span>{title}{chapterCount > 0 ? ` · 第 ${chapterIndex}/${chapterCount} 章` : ''}</span>
        </div>
        <div className="reader-companion-actions">
          <IconButton icon="menu" label="目录" pressed={tocOpen} onClick={() => setTocOpen(value => !value)} />
          <IconButton icon="locate" label="回到主阅读位置" disabled={navigating} onClick={onSync} />
          <IconButton icon="palette"
            label={clear ? '背景：透底' : '背景：纸面'} pressed={clear}
            onClick={() => setClear(value => !value)} />
          <input
            type="color"
            className="reader-companion-color"
            aria-label="小窗背景色"
            title="选择小窗背景色"
            value={background ?? '#ffffff'}
            onChange={event => onBackground?.(event.currentTarget.value)}
          />
          {background && <IconButton icon="refresh" label="恢复纸色背景" onClick={() => onBackground?.(null)} />}
          <IconTextButton className="reader-companion-border" icon={bordered ? 'fit-whole' : 'fit-fill'}
            label={bordered ? '隐藏边框' : '显示边框'}
            onClick={() => setBordered(value => !value)} />
          <IconButton icon="close" label="关闭小窗" onClick={onClose} />
        </div>
      </div>
      <div ref={stage} className="reader-companion-stage" />
      {!bordered && (
        // An invisible corner: moving the pointer here reveals the way back to the
        // controls without leaving a bar on the page all the time.
        <div className="reader-companion-hotspot">
          <div className="reader-companion-hotspot-actions">
            <IconButton icon="menu" label="目录" pressed={tocOpen} onClick={() => setTocOpen(value => !value)} />
            <IconTextButton className="reader-companion-border" icon="fit-whole" label="显示边框" onClick={() => setBordered(true)} />
          </div>
        </div>
      )}
      {tocOpen && (
        <div className="reader-companion-toc" role="dialog" aria-label="目录">
          <div className="reader-companion-toc-head">
            <strong>目录</strong>
            <IconButton icon="close" label="关闭目录" onClick={() => setTocOpen(false)} />
          </div>
          <div className="reader-companion-toc-list">
            {toc.map((entry, index) => {
              const target = entry.spine ?? index;
              return (
                <button key={`${entry.id}-${index}`} type="button"
                  className="reader-companion-toc-item"
                  data-current={target + 1 === chapter ? 'true' : undefined}
                  style={{ paddingLeft: `${0.75 + Math.max(0, entry.depth) * 0.75}rem` }}
                  onClick={() => { setTocOpen(false); onJump?.(target); }}>
                  {entry.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="reader-companion-foot">
        <IconButton icon="step-backward" label="上一章" disabled={navigating || chapterIndex <= 1} onClick={() => onChapter(-1)} />
        <IconButton icon="chevron-left" label="上一页" disabled={navigating} onClick={() => onPage(-1)} />
        <span className="reader-companion-page">{pageLabel}</span>
        <IconButton icon="chevron-right" label="下一页" disabled={navigating} onClick={() => onPage(1)} />
        <IconButton icon="step-forward" label="下一章" disabled={navigating || (chapterCount > 0 && chapterIndex >= chapterCount)} onClick={() => onChapter(1)} />
      </div>
      {!embedded && <button
        type="button"
        className="reader-companion-resize"
        aria-label="拖动调整小窗大小"
        onPointerDown={event => begin(event, 'resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <Icon name="fit-fill" size={14} />
      </button>}
    </div>
  );
}
