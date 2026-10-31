import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { FloatingNotice } from '../../ui/floating-notice.tsx';

/**
 * Screens that most sessions never open, loaded on first visit.
 *
 * The reader (EPUB/PDF/ZIP parsing, pagination, TTS) and the administrator screens
 * were half of a 1.5 MB first load for someone who only opens the shelf. Each
 * wrapper keeps the page's own name, so the route tree still reads — and is tested
 * — as `ReaderPage`, `MediaLibrariesPage`, … rather than as anonymous lazy objects.
 */
function deferred<M, K extends keyof M>(load: () => Promise<M>, name: K): LazyExoticComponent<ComponentType> {
  return lazy(() => load().then(module => ({ default: module[name] as ComponentType })));
}

const fallback = <FloatingNotice message="正在加载…" busy />;

const reader = () => import('../../features/reader/pages/ReaderPage.tsx');
const libraries = () => import('../../features/media/pages/MediaLibrariesPage.tsx');
const libraryEditors = () => import('../../features/media/pages/MediaLibraryEditorPages.tsx');
const tasks = () => import('../../features/media/pages/MediaTasksPage.tsx');
const itemManagement = () => import('../../features/media/pages/MediaItemManagementPages.tsx');
const sourceEditor = () => import('../../features/sources/pages/SourceEditorPage.tsx');
const sourceCredentials = () => import('../../features/sources/pages/SourceCredentialsPage.tsx');
const stats = () => import('../../features/stats/pages/StatsPage.tsx');
const sourceExtension = () => import('../../features/sources/pages/SourceExtensionPage.tsx');

const Reader = deferred(reader, 'ReaderPage');
const Libraries = deferred(libraries, 'MediaLibrariesPage');
const LibraryCreate = deferred(libraries, 'MediaLibraryCreatePage');
const LibraryEdit = deferred(libraryEditors, 'MediaLibraryEditPage');
const LibraryPermissions = deferred(libraryEditors, 'MediaLibraryPermissionsPage');
const Tasks = deferred(tasks, 'MediaTasksPage');
const MetadataEdit = deferred(itemManagement, 'MediaMetadataEditPage');
const Match = deferred(itemManagement, 'MediaMatchPage');
const Chapters = deferred(itemManagement, 'MediaChaptersPage');
const Edition = deferred(itemManagement, 'MediaEditionPage');
const Structure = deferred(itemManagement, 'MediaStructurePage');
const SourceEditor = deferred(sourceEditor, 'SourceEditorPage');
const SourceCredentials = deferred(sourceCredentials, 'SourceCredentialsPage');
const SourceExtension = deferred(sourceExtension, 'SourceExtensionPage');
const Stats = deferred(stats, 'StatsPage');

export function ReaderPage() { return <Suspense fallback={fallback}><Reader /></Suspense>; }
export function MediaLibrariesPage() { return <Suspense fallback={fallback}><Libraries /></Suspense>; }
export function MediaLibraryCreatePage() { return <Suspense fallback={fallback}><LibraryCreate /></Suspense>; }
export function MediaLibraryEditPage() { return <Suspense fallback={fallback}><LibraryEdit /></Suspense>; }
export function MediaLibraryPermissionsPage() { return <Suspense fallback={fallback}><LibraryPermissions /></Suspense>; }
export function MediaTasksPage() { return <Suspense fallback={fallback}><Tasks /></Suspense>; }
export function MediaMetadataEditPage() { return <Suspense fallback={fallback}><MetadataEdit /></Suspense>; }
export function MediaMatchPage() { return <Suspense fallback={fallback}><Match /></Suspense>; }
export function MediaChaptersPage() { return <Suspense fallback={fallback}><Chapters /></Suspense>; }
export function MediaEditionPage() { return <Suspense fallback={fallback}><Edition /></Suspense>; }
export function MediaStructurePage() { return <Suspense fallback={fallback}><Structure /></Suspense>; }
export function SourceEditorPage() { return <Suspense fallback={fallback}><SourceEditor /></Suspense>; }
export function SourceCredentialsPage() { return <Suspense fallback={fallback}><SourceCredentials /></Suspense>; }
export function StatsPage() { return <Suspense fallback={fallback}><Stats /></Suspense>; }
export function SourceExtensionPage() { return <Suspense fallback={fallback}><SourceExtension /></Suspense>; }
