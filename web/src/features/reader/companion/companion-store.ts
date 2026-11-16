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
  mainPosition: CompanionMainPosition | null;
  open(request: CompanionRequest): void;
  close(): void;
  setMainPosition(position: CompanionMainPosition | null): void;
}

export const useCompanionStore = create<CompanionState>(set => ({
  request: null,
  mainPosition: null,
  open: request => set({ request }),
  close: () => set({ request: null }),
  setMainPosition: position => set({ mainPosition: position }),
}));
