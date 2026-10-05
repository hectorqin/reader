// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { MediaLayout } from '../src/app/App.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';

const root = document.createElement('div');
document.body.append(root);
const runtime = { mediaApi: { preferenceScope: () => 'media-shell-test' } } as any;

afterEach(() => {
  act(() => render(null, root));
});

describe('media shell navigation placement', () => {
  it('keeps channel navigation after the route-owned media page content', () => {
    act(() => render(
      <RuntimeContext.Provider value={runtime}>
        <MemoryRouter initialEntries={['/media/video']}>
          <Routes>
            <Route path="/media/:channel" element={<MediaLayout />}>
              <Route index element={<main data-testid="media-page">影视页面</main>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </RuntimeContext.Provider>,
      root,
    ));
    const page = root.querySelector<HTMLElement>('[data-testid="media-page"]');
    const channels = root.querySelector<HTMLElement>('nav.media-channel-entry');
    expect(root.innerHTML).toContain('影视页面');
    expect(page).not.toBeNull();
    expect(channels).not.toBeNull();
    expect(page!.compareDocumentPosition(channels!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(channels!.getAttribute('aria-label')).toBe('内容频道');
    expect(channels!.querySelector('[aria-current="page"]')?.textContent).toContain('影视');
  });
});
