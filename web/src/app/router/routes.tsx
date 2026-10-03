import { Navigate, type RouteObject } from 'react-router-dom';
import { AppShell, HomeRedirect, MediaLayout } from '../App.tsx';
import { MediaCatalogPage } from '../../features/media/pages/MediaCatalogPage.tsx';
import { MediaSearchPage } from '../../features/media/pages/MediaSearchPage.tsx';
import { MediaFavoritesPage } from '../../features/media/pages/MediaFavoritesPage.tsx';
import { MediaHistoryPage } from '../../features/media/pages/MediaHistoryPage.tsx';
import { MediaDetailPage } from '../../features/media/pages/MediaDetailPage.tsx';
import { MediaQueuePage } from '../../features/media/pages/MediaQueuePage.tsx';
import { MediaSettingsPage } from '../../features/media/pages/MediaSettingsPage.tsx';
import { MediaPlayerPage } from '../../features/media/pages/MediaPlayerPage.tsx';
import { RouteErrorBoundary } from './error-boundary.tsx';
import { ShelfPage } from '../../features/shelf/pages/ShelfPage.tsx';
import { LibraryPage, LibraryBrowsePage, LibraryFilesPage } from '../../features/library/pages/LibraryPage.tsx';
import { SourcesPage } from '../../features/sources/pages/SourcesPage.tsx';
import { SettingsPage } from '../../features/settings/pages/SettingsPage.tsx';
import { ReaderPage } from '../../features/reader/pages/ReaderPage.tsx';
import { MediaLibrariesPage, MediaLibraryCreatePage } from '../../features/media/pages/MediaLibrariesPage.tsx';
import { MediaLibraryEditPage, MediaLibraryPermissionsPage } from '../../features/media/pages/MediaLibraryEditorPages.tsx';
import { MediaTasksPage } from '../../features/media/pages/MediaTasksPage.tsx';
import { MediaFoldersPage } from '../../features/media/pages/MediaFoldersPage.tsx';
import { MediaNarratorsPage } from '../../features/media/pages/MediaNarratorsPage.tsx';
import {
  MediaMetadataEditPage,
  MediaMatchPage,
  MediaChaptersPage,
  MediaEditionPage,
  MediaStructurePage,
} from '../../features/media/pages/MediaItemManagementPages.tsx';
import { SourceCatalogPage } from '../../features/sources/pages/SourceCatalogPage.tsx';
import { SourceEditorPage } from '../../features/sources/pages/SourceEditorPage.tsx';
import { SourceCredentialsPage } from '../../features/sources/pages/SourceCredentialsPage.tsx';
import { SourceExtensionPage } from '../../features/sources/pages/SourceExtensionPage.tsx';
import { PluginManagementPage } from '../../features/sources/pages/PluginManagementPage.tsx';

export const routes = [{
  path: '/', element: <AppShell />, errorElement: <RouteErrorBoundary />, children: [
    { index: true, element: <HomeRedirect /> },
    { path: 'shelf', element: <ShelfPage /> },
    { path: 'library', element: <LibraryBrowsePage /> },
    { path: 'library/books', element: <LibraryPage /> },
    { path: 'library/files', element: <LibraryFilesPage /> },
    { path: 'sources', element: <SourcesPage /> },
    { path: 'sources/search', element: <SourceCatalogPage /> },
    { path: 'sources/manage/new', element: <SourceEditorPage /> },
    { path: 'sources/manage/:sourceId', element: <SourceEditorPage /> },
    { path: 'sources/:sourceId/browse', element: <SourceCatalogPage /> },
    { path: 'sources/:sourceId/credentials', element: <SourceCredentialsPage /> },
    { path: 'sources/plugins', element: <PluginManagementPage /> },
    { path: 'sources/:sourceId/pages/:pageId', element: <SourceExtensionPage /> },
    { path: 'sources/plugins/:pluginId/pages/:pageId', element: <SourceExtensionPage /> },
    { path: 'settings', element: <SettingsPage /> },
    { path: 'book/:bookId', element: <ReaderPage /> },
    { path: 'media', element: <MediaLayout />, children: [
      { index: true, element: <Navigate to="video" replace /> },
      { path: 'search', element: <MediaSearchPage /> },
      { path: 'favorites', element: <MediaFavoritesPage /> },
      { path: 'queue', element: <MediaQueuePage /> },
      { path: ':channel/settings', element: <MediaSettingsPage /> },
      { path: ':channel/settings/libraries', element: <MediaLibrariesPage /> },
      { path: ':channel/settings/libraries/new', element: <MediaLibraryCreatePage /> },
      { path: ':channel/settings/libraries/:libraryId/edit', element: <MediaLibraryEditPage /> },
      { path: ':channel/settings/libraries/:libraryId/permissions', element: <MediaLibraryPermissionsPage /> },
      { path: ':channel/settings/tasks', element: <MediaTasksPage /> },
      { path: ':channel/settings/:panel', element: <MediaSettingsPage /> },
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
    { path: '*', element: <Navigate to="/media/video" replace /> },
  ],
}] satisfies RouteObject[];



