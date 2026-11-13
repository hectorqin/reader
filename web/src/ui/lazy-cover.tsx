/**
 * A cover fetched through the API only once it scrolls into view.
 *
 * Source covers are read through the server and the book source behind it, one
 * request each, so a list of fifty results must not ask for fifty images at once.
 * Bytes are fetched with the session (an `<img src>` cannot carry it) and kept as
 * object URLs for the life of the page.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { useRuntime } from '../app/providers/runtime-context.tsx';

const loaded = new Map<string, string>();

export function LazyCover({ url, title, className }: { url: string | null; title: string; className?: string }): JSX.Element {
  const { api } = useRuntime();
  const frame = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(url ? loaded.get(url) ?? null : null);
  useEffect(() => {
    const node = frame.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setVisible(true); }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!url) { setSrc(null); return; }
    const cached = loaded.get(url);
    if (cached) { setSrc(cached); return; }
    setSrc(null);
    if (!visible) return;
    let live = true;
    void api.coverBytes(url).then((bytes) => {
      const objectUrl = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]));
      loaded.set(url, objectUrl); if (live) setSrc(objectUrl);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [api, url, visible]);
  return <span ref={frame} className={className ? `lazy-cover ${className}` : 'lazy-cover'} aria-hidden="true">
    {src ? <img src={src} alt="" /> : <span className="lazy-cover-placeholder">{title.trim().slice(0, 1) || '书'}</span>}
  </span>;
}
