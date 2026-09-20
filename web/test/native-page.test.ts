// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ReaderView } from '../src/ui/reader-view.ts';
import { createNativePageHost, type NativePageRequest } from '../src/ui/native-page.ts';
import { androidPageHost, serialisePage } from '../src/core/android-platform.ts';
import type { AndroidBridge } from '../src/android-bridge.ts';
import type { BookDoc } from '../src/formats/types.ts';

/**
 * The native page path.
 *
 * This is the one place where the Android client does something the H5 client
 * cannot, and the property that makes it safe is the fallback: a host either
 * draws the page or says no, and "no" has to put the page back in the WebView
 * with nothing left over. Every test here is about that contract, because the
 * failure mode it guards against — a blank screen where a page should be — is
 * invisible to the type system and only shows up on a device.
 */

beforeAll(() => {
  // jsdom has no object URLs, which the DOM fallback path uses for page images.
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:stub', writable: true });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, writable: true });
  }
});

function fixedDoc(): BookDoc {
  return {
    format: 'cbz',
    layout: 'fixed',
    render: 'image',
    direction: 'ltr',
    sections: [
      { id: 'p0.png', label: '第 1 页', image: { mediaType: 'image/png', bytes: new Uint8Array([1]) }, depth: 0, render: 'image', path: 'p0.png' },
      { id: 'p1.png', label: '第 2 页', image: { mediaType: 'image/png', bytes: new Uint8Array([2]) }, depth: 0, render: 'image', path: 'p1.png' },
    ],
    toc: [],
    styles: [],
    resources: new Map(),
    orderedByBook: true,
  };
}

function docWithPdf(): BookDoc {
  return {
    format: 'pdf',
    layout: 'fixed',
    render: 'document',
    direction: 'ltr',
    sections: [{ id: 'pdf', label: 'PDF', html: '', depth: 0, render: 'document' }],
    toc: [],
    styles: [],
    resources: new Map(),
    orderedByBook: true,
  };
}

/**
 * The reading surface lives inside a shadow root by design, so queries have to
 * go through the host element. Querying the app document would pass on a
 * regression that leaked the book into the shell.
 */
function flowOf(viewInstance: ReaderView): ShadowRoot {
  const host = viewInstance.elementHost?.shadowRoot;
  if (!host) throw new Error('no shadow root: the book content is not where it should be');
  return host;
}

/**
 * The reading surface, reached the way a test must: through the shadow root.
 */

function view(doc: BookDoc, pageHost?: ReturnType<typeof createNativePageHost>): ReaderView {
  const container = document.createElement('div');
  document.body.append(container);
  return new ReaderView({
    container,
    doc,
    ...(pageHost ? { pageHost } : {}),
  });
}

describe('ReaderView with a native page host', () => {
  it('hands a fixed-layout page to the host and leaves the DOM flow empty', async () => {
    const requests: NativePageRequest[] = [];
    const host = createNativePageHost(async (request) => {
      requests.push(request);
      return true;
    }, () => undefined);

    const viewInstance = view(fixedDoc(), host);
    await viewInstance.open(0, 0);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.sectionId).toBe('p0.png');
    expect(requests[0]!.mode).toBe('image');
    // A stale DOM page under the native one is the bug this asserts against:
    // the reader would see the previous page's markup through any transparent
    // part of the new one.
    expect(flowOf(viewInstance).querySelectorAll('.fixed-page')).toHaveLength(0);
  });

  it('draws the page in the DOM when the host declines', async () => {
    const host = createNativePageHost(async () => false, () => undefined);
    const viewInstance = view(fixedDoc(), host);
    await viewInstance.open(0, 0);

    expect(flowOf(viewInstance).querySelectorAll('.fixed-page')).toHaveLength(1);
    expect(flowOf(viewInstance).querySelectorAll('.fixed-page img')).toHaveLength(1);
  });

  it('renders reflowable sections in the DOM without asking the native host', async () => {
    const host = createNativePageHost(async () => true, () => undefined);
    const show = vi.spyOn(host, 'show');
    const doc: BookDoc = {
      format: 'epub',
      layout: 'reflowable',
      render: 'reflowable',
      direction: 'ltr',
      sections: [{ id: 'ch1.xhtml', label: '第一章', html: '<p>正文</p>', depth: 0 }],
      toc: [],
      styles: [],
      resources: new Map(),
      orderedByBook: true,
    };
    const viewInstance = view(doc, host);
    await viewInstance.open(0, 0);

    // EPUB layout is the product's differentiator and has exactly one
    // implementation; asking the shell to draw it would be a second one.
    expect(show).not.toHaveBeenCalled();
  });

  it('does not offer a page to the host while fit width is selected', async () => {
    // Native drawing centres the page; "fit width" asks for it to fill
    // horizontally. A native renderer can only do that by cropping (losing
    // panels) or by growing its own scroll surface (a second renderer), so the
    // page stays in the WebView and the setting keeps working.
    const show = vi.fn(async () => true);
    const host = createNativePageHost(show, () => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    const viewInstance = new ReaderView({ container, doc: fixedDoc(), pageHost: host });
    viewInstance.applySettings({ fit: 'width' });
    await viewInstance.open(0, 0);

    expect(show).not.toHaveBeenCalled();
    expect(flowOf(viewInstance).querySelectorAll('.fixed-page img')).toHaveLength(1);
  });

  it('does not ask the host to draw a document, which it cannot embed', async () => {
    const requests: NativePageRequest[] = [];
    const host = createNativePageHost(async (request) => {
      requests.push(request);
      return false;
    }, () => undefined);
    const viewInstance = view(docWithPdf(), host);
    await viewInstance.open(0, 0);

    // The request is made — the view does not special-case formats — and the
    // host is expected to decline, which is asserted by the DOM having drawn it.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.mode).toBe('document');
    expect(flowOf(viewInstance).querySelectorAll('.fixed-page')).toHaveLength(1);
  });

  it('without a host, behaves exactly like the browser build', async () => {
    const viewInstance = view(fixedDoc());
    await viewInstance.open(0, 0);
    expect(flowOf(viewInstance).querySelectorAll('.fixed-page img')).toHaveLength(1);
  });
});

describe('serialisePage', () => {
  it('carries bytes as base64 so a JS interface can accept them', () => {
    const payload = JSON.parse(serialisePage({
      sectionId: 'p1.png',
      mode: 'image',
      mediaType: 'image/png',
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      fit: 'contain',
    })) as Record<string, string>;

    expect(payload['sectionId']).toBe('p1.png');
    expect(payload['mode']).toBe('image');
    expect(payload['mediaType']).toBe('image/png');
    expect(atob(payload['bytes']!)).toBe('\u0089PNG');
  });

  it('omits bytes rather than sending an empty payload', () => {
    const payload = JSON.parse(serialisePage({ sectionId: 'p.png', mode: 'image', fit: 'contain' })) as Record<string, unknown>;
    expect('bytes' in payload).toBe(false);
  });

  it('survives a page image larger than the argument-list limit', () => {
    // `String.fromCharCode(...bytes)` throws RangeError somewhere around 100k
    // arguments, which on a real device would look like "native rendering does
    // not work on big pages" rather than a crash in an encoder.
    const bytes = new Uint8Array(300_000).fill(7);
    const payload = JSON.parse(serialisePage({ sectionId: 'big.png', mode: 'image', bytes, fit: 'contain' })) as Record<string, string>;
    expect(atob(payload['bytes']!).length).toBe(300_000);
  });
});

describe('androidPageHost', () => {
  it('gives the browser a PDF blob instead of an empty fixed page', async () => {
    const { loadPdf } = await import('../src/formats/pdf.ts');
    const pdf = await loadPdf(new TextEncoder().encode('%PDF-1.7 fixture'));
    const reader = view(pdf);
    try {
      await reader.open(0);
      const frame = flowOf(reader).querySelector('iframe');
      expect(frame).not.toBeNull();
      expect(frame?.src).toMatch(/^blob:/);
    } finally { reader.dispose(); }
  });
  function bridge(overrides: Partial<AndroidBridge> = {}): AndroidBridge {
    return {
      shellVersion: () => 2,
      deviceLabel: () => 'Pixel 7',
      connectivity: () => 'online',
      watchConnectivity: () => undefined,
      toast: () => undefined,
      hasNetwork: () => true,
      viewport: () => '{}',
      cacheUsage: () => '{}',
      diagnostics: () => '{}',
      renderPage: () => true,
      hidePage: () => undefined,
      canOpenDocument: () => false,
      ...overrides,
    };
  }

  it('is absent on a shell that predates the renderer', () => {
    // An old APK must keep working. Refusing to run would be the wrong trade for
    // an optimisation.
    expect(androidPageHost(bridge({ shellVersion: () => 1 }))).toBeNull();
  });

  it('is absent when the bridge is missing the method despite its version', () => {
    const partial = bridge();
    delete (partial as { renderPage?: unknown }).renderPage;
    expect(androidPageHost(partial)).toBeNull();
  });

  it('declines reflowable and document modes without calling across the bridge', async () => {
    const renderPage = vi.fn(() => true);
    const host = androidPageHost(bridge({ renderPage }))!;

    expect(await host.show({ sectionId: 'x', mode: 'reflowable', fit: 'contain' })).toBe(false);
    expect(await host.show({ sectionId: 'x', mode: 'document', fit: 'contain' })).toBe(false);
    expect(renderPage).not.toHaveBeenCalled();
  });

  it('treats a throwing bridge as a decline rather than an error', async () => {
    const host = androidPageHost(
      bridge({
        renderPage: () => {
          throw new Error('renderer died');
        },
      }),
    )!;
    // The reader must still see the page, drawn by the WebView.
    await expect(host.show({ sectionId: 'p.png', mode: 'image', fit: 'contain' })).resolves.toBe(false);
  });

  it('passes an image page through and reports success', async () => {
    const calls: string[] = [];
    const host = androidPageHost(bridge({ renderPage: (request) => (calls.push(request), true) }))!;
    expect(await host.show({ sectionId: 'p.png', mode: 'image', mediaType: 'image/png', fit: 'contain' })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!)['sectionId']).toBe('p.png');
  });
});
