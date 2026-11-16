import { create } from 'zustand';
import type { Book, BookContent } from '../../../api/types.ts';

/** A table-of-contents row in the form the reader already has on screen. */
export interface CompanionTocEntry {
  id: string;
  label: string;
  depth: number;
}

/**
 * Opening the floating reading window is app state, not reader state.
 *
 * The window is intended to stay up while the reader walks to another page of the
 * app, so the book, the loaded window and the chapter list it was opened with have
 * to live here rather than inside `ReaderScreen` — the screen is unmounted the
 * moment the route changes, and it would take its second `ReaderView` with it.
 */
export interface CompanionRequest {
  book: Book;
  /** The windowed content the big reader had loaded at the moment it was opened. */
  content: BookContent;
  toc: CompanionTocEntry[];
  /** Where the big reader was, so the window opens on the same page. */
  spine: number;
  within: number;
}

/** The big reader's position, kept up to date so 回到主阅读位置 works. */
export interface CompanionMainPosition {
  bookId: string;
  spine: number;
  within: number;
}

interface CompanionState {
  request: CompanionRequest | null;
  /** A colour the reader picked for the whole floating window, or null for paper. */
  windowBackground: string | null;
  /** The OS-level Picture-in-Picture window, when the browser provides one. */
  pip: Window | null;
  mainPosition: CompanionMainPosition | null;
  open(request: CompanionRequest): void;
  close(): void;
  setMainPosition(position: CompanionMainPosition | null): void;
  setWindowBackground(color: string | null): void;
}

interface DocumentPipApi {
  requestWindow?(options?: { width?: number; height?: number; copyStyleSheets?: boolean }): Promise<Window>;
}

/**
 * Opens a real floating window, outside the tab.
 *
 * Document Picture-in-Picture is Chromium's OS-level always-on-top window. It is
 * requested synchronously from the 小窗 button's click so the browser still sees a
 * user gesture; a browser without the API simply keeps the in-page fallback.
 */
async function requestPip(): Promise<Window | null> {
  const api = (window as unknown as { documentPictureInPicture?: DocumentPipApi }).documentPictureInPicture;
  if (typeof api?.requestWindow !== 'function') return null;
  let pip: Window | null = null;
  try { pip = await api.requestWindow({ width: 440, height: 620, copyStyleSheets: true }); }
  catch {
    try { pip = await api.requestWindow({ width: 440, height: 620 }); }
    catch { return null; }
  }
  pip.document.title = '小窗阅读';
  copyStyles(pip);
  return pip;
}

/** Older builds do not support `copyStyleSheets`; clone the app's sheets instead. */
function copyStyles(pip: Window): void {
  const doc = pip.document;
  if (doc.head.querySelector('style, link[rel="stylesheet"]')) return;
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = doc.createElement('style');
      style.textContent = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
      doc.head.append(style);
    } catch {
      if (!sheet.href) continue;
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      doc.head.append(link);
    }
  }
}

const SESSION_KEY = 'reader:companion:request';
const BACKGROUND_KEY = 'reader:companion:background';

function readBackground(): string | null {
  try { return localStorage.getItem(BACKGROUND_KEY); } catch { return null; }
}

/** The last window, kept in this tab so a reload does not lose it. */
function restore(): CompanionRequest | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as CompanionRequest;
    if (!value?.book?.id || !value.content?.items?.length || !Array.isArray(value.toc)) return null;
    return value;
  } catch { return null; }
}

function remember(request: CompanionRequest | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (request) sessionStorage.setItem(SESSION_KEY, JSON.stringify(request));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* the window simply does not outlive a reload */ }
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
  request: restore(),
  pip: null,
  windowBackground: readBackground(),
  mainPosition: null,
  open: request => {
    set({ request });
    remember(request);
    void requestPip().then(pip => {
      if (!pip) return;
      // The reader closed it again while the browser was asking.
      if (get().request !== request) { pip.close(); return; }
      set({ pip });
    });
  },
  close: () => {
    const pip = get().pip;
    set({ request: null, pip: null });
    remember(null);
    if (pip && !pip.closed) pip.close();
  },
  setMainPosition: position => set({ mainPosition: position }),
  setWindowBackground: color => {
    set({ windowBackground: color });
    try { if (color) localStorage.setItem(BACKGROUND_KEY, color); else localStorage.removeItem(BACKGROUND_KEY); } catch { /* not remembered */ }
  },
}));
