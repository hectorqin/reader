# Legado rule source plugin

Adds a source type (`legado-rules`) that interprets the HTML subset of Legado
(阅读 App) book-source rules. The rules live in `sources.json`; the plugin only
turns them into the host's search → detail → chapters → resource calls.

Supported syntax:

- selectors: `class.name`, `id.name`, `tag.name`, plain CSS
- indices: `.0`, `.-1` (one node), `!0` (all nodes from index 0 onwards)
- output tokens: `text`, `textNodes`, `html`, `href`, `src`, `content`, `value`, `alt`
- cleanup: `##pattern` or `##pattern##replacement`
- fallbacks: `a||b`; concatenation: `a&&b`
- per-source search template options after `,{...}`: `method`, `body`, `charset`, `headers`
- a normalized `search` object is accepted instead of `searchUrl` (see `92xs`):
  `{"url": "...", "method": "post", "body": "...{{key}}..."}`
- `search.book` / `toc` may point at another page with `tocUrl`; `alternateHosts`
  allows links to the site's mirror domains

Not supported: `@js:` / `<js>` rules, XPath, `@put`/`@get` variables, and
Legado's pagination/proxy features. Sources relying on those are rejected at
call time with `RULE_UNSUPPORTED`.

## Bundled sources

`biquge99` (笔趣阁③), `biquw` (笔趣网), `92xs` (就爱文学), `biqusk` (必去书库),
`wujixsw` (无极小说), `00shu` (零零小说). Each was checked end to end
(search → detail → directory → first chapter → cover) when added. Pick one per
instance with `config.sourceId`.

## Install

The host runs plugins from a directory under `DATA_DIR/plugins`, with its own
dependencies installed:

```sh
npm install --prefix examples/plugins/legado-rules
cp -r examples/plugins/legado-rules "$DATA_DIR/plugins/legado-rules"
```

Then install it as an admin:

```sh
POST /api/v1/plugins   {"folder":"legado-rules","trusted":true}
POST /api/v1/sources   {"pluginId":"reader.source.legado","sourceType":"legado-rules","name":"笔趣阁③","config":{"sourceId":"biquge99"}}
```

Plugins run with the server user's OS privileges; only install packages you trust.

## Adding a source

Append an entry to `sources.json` with `name`, `url`, `searchUrl`, and the
`search`/`book`/`toc`/`content` rules (copy them verbatim from the Legado
source), and add its id to the `enum` in `plugin.json`'s `configSchema`.
