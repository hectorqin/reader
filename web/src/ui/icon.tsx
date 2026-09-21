import {
  Menu, ChevronLeft, ChevronRight, ArrowLeft, Folder, FileText, SlidersHorizontal,
  Search, X, Plus, Check, Upload, Trash2, Download, RefreshCw, BookOpen,
  Library, Play, Pause, SkipBack, SkipForward, Square, Headphones, Moon, Sun,
  Eye, Info, TriangleAlert, Clock, Ellipsis, Pencil, ArrowDownUp, LogOut,
  CirclePlus, IndentIncrease, Type, MoveVertical, Settings, SlidersVertical,
} from 'lucide-preact';
import type { IconName } from './icon-names.ts';
import type { JSX } from './vendor/preact.ts';
export type { IconName };
const ICONS = {
  menu: Menu, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  'arrow-left': ArrowLeft, folder: Folder, 'file-text': FileText,
  sliders: SlidersHorizontal, search: Search, close: X, plus: Plus, check: Check,
  upload: Upload, trash: Trash2, download: Download, refresh: RefreshCw,
  book: BookOpen, shelf: Library, play: Play, pause: Pause,
  'step-backward': SkipBack, 'step-forward': SkipForward, stop: Square,
  volume: Headphones, moon: Moon, sun: Sun, eye: Eye, info: Info,
  warning: TriangleAlert, clock: Clock, more: Ellipsis, edit: Pencil,
  sort: ArrowDownUp, logout: LogOut, 'sign-out': LogOut, 'add-circle': CirclePlus,
  indent: IndentIncrease, 'text-size': Type, 'line-height': MoveVertical,
  settings: Settings, library: Library, tune: SlidersVertical,
  font: Type, 'volume-high': Headphones, 'backward-step': SkipBack,
  'forward-step': SkipForward, bars: Menu, gear: Settings, xmark: X,
  'magnifying-glass': Search, books: Library,
} satisfies Record<IconName, typeof Menu>;
export interface IconProps { name: IconName; label?: string | null; class?: string; }
/** Shared geometry and stroke weight, independent of font rendering. */
export function Icon({ name, label, class: className }: IconProps): JSX.Element {
  const Glyph = ICONS[name];
  return <Glyph class={className ? 'icon ' + className : 'icon'} size="1em"
    strokeWidth={1.8} aria-hidden={label ? undefined : true}
    role={label ? 'img' : undefined} aria-label={label ?? undefined} />;
}
