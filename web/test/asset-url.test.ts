/**
 * Asset URL tests.
 *
 * The behaviour under test is the one that decides whether a chapter renders as
 * a book or as unstyled text with no pictures: the browser fetches a chapter's
 * images and stylesheets itself, so their URLs have to authenticate without a
 * header. The browser test caught this as a wall of 401s.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { ApiClient } from '../src/net/api.ts';

// The module parses XHTML with the DOM, so the DOM has to exist before it loads.
before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const g = globalThis as unknown as Record<string, unknown>;
  g.DOMParser = dom.window.DOMParser;
  g.XMLSerializer = dom.window.XMLSerializer;
  g.document = dom.window.document;
});

const { withAssetToken } = await import('../src/net/asset-url.ts');

function client(token: string | null, baseUrl = ''): ApiClient {
  return {
    baseUrl,
    currentSession: token ? { accessToken: token } : null,
  } as unknown as ApiClient;
}

const CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<link rel="stylesheet" href="/api/v1/books/b1/assets?ref=OEBPS%2Fs.css"/>
</head><body>
<p>正文</p>
<img src="/api/v1/books/b1/assets?ref=OEBPS%2Fi.png"/>
<a href="#note1">脚注</a>
<img src="https://example.com/remote.png"/>
</body></html>`;

describe('asset URL rewriting', () => {
  test('an image URL gets the token, because an img tag cannot send a header', () => {
    const out = withAssetToken(CHAPTER, client('tok'));
    // Serialising XHTML escapes `&` as `&amp;`, which is what an XML document
    // requires; the browser unescapes it when it parses the attribute.
    assert.match(out, /ref=OEBPS%2Fi\.png&amp;access_token=tok/);
  });

  test('a stylesheet link gets it too', () => {
    const out = withAssetToken(CHAPTER, client('tok'));
    assert.match(out, /ref=OEBPS%2Fs\.css&amp;access_token=tok/);
  });

  test('an in-document anchor is left alone', () => {
    // Rewriting `#note1` would break every footnote in the book, because the
    // rewrite would turn a same-document jump into a network request.
    const out = withAssetToken(CHAPTER, client('tok'));
    assert.match(out, /href="#note1"/);
  });

  test('a third-party URL is left alone', () => {
    // The token is scoped to this instance; sending it to example.com would leak
    // it to a stranger.
    const out = withAssetToken(CHAPTER, client('tok'));
    assert.match(out, /src="https:\/\/example\.com\/remote\.png"/);
    assert.ok(!out.includes('example.com/remote.png?access_token'), 'a foreign URL must not carry our token');
    assert.match(out, /<img src="https:\/\/example\.com\/remote\.png"/);
  });

  test('a URL that already has a token is not given a second one', () => {
    // The function runs on every chapter, including one served from the cache,
    // so running it twice must not produce two parameters.
    const once = withAssetToken(CHAPTER, client('tok'));
    const twice = withAssetToken(once, client('tok'));
    assert.equal((twice.match(/access_token=tok/g) ?? []).length, 2, 'one per asset URL, not two');
  });

  test('without a session the document is returned unchanged', () => {
    assert.equal(withAssetToken(CHAPTER, client(null)), CHAPTER);
  });

  test('a cross-origin deployment rewrites absolute URLs too', () => {
    // The Android shell loads assets from `file://` and talks to a real server
    // origin, so every URL is absolute.
    const html = '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="http://nas:8080/api/v1/books/b1/assets?ref=a.png"/></body></html>';
    const out = withAssetToken(html, client('tok', 'http://nas:8080'));
    assert.match(out, /access_token=tok/);
  });

  test('a broken chapter is returned as-is rather than half-rewritten', () => {
    // A parse failure means the document is not well-formed XML. Rewriting part
    // of it risks turning a renderable chapter into an unrenderable one.
    const broken = '<html><body><img src="/api/v1/books/b1/assets?ref=a.png"';
    assert.equal(withAssetToken(broken, client('tok')), broken);
  });

  test('CSS url() references are rewritten', () => {
    const html = '<html xmlns="http://www.w3.org/1999/xhtml"><head><style>body{background:url("/api/v1/books/b1/assets?ref=bg.png")}</style></head><body/></html>';
    const out = withAssetToken(html, client('tok'));
    assert.match(out, /access_token=tok/);
  });
});
