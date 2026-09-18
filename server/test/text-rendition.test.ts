import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { escapeHtml } from '../src/indexer/formats/text-html.ts';

/**
 * The escaping helper is all that is left of the server's TXT rendition.
 *
 * The paragraph split that used to be tested here moved to the client
 * (`web/src/formats/segments.ts`, tested in `web/test/segments.test.ts`), because
 * deciding where a paragraph is is a *reading* decision and not a property of the
 * file. What is left on the server is the one mechanical thing: making a chapter's
 * characters safe to put in a page, for the paths that still need it.
 */
describe('escapeHtml', () => {
  test('escapes the characters that would otherwise rewrite the page', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
    assert.equal(escapeHtml(`"'`), '&quot;&#39;');
  });
});
