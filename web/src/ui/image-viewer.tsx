/**
 * The pictures of a chapter, full screen.
 *
 * A plate in a book is set at the width of the column, which on a phone is the
 * width of a hand. Tapping it opens it here: the whole window, a dark bed, the
 * picture as large as it fits, and the chapter's other pictures one swipe away.
 *
 * This is the one overlay that is not a `Sheet` (docs/ui.md §3.7). A sheet is a
 * panel beside the page; a picture needs the page's whole area and a surface that
 * can be dragged in every direction, which a panel with its own scrolling body
 * cannot be. It is still a native modal `<dialog>`, so the top layer, the inert
 * page behind it and Escape come from the platform exactly as they do for a sheet.
 *
 * Gestures, all on one surface:
 *
 *  - drag sideways at rest: the previous or next picture of the chapter;
 *  - double tap / double click, pinch, or the wheel: zoom, about the point touched;
 *  - drag while zoomed: move the picture, never further than its own edge;
 *  - tap beside the picture, ✕, or Escape: close.
 *
 * The transform is written straight to the element while a finger is down — one
 * style write per pointer event — and React only hears about what changes the
 * controls: which picture, and whether it is zoomed.
 */
import { type JSX, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from './toolkit.tsx';

export interface ViewerImage {
  src: string;
  alt: string;
}

const MAX_SCALE = 6;
/** A small picture is enlarged to fill the window, but not past the point where it is only blur. */
const MAX_UPSCALE = 3;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_SLOP = 10,
  TAP_MS = 300,
  DOUBLE_TAP_MS = 320;
/** A sideways drag turns once it has carried the picture this far, or was a flick. */
const TURN_DISTANCE = 64,
  FLICK_DISTANCE = 24,
  FLICK_MS = 250;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

/**
 * Keeps a picture from being dragged off its own edge.
 *
 * `width`/`height` are the picture's size at rest and `frame` the window's. Along
 * an axis where the zoomed picture is smaller than the window it stays centred;
 * where it is larger it may move until its edge meets the window's.
 */
export function clampPan(
  transform: Transform,
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
): Transform {
  const limitX = Math.max(0, (width * transform.scale - frameWidth) / 2),
    limitY = Math.max(0, (height * transform.scale - frameHeight) / 2);
  // `+ 0` turns a clamped −0 into 0, so a picture at rest compares equal to rest.
  return {
    scale: transform.scale,
    x: Math.max(-limitX, Math.min(limitX, transform.x)) + 0,
    y: Math.max(-limitY, Math.min(limitY, transform.y)) + 0,
  };
}

/**
 * Zooms to `scale` so that the point under (`px`, `py`) stays under it.
 *
 * Coordinates are measured from the centre of the window, which is where the
 * picture's own centre rests; the point of the picture under the finger is
 * `(p − t) / s`, and solving for the translation that puts it back there gives this.
 */
export function zoomAbout(transform: Transform, scale: number, px: number, py: number): Transform {
  const next = Math.max(1, Math.min(MAX_SCALE, scale)),
    ratio = next / transform.scale;
  return next === 1
    ? { scale: 1, x: 0, y: 0 }
    : { scale: next, x: px - (px - transform.x) * ratio, y: py - (py - transform.y) * ratio };
}

export function ImageViewer({
  images,
  start,
  onClose,
}: {
  images: ViewerImage[];
  start: number;
  onClose(): void;
}): JSX.Element {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(images.length - 1, start)));
  const [zoomed, setZoomed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    surface = useRef<HTMLDivElement>(null),
    picture = useRef<HTMLImageElement>(null);
  const transform = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    kind: 'pan' | 'swipe' | 'pinch';
    startX: number;
    startY: number;
    at: number;
    from: Transform;
    distance: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  /** Whether the platform opened it as a modal; without it Escape is ours to handle. */
  const native = useRef(false);
  const live = useRef({ index, onClose, count: images.length });
  live.current = { index, onClose, count: images.length };

  /** Writes the transform; `settle` lets it glide there instead of jumping. */
  const paint = (next: Transform, settle = false): void => {
    transform.current = next;
    const element = picture.current;
    if (!element) return;
    element.dataset['settling'] = String(settle);
    element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    setZoomed(next.scale > 1.01);
  };
  const bounded = (next: Transform): Transform => {
    const element = picture.current,
      frame = surface.current;
    return element && frame
      ? clampPan(next, element.offsetWidth, element.offsetHeight, frame.clientWidth, frame.clientHeight)
      : next;
  };
  /** A point in window coordinates, measured from the centre of the surface. */
  const fromCentre = (x: number, y: number): [number, number] => {
    const rect = surface.current!.getBoundingClientRect();
    return [x - rect.left - rect.width / 2, y - rect.top - rect.height / 2];
  };
  /**
   * Sizes the picture at rest: as large as the window allows, keeping its shape.
   *
   * In pixels rather than by `object-fit` on a full-size box, because the box is
   * what a tap is tested against and what a drag is clamped to — it has to be the
   * picture, not the window. A picture with no size of its own yet (still loading,
   * or an SVG without one) keeps the stylesheet's `max-width`/`max-height`.
   */
  const fit = (): void => {
    const element = picture.current,
      frame = surface.current;
    if (!element || !frame) return;
    const { naturalWidth, naturalHeight } = element;
    if (!naturalWidth || !naturalHeight || !frame.clientWidth || !frame.clientHeight) {
      element.style.removeProperty('width');
      element.style.removeProperty('height');
      return;
    }
    const scale = Math.min(frame.clientWidth / naturalWidth, frame.clientHeight / naturalHeight, MAX_UPSCALE);
    element.style.width = `${Math.round(naturalWidth * scale)}px`;
    element.style.height = `${Math.round(naturalHeight * scale)}px`;
  };
  const go = (delta: number): boolean => {
    const next = live.current.index + delta;
    if (next < 0 || next >= live.current.count) return false;
    setIndex(next);
    return true;
  };
  const zoomBy = (factor: number, x?: number, y?: number): void => {
    const [px, py] = x === undefined || y === undefined ? [0, 0] : fromCentre(x, y);
    paint(bounded(zoomAbout(transform.current, transform.current.scale * factor, px, py)), x === undefined);
  };

  useLayoutEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    native.current = false;
    if (typeof element.showModal === 'function') {
      try {
        element.showModal();
        native.current = true;
      } catch {
        element.setAttribute('open', '');
      }
    } else element.setAttribute('open', '');
    return () => {
      if (typeof element.close === 'function' && element.open) element.close();
      else element.removeAttribute('open');
      queueMicrotask(() => {
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      });
    };
  }, []);

  // A new picture starts at rest.
  useLayoutEffect(() => {
    fit();
    paint({ scale: 1, x: 0, y: 0 });
  }, [index]);

  useEffect(() => {
    const frame = surface.current!;
    // Not React's `onWheel`: that listener is passive, and the page behind must not scroll.
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), event.clientX, event.clientY);
    };
    const resize = (): void => {
      fit();
      paint(bounded(transform.current));
    };
    frame.addEventListener('wheel', wheel, { passive: false });
    addEventListener('resize', resize);
    return () => {
      frame.removeEventListener('wheel', wheel);
      removeEventListener('resize', resize);
    };
  }, []);

  const down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest('button')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      gesture.current = {
        kind: 'pinch',
        startX: (points[0]!.x + points[1]!.x) / 2,
        startY: (points[0]!.y + points[1]!.y) / 2,
        at: Date.now(),
        from: transform.current,
        distance: Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) || 1,
        moved: true,
      };
    } else if (points.length === 1) {
      gesture.current = {
        kind: transform.current.scale > 1.01 ? 'pan' : 'swipe',
        startX: event.clientX,
        startY: event.clientY,
        at: Date.now(),
        from: transform.current,
        distance: 0,
        moved: false,
      };
    }
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = gesture.current;
    if (!active || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (active.kind === 'pinch' && points.length >= 2) {
      const distance = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) || 1;
      const [startX, startY] = fromCentre(active.startX, active.startY);
      const [nowX, nowY] = fromCentre((points[0]!.x + points[1]!.x) / 2, (points[0]!.y + points[1]!.y) / 2);
      // Zoom about where the fingers started, then carry the picture with them.
      const zoom = zoomAbout(active.from, (active.from.scale * distance) / active.distance, startX, startY);
      paint(
        bounded(zoom.scale === 1 ? zoom : { scale: zoom.scale, x: zoom.x + nowX - startX, y: zoom.y + nowY - startY }),
      );
      return;
    }
    const deltaX = event.clientX - active.startX,
      deltaY = event.clientY - active.startY;
    if (Math.hypot(deltaX, deltaY) > TAP_SLOP) active.moved = true;
    if (!active.moved) return;
    if (active.kind === 'pan')
      paint(bounded({ scale: active.from.scale, x: active.from.x + deltaX, y: active.from.y + deltaY }));
    else if (active.kind === 'swipe') {
      // The picture follows the finger; at either end of the chapter it resists.
      const blocked =
        (deltaX > 0 && live.current.index === 0) || (deltaX < 0 && live.current.index === live.current.count - 1);
      paint({ scale: 1, x: blocked ? deltaX / 3 : deltaX, y: 0 });
    }
  };

  const up = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.delete(event.pointerId)) return;
    const active = gesture.current;
    if (!active) return;
    if (pointers.current.size > 0) {
      // One finger of a pinch lifted: the other carries on as a drag from here.
      const [rest] = [...pointers.current.values()];
      gesture.current = {
        kind: transform.current.scale > 1.01 ? 'pan' : 'swipe',
        startX: rest!.x,
        startY: rest!.y,
        at: Date.now(),
        from: transform.current,
        distance: 0,
        moved: true,
      };
      return;
    }
    gesture.current = null;
    const deltaX = event.clientX - active.startX,
      elapsed = Date.now() - active.at;
    if (active.kind === 'pinch') {
      paint(bounded(transform.current), true);
      return;
    }
    if (!active.moved && elapsed <= TAP_MS && event.type !== 'pointercancel') {
      const now = Date.now(),
        previous = lastTap.current;
      // By geometry, not `event.target`: the surface captured the pointer, so every
      // event of the gesture is retargeted to it wherever the finger actually is.
      const rect = picture.current?.getBoundingClientRect();
      const onPicture =
        !!rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (
        onPicture &&
        previous &&
        now - previous.at <= DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 30
      ) {
        lastTap.current = null;
        const [px, py] = fromCentre(event.clientX, event.clientY);
        paint(
          bounded(
            transform.current.scale > 1.01
              ? { scale: 1, x: 0, y: 0 }
              : zoomAbout(transform.current, DOUBLE_TAP_SCALE, px, py),
          ),
          true,
        );
        return;
      }
      lastTap.current = { at: now, x: event.clientX, y: event.clientY };
      // Beside the picture there is nothing to zoom; a tap there is "I am done".
      if (!onPicture) live.current.onClose();
      return;
    }
    if (active.kind === 'swipe') {
      const turn = Math.abs(deltaX) >= TURN_DISTANCE || (Math.abs(deltaX) >= FLICK_DISTANCE && elapsed < FLICK_MS);
      if (!(turn && event.type !== 'pointercancel' && go(deltaX < 0 ? 1 : -1))) paint({ scale: 1, x: 0, y: 0 }, true);
      return;
    }
    paint(bounded(transform.current), true);
  };

  const image = images[index]!;
  return (
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label="图片查看"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!native.current) onClose();
          return;
        }
        if (event.key === 'ArrowRight') {
          go(1);
          event.preventDefault();
        } else if (event.key === 'ArrowLeft') {
          go(-1);
          event.preventDefault();
        } else if (event.key === '+' || event.key === '=') zoomBy(1.4);
        else if (event.key === '-') zoomBy(1 / 1.4);
        else if (event.key === '0') paint({ scale: 1, x: 0, y: 0 }, true);
        else return;
        event.stopPropagation();
      }}
    >
      <div
        ref={surface}
        className="image-viewer-surface"
        data-zoomed={zoomed}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <img ref={picture} key={image.src} src={image.src} alt={image.alt} draggable={false} onLoad={fit} />
      </div>
      <header className="image-viewer-bar">
        {images.length > 1 ? (
          <span className="image-viewer-count" aria-live="polite">
            {index + 1} / {images.length}
          </span>
        ) : (
          <span />
        )}
        <IconButton className="image-viewer-close" icon="close" label="关闭" onClick={onClose} />
      </header>
      {images.length > 1 ? (
        <>
          <IconButton
            className="image-viewer-step"
            icon="chevron-left"
            label="上一张"
            disabled={index === 0}
            onClick={() => {
              go(-1);
            }}
          />
          <IconButton
            className="image-viewer-step image-viewer-next"
            icon="chevron-right"
            label="下一张"
            disabled={index === images.length - 1}
            onClick={() => {
              go(1);
            }}
          />
        </>
      ) : null}
    </dialog>
  );
}
