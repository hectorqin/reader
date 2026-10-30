# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted book library + media server (books, movies/TV, music, audiobooks). Three independent parts, no root `package.json`:

- `server/` — Node ≥22 (CI uses 24), TypeScript run directly via `tsx`, Fastify, built-in `node:sqlite`.
- `web/` — React 19 + Vite client. The **same build** is served by the server and bundled into the Android app.
- `android/` — Kotlin WebView shell (+ native pager, TTS, Media3 playback). Contract with the web bundle is in `android/contract.md`.

Docs (mostly Chinese) live in `docs/`; `docs/architecture.md` explains *why* things are designed the way they are and `docs/ui.md` is the UI spec — read the relevant section before changing shelf/library/reader behaviour.

## Commands

Run from repo root (or `cd` into the package). CI runs install → typecheck → test → build per package: GitHub Actions `.github/workflows/ci.yml` (PRs and every branch push; also UI review, Android shell check + debug APK). `main` is the long-lived development branch and never releases on push: `.github/workflows/release.yml` runs only for `v*` tags or a manual run, runs CI first, then publishes the multi-arch (amd64 + arm64, native runners) image to Docker Hub `hectorqin/reader-pro` (`x.y.z`/`x.y`/`latest` + `sha-*` for tags; branch name + `sha-*` for manual runs); it needs the `DOCKER_USERNAME`/`DOCKER_PASSWORD` secrets. `android/scripts/check-shell.sh` checks the JS bridge contract: only `@JavascriptInterface` methods count, and each must be declared in `web/src/android-bridge.d.ts` (method syntax, `name?(): T` for optional).

```sh
npm ci --prefix server && npm ci --prefix web

# Dev: two terminals. DATA_DIR must NOT be inside BOOKS_DIR (server refuses to start).
BOOKS_DIR=/tmp/reader-dev-books DATA_DIR=/tmp/reader-dev-data npm run dev --prefix server   # :5888
npm run dev --prefix web    # http://localhost:5174, proxies /api to READER_SERVER (default 127.0.0.1:5888)

npm run typecheck --prefix server && npm test --prefix server && npm run build --prefix server
npm run typecheck --prefix web    && npm test --prefix web    && npm run build --prefix web
```

Single tests:

- Server (node:test): `cd server && npx tsx --test test/media-api.test.ts` (add `--test-name-pattern="..."` to filter).
- Web has **two runners**. Most files are Vitest: `cd web && npx vitest run test/foo.test.ts`. A few files written for `node:test` (`api`, `asset-url`, `windowed-toc`) are excluded from Vitest in `vite.config.ts` and run with `npx tsx --test test/<file>`. When adding a node:test file, add it to both the `test` script and the Vitest `exclude` list.

UI review (real Chromium via CDP; needs `npx playwright install chromium` or `CHROME_PATH`): `npm run ui:review --prefix web` (builds, then screenshots + measured assertions into git-ignored `artifacts/ui-review/react-app/`, result in `verification.json`). Also `ui:review:reader` and `ui:sources`. Never commit screenshots to `docs/`. Run this and look at the screenshots after layout changes.

Docker image (context must be repo root): `docker build -f server/Dockerfile -t reader:local .`
Android: `sh android/scripts/build-web-assets.sh && cd android && ./gradlew :app:assembleDebug`.
Icons: map a name to a Lucide glyph in `ICONS` in `web/src/ui/icon.tsx` (this project's own English names — `test/icons.test.ts` rejects borrowed names and any other file importing `lucide-react`); screens use `<Icon name>` / `IconButton`, sizes 14/16/18/20/24/32 only.

## Server architecture

- `main.ts` wires an `AppContext` (config, db, Scanner, services) and passes it to `http/app.ts` `buildApp`; routes are in `http/routes/*`. Tests build the same app against a temp BOOKS_DIR/DATA_DIR (see `test/api.test.ts`).
- **Paths**: every filesystem access goes through `lib/paths.ts` `resolveInside()` (throws `PATH_TRAVERSAL`); the scanner does not follow symlinks.
- **Book identity**: `id = sha256(lower(dc:identifier) + '\0' + sha256(fileBytes))`, not the path — renames/moves keep progress. `book_files` (many) → `books` (one); missing files are flagged `missing=1`, not deleted.
- **Scanning** (`indexer/scanner.ts`): mtime+size first, content hash only if that changed; concurrent `scan()` calls share one Promise.
- **Metadata precedence**: manual overrides (`metadata_overrides`, applied at read time in `ShelfService.toDto`) > embedded > provider (fills gaps) > filename parsing. The scanner may freely rewrite `books` because manual edits live elsewhere. Filename parsing is deliberately conservative: without evidence, the whole string stays the title and author stays empty.
- **Book DTOs are assembled only in `ShelfService`** (`toDto`/`getMany`); other services (sync, browse) call it instead of building their own rows. "On shelf" means `user_books.hidden = 0` AND a non-missing file exists — keep that definition consistent everywhere.
- **Sync** (`services/sync.ts`): last-writer-wins, note deletes are tombstones (`deleted=1`), each push batch is one transaction, and the POST response *is* the merged pull (the client must not GET afterwards).
- **Schema** (`db/schema.ts`): plain SQL; changes must be additive (`MIGRATIONS_SQL`, columns with defaults). Self-hosted users upgrade late and older builds may run against newer DBs.
- **Sources/plugins** (`sources/`): local library, OPDS, and process-based extension plugins (`plugin-manager.ts`, `process-plugin.ts`; example in `examples/plugins/demo-chapters`).
- **Media** (`media/`) is isolated: separate `media.db`, started asynchronously in a worker after reading is already serving. Routes return 503 `MEDIA_STARTING` / `MEDIA_UNAVAILABLE` while the reading side keeps working. Scans don't hold reader.db locks; publishing atomically swaps in a full snapshot in its own thread (failed/partial scans never replace the catalog); read-only catalog queries run on a separate query thread. Permissions are re-checked on every access/stream. reader.db and media.db (plus signing key) must be backed up/restored as a pair. See `docs/media-implementation.md`, `docs/media-write-isolation.md`.

## Web architecture

- `main.tsx` creates `AppRuntime` (`app/runtime.ts`: platform choice Web/Android, `ReaderApi`, `MediaApi`, player, `SyncEngine`, `OfflineStore`, settings, QueryClient), then renders providers + `RouterProvider`.
- **Hash routing only** (`createHashRouter`, `app/router/routes.tsx`): neither the server nor the Android asset loader (`WebHost.kt`, `https://appassets.androidplatform.net/`) can serve client-side fallbacks. New links use `#/...`.
- **`base: './'`, fixed entry `assets/client.js`, one stylesheet (`cssCodeSplit: false`)** (see `vite.config.ts`). Rarely used screens (reader, admin pages) are lazy content-hashed chunks via `app/router/lazy-pages.tsx`; add new lazy screens there rather than ad-hoc `import()`. The service worker precaches every emitted file automatically.
- Server data via React Query; shared client state via Zustand; long-lived resources (player, theme, sync) owned by Providers/services and cleaned up there. New pages go in `features/<domain>/pages`; cross-domain code goes through `shared/` or `app/`. Don't add to the old Screen dispatch (`app.ts`, `app/legacy-compat.ts` exist only for Android diagnostics/old tests).
- **Reader is imperative**: `features/reader/pages/ReaderPage.tsx` mounts `ReaderScreen` (`ui/reader-screen.tsx`) in an effect. Book content lives in a Shadow DOM with pagination measured via the DOM (`ui/reader-view.ts`, `render/`). Don't rewrite the stage as a React subtree; only the chrome is React.
- **Theming**: `ThemeController` (`shared/theme/theme.ts`) writes `data-theme`/`data-mode` on `<html>`; components use `--color-*` tokens from `styles/theme-tokens.css` (`--reader-*` and media aliases map onto them). Read/save theme via `readThemePreference`/`saveThemePreference`/`resolveAppTheme` (and `useThemeState` from `shared/theme/use-theme.ts` in React), never storage directly. New colors/spacing/durations become tokens, not literals.
- UI is built from the project's own components (`ui/toolkit.tsx`, `ui/sheet.tsx` as the only modal type, `ui/action-menu.tsx` for every ⋯ menu, `ui/dialog.tsx`, `ui/pager.tsx`) with Lucide icons drawn only through `ui/icon.tsx`. Mantine was removed; some docs still mention it.
- Lists are server-paginated with the page in the URL (`docs/ui.md` §3.5). After a write, re-fetch and only then report. The client must not reconstruct facts the server already knows (e.g. book↔file joins); write by book id.
- Offline mirror (`store/offline.ts`) is additive-only; removals must call `offline.removeBooks` explicitly.
- **Mobile/PWA layout** (`docs/ui.md` §2.5, §3.1, §3.3): every `:hover` goes inside `@media (hover: hover) and (pointer: fine)` (enforced by `test/design-tokens.test.ts`); safe areas via the `--safe-*` vars, added only by the layer touching that screen edge (in sidebar mode the sidebar owns the left inset and `.app-shell-body` the right one); finger-reachable inputs ≥16px (`--text-title`) or iOS zooms on focus. `ui:review` does not emulate safe areas — check edge-touching bars with CDP `Emulation.setSafeAreaInsetsOverride`. Manifest/icons/launch colours: `docs/pwa.zh-CN.md`.
