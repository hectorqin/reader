import { Navigate, type RouteObject } from 'react-router-dom';
import { AppShell, MediaLayout } from '../App.tsx';
import { MediaCatalogPage } from '../../features/media/pages/MediaCatalogPage.tsx';
import { MediaSearchPage } from '../../features/media/pages/MediaSearchPage.tsx';
import { MediaFavoritesPage } from '../../features/media/pages/MediaFavoritesPage.tsx';
import { MediaHistoryPage } from '../../features/media/pages/MediaHistoryPage.tsx';
import { MediaDetailPage } from '../../features/media/pages/MediaDetailPage.tsx';
import { MediaQueuePage } from '../../features/media/pages/MediaQueuePage.tsx';
import { LegacyMediaSettingsRedirect, MediaSettingsPage } from '../../features/media/pages/MediaSettingsPage.tsx';
import { MediaPlayerPage } from '../../features/media/pages/MediaPlayerPage.tsx';
import { RouteErrorBoundary } from './error-boundary.tsx';
import { ShelfPage } from '../../features/shelf/pages/ShelfPage.tsx';
import { LibraryPage, LibraryBrowsePage, LibraryFilesPage } from '../../features/library/pages/LibraryPage.tsx';
import { SourcesPage } from '../../features/sources/pages/SourcesPage.tsx';
import { MinePage } from '../../features/account/pages/MinePage.tsx';
import { HomePage } from '../../features/home/pages/HomePage.tsx';
import { SearchPage } from '../../features/search/pages/SearchPage.tsx';
import { MediaFoldersPage } from '../../features/media/pages/MediaFoldersPage.tsx';
import { MediaNarratorsPage } from '../../features/media/pages/MediaNarratorsPage.tsx';
import {
  ReaderPage,
  MediaLibrariesPage, MediaLibraryCreatePage, MediaLibraryEditPage, MediaLibraryPermissionsPage, MediaTasksPage,
  MediaMetadataEditPage, MediaMatchPage, MediaChaptersPage, MediaEditionPage, MediaStructurePage,
  SourceEditorPage, SourceCredentialsPage, SourceExtensionPage, StatsPage,
} from './lazy-pages.tsx';
import { SourceCatalogPage } from '../../features/sources/pages/SourceCatalogPage.tsx';

export const routes = [{
  path: '/', element: <AppShell />, errorElement: <RouteErrorBoundary />, children: [
    { index: true, element: <HomePage /> },
    { path: 'shelf', element: <ShelfPage /> },
    { path: 'search', element: <SearchPage /> },
    { path: 'library', element: <LibraryBrowsePage /> },
    { path: 'library/books', element: <LibraryPage /> },
    { path: 'library/files', element: <LibraryFilesPage /> },
    { path: 'sources', element: <SourcesPage /> },
    // The legacy hash route /sources/search opens the complete sources hub;
    // catalog browsing remains available through the source-specific route.
    { path: 'sources/search', element: <SourcesPage /> },
    { path: 'sources/manage/new', element: <SourceEditorPage /> },
    { path: 'sources/manage/:sourceId', element: <SourceEditorPage /> },
    { path: 'sources/:sourceId/browse', element: <SourceCatalogPage /> },
    { path: 'sources/:sourceId/credentials', element: <SourceCredentialsPage /> },
    { path: 'sources/plugins', element: <SourcesPage /> },
    { path: 'sources/:sourceId/pages/:pageId', element: <SourceExtensionPage /> },
    // Legacy source extension links use /sources/:sourceId/:pageId. Keep the
    // old deep-link shape working while the React shell emits the namespaced
    // /pages form for new links.
    { path: 'sources/:sourceId/:pageId', element: <SourceExtensionPage /> },
    { path: 'sources/plugins/:pluginId/pages/:pageId', element: <SourceExtensionPage /> },
    // The legacy shell treats /settings as the shelf's admin settings overlay.
    // Keep the route compatible with old deep links; user preferences live in
    // 我的 (/me).
    { path: 'settings', element: <Navigate to="/shelf" replace /> },
    { path: 'book/:bookId', element: <ReaderPage /> },
    // 我的 shares MediaLayout so it follows the chosen theme and keeps the channel rail.
    // Its settings rows open /me/:panel (theme, browse, playback, account),
    // so back from any of them returns to 我的.
    { path: 'me', element: <MediaLayout />, children: [
      { index: true, element: <MinePage /> },
      // Before :panel, which would otherwise take it as a settings panel name.
      { path: 'stats', element: <StatsPage /> },
      { path: ':panel', element: <MediaSettingsPage /> },
    ] },
    { path: 'media', element: <MediaLayout />, children: [
      { index: true, element: <Navigate to="video" replace /> },
      { path: 'music', element: <Navigate to="/media/music/albums" replace /> },
      { path: 'audiobook', element: <Navigate to="/media/audiobook/books" replace /> },
      { path: 'search', element: <MediaSearchPage /> },
      { path: 'favorites', element: <MediaFavoritesPage /> },
      { path: 'queue', element: <MediaQueuePage /> },
      { path: ':channel/favorites', element: <MediaFavoritesPage /> },
      { path: ':channel/queue', element: <MediaQueuePage /> },
      // 影音设置 is gone; its panels live in 我的.
      { path: ':channel/settings', element: <LegacyMediaSettingsRedirect /> },
      { path: ':channel/settings/libraries', element: <MediaLibrariesPage /> },
      { path: ':channel/settings/libraries/new', element: <MediaLibraryCreatePage /> },
      { path: ':channel/settings/libraries/:libraryId/edit', element: <MediaLibraryEditPage /> },
      { path: ':channel/settings/libraries/:libraryId/permissions', element: <MediaLibraryPermissionsPage /> },
      { path: ':channel/settings/tasks', element: <MediaTasksPage /> },
      { path: ':channel/settings/:panel', element: <LegacyMediaSettingsRedirect /> },
      { path: ':channel/folders/:libraryId?', element: <MediaFoldersPage /> },
      { path: 'audiobook/narrators', element: <MediaNarratorsPage /> },
      { path: 'audiobook/narrators/:narrator/works/:workId', element: <MediaNarratorsPage /> },
      { path: 'audiobook/narrators/:narrator', element: <MediaNarratorsPage /> },
      { path: ':channel/player', element: <MediaPlayerPage /> },
      { path: ':channel/player/:panel', element: <MediaPlayerPage /> },
      { path: ':channel/history', element: <MediaHistoryPage /> },
      { path: ':channel/items/:itemId/metadata', element: <MediaMetadataEditPage /> },
      { path: ':channel/items/:itemId/match', element: <MediaMatchPage /> },
      { path: ':channel/items/:itemId/chapters', element: <MediaChaptersPage /> },
      { path: ':channel/items/:itemId/editions/:editionId', element: <MediaEditionPage /> },
      { path: ':channel/items/:itemId/structure', element: <MediaStructurePage /> },
      { path: ':channel/items/:itemId', element: <MediaDetailPage /> },
      { path: ':channel/:category?', element: <MediaCatalogPage /> },
      { path: '*', element: <Navigate to="/media/video" replace /> },
    ] },
    // A mistyped or outdated link lands on 首页, not inside one media channel.
    { path: '*', element: <Navigate to="/" replace /> },
  ],
}] satisfies RouteObject[];



