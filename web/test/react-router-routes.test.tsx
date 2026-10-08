// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { routes } from '../src/app/router/routes.tsx';

describe('React Router route tree', () => {
  it.each([
    ['/media/video', 'MediaCatalogPage'],
    ['/media/video/movies', 'MediaCatalogPage'],
    ['/media/music', 'Navigate'],
    ['/media/audiobook', 'Navigate'],
    ['/media/music/albums', 'MediaCatalogPage'],
    ['/media/search?q=三体', 'MediaSearchPage'],
    ['/media/favorites', 'MediaFavoritesPage'],
    ['/media/video/favorites', 'MediaFavoritesPage'],
    ['/media/video/history', 'MediaHistoryPage'],
    ['/media/queue', 'MediaQueuePage'],
    ['/media/music/queue', 'MediaQueuePage'],
    ['/media/video/settings', 'MediaSettingsPage'],
    ['/media/video/settings/plugins', 'MediaSettingsPage'],
    ['/media/video/settings/libraries', 'MediaLibrariesPage'],
    ['/media/video/settings/tasks', 'MediaTasksPage'],
    ['/media/video/folders/library-1', 'MediaFoldersPage'],
    ['/media/audiobook/narrators', 'MediaNarratorsPage'],
    ['/media/audiobook/narrators/张三', 'MediaNarratorsPage'],
    ['/media/audiobook/narrators/张三/works/book-1', 'MediaNarratorsPage'],
    ['/media/video/player', 'MediaPlayerPage'],
    ['/media/video/items/item-1', 'MediaDetailPage'],
    ['/media/video/items/item-1/metadata', 'MediaMetadataEditPage'],
    ['/media/video/items/item-1/match', 'MediaMatchPage'],
    ['/media/audiobook/items/item-1/chapters', 'MediaChaptersPage'],
    ['/media/music/items/item-1/editions/edition-1', 'MediaEditionPage'],
    ['/media/video/items/item-1/structure', 'MediaStructurePage'],
    ['/sources/search', 'SourcesPage'],
    ['/sources/source-1/browse', 'SourceCatalogPage'],
    ['/sources/manage/new', 'SourceEditorPage'],
    ['/sources/source-1/credentials', 'SourceCredentialsPage'],
    ['/sources/plugins', 'PluginManagementPage'],
    ['/sources/source-1/pages/settings', 'SourceExtensionPage'],
    ['/sources/source-1/library', 'SourceExtensionPage'],
    ['/sources/plugins/plugin-1/pages/settings', 'SourceExtensionPage'],
    ['/settings', 'Navigate'],
  ])('matches %s through the declarative route tree', (pathname, componentName) => {
    const matches = matchRoutes(routes, pathname);
    expect(matches?.at(-1)?.route.element?.type?.name).toBe(componentName);
  });

  it('keeps channel navigation inside the media layout', () => {
    const matches = matchRoutes(routes, '/media/music/albums');
    expect(matches?.map(match => match.route.path)).toEqual(['/', 'media', ':channel/:category?']);
  });

  it('does not route reader pages through the media screen or legacy router', () => {
    const matches = matchRoutes(routes, '/book/book-1');
    expect(matches?.at(-1)?.route.element?.type?.name).toBe('ReaderPage');
    expect(matches?.some(match => match.route.element?.type?.name === 'MediaScreen')).toBe(false);
  });
});
