import {
  Menu, ChevronLeft, ChevronRight, ChevronDown, ArrowLeft, ArrowUp, ArrowDown, ArrowUpRight,
  Folder, FolderOpen, FolderX, File, FileText, SlidersHorizontal, Search, X, Plus, Check,
  Upload, Trash2, Download, RefreshCw, RotateCw, RotateCcw, BookOpen, Library, LibraryBig,
  Play, PlayCircle, Pause, SkipBack, SkipForward, Square, Headphones, Volume2, Moon, Sun,
  SunMoon, Palette, Eye, EyeOff, Info, TriangleAlert, CloudOff, Clock, History, Timer,
  TimerOff, Ellipsis, Pencil, ArrowDownUp, LogOut, Type,
  Settings, SlidersVertical, Bookmark, Music, ListMusic, ListVideo, ListPlus,
  ListOrdered, Layers, Heart, Star, Clapperboard, UserRound, Lock, LockOpen, Gauge,
  Subtitles, AudioLines, MicVocal, Shuffle, Repeat, Repeat1, Maximize, Minimize, Expand,
  Shrink, LocateFixed, LayoutGrid, House, Rss,
} from 'lucide-react';
import type { CSSProperties, JSX } from 'react';

/**
 * The icon set: one name per idea, in the product's own words, each drawn by one
 * Lucide glyph at one stroke weight (ui.md §1).
 *
 * This file is the only place that imports `lucide-react`. Screens used to import
 * glyphs directly, and the set drifted the way a set without an owner does: settings
 * drawn by three different gears, lock by two padlocks, the stroke at 1.4, 1.7, 1.8,
 * 1.9 and Lucide's default 2 on the same screen, and seventeen sizes. A name here is
 * what a screen asks for; which glyph answers it is decided once.
 *
 * The names are the product's, not another icon set's (`test/icons.test.ts` keeps
 * borrowed names out). A name nothing draws is removed rather than kept "just in case".
 */
/** Exported for the tests that check the names, not for screens: screens use `IconName`. */
export const ICONS = {
  // navigation and structure
  menu: Menu, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, 'chevron-down': ChevronDown,
  'arrow-left': ArrowLeft, 'arrow-up': ArrowUp, 'arrow-down': ArrowDown, external: ArrowUpRight,
  home: House, grid: LayoutGrid, locate: LocateFixed,
  // files and the library
  folder: Folder, 'folder-browse': FolderOpen, 'folder-missing': FolderX, file: File, 'file-text': FileText,
  book: BookOpen, shelf: Library, library: LibraryBig, bookmark: Bookmark, feed: Rss,
  // actions
  search: Search, close: X, plus: Plus, check: Check, upload: Upload, trash: Trash2,
  download: Download, refresh: RefreshCw, edit: Pencil, sort: ArrowDownUp, more: Ellipsis,
  'queue-add': ListPlus, logout: LogOut,
  // playback
  play: Play, 'play-circle': PlayCircle, pause: Pause, stop: Square,
  'step-backward': SkipBack, 'step-forward': SkipForward,
  'rewind': RotateCcw, 'fast-forward': RotateCw, shuffle: Shuffle, repeat: Repeat, 'repeat-one': Repeat1,
  speed: Gauge, timer: Timer, 'timer-off': TimerOff, fullscreen: Maximize, 'fullscreen-exit': Minimize,
  'fit-fill': Expand, 'fit-whole': Shrink, lock: Lock, unlock: LockOpen,
  subtitles: Subtitles, 'audio-track': AudioLines, versions: Layers, episodes: ListVideo,
  playlist: ListMusic, 'ordered-list': ListOrdered, lyrics: MicVocal, speaker: Volume2,
  // media kinds
  video: Clapperboard, music: Music, audiobook: Headphones, 'read-aloud': Headphones,
  // reading and appearance
  'text-size': Type, appearance: SunMoon,
  palette: Palette, moon: Moon, sun: Sun, settings: Settings, sliders: SlidersHorizontal,
  tune: SlidersVertical,
  // state and people
  eye: Eye, 'eye-off': EyeOff, info: Info, warning: TriangleAlert, offline: CloudOff,
  clock: Clock, history: History, favorite: Heart, star: Star, account: UserRound,
} as const;

export type IconName = keyof typeof ICONS;

/**
 * The size scale, in px. Without a size the glyph is 1em of its own box (the
 * `.icon` rule sets that to the title size), which is what controls use. A size is
 * for the places that need a fixed one: inline with small text, list rows, empty
 * states. Six steps rather than whatever number the call site happened to type.
 */
export type IconSize = 14 | 16 | 18 | 20 | 24 | 32;

export interface IconProps {
  name: IconName;
  /** Only for an icon that carries meaning on its own; decorative icons stay hidden. */
  label?: string | null;
  className?: string;
  size?: IconSize;
  /** Filled with the text colour (a play triangle, a set bookmark). */
  filled?: boolean;
  /** A heavier stroke for the selected item of a navigation (the tab bar's current tab). */
  strong?: boolean;
  style?: CSSProperties;
}

/** Shared geometry and stroke weight, independent of font rendering. */
export function Icon({ name, label, className, size, filled, strong, style }: IconProps): JSX.Element {
  const Glyph = ICONS[name];
  // The large empty-state glyphs are drawn lighter: a 1.8 stroke scaled to 32px reads
  // as a bold pictogram rather than the line icon the rest of the set is.
  return <Glyph className={className ? 'icon ' + className : 'icon'} size="1em"
    strokeWidth={strong ? 2.1 : size === 32 ? 1.4 : 1.8} fill={filled ? 'currentColor' : 'none'}
    style={size ? { ...style, fontSize: `${size}px` } : style}
    aria-hidden={label ? undefined : true}
    role={label ? 'img' : undefined} aria-label={label ?? undefined} />;
}
