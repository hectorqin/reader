# Development

[Project home](../README.en.md) · [Documentation](README.md) · [简体中文](development.zh-CN.md)

## Requirements

- Node.js 22 or later (`engines` in `server/package.json`); 24 is recommended to match the current container and CI. The server uses built-in `node:sqlite` and runs TypeScript directly through `tsx`.
- npm and Git. Server and Web have separate package manifests and lockfiles; there is no root-level npm script.
- Chromium for UI reviews.
- For Android: JDK 17+, Android SDK 35, and Build Tools 35.0.1. The Web asset script requires a POSIX shell; Windows users can use Git Bash or WSL.

Unless noted otherwise, run commands from the repository root.

## Install dependencies

```sh
npm ci --prefix server
npm ci --prefix web
```

For browser UI reviews, install Chromium from the Web directory:

```sh
cd web
npx playwright install chromium
```

Linux CI can use `npx playwright install --with-deps chromium` to install system dependencies too. Alternatively, point `CHROME_PATH` at an existing Chrome/Chromium executable.

## Start development servers

Open two terminals at the repository root. Use a test library and keep data outside it (the server refuses to start when `DATA_DIR` is inside `BOOKS_DIR`).

Linux/macOS:

```sh
mkdir -p /tmp/reader-dev-books /tmp/reader-dev-data
BOOKS_DIR=/tmp/reader-dev-books DATA_DIR=/tmp/reader-dev-data npm run dev --prefix server
```

PowerShell:

```powershell
$env:BOOKS_DIR = Join-Path $env:TEMP 'reader-dev-books'
$env:DATA_DIR = Join-Path $env:TEMP 'reader-dev-data'
New-Item -ItemType Directory -Force -Path $env:BOOKS_DIR, $env:DATA_DIR | Out-Null
npm run dev --prefix server
```

In the second terminal:

```sh
npm run dev --prefix web
```

Open `http://localhost:5174`. Vite proxies `/api` to `http://127.0.0.1:5888` by default. Set `READER_SERVER` to change the proxy target.

## Checks and tests

Run checks for the modules you change. Available entry points are:

```sh
npm run typecheck --prefix server
npm test --prefix server
npm run build --prefix server

npm run typecheck --prefix web
npm test --prefix web
npm run build --prefix web
```

Historical test counts are not a substitute for current results.

Running a single test:

```sh
# Server (node:test); add --test-name-pattern="..." to filter
cd server && npx tsx --test test/media-api.test.ts

# Most Web tests use Vitest
cd web && npx vitest run test/foo.test.ts
# The few files written for node:test (api, asset-url, paginator, window, windowed-toc)
cd web && npx tsx --test test/paginator.test.ts
```

The Web package has two test runners: `npm test` runs Vitest, then runs the node:test files above with `tsx --test`; those files are excluded from Vitest in `web/vite.config.ts`. When adding a node:test file, add it to both the `test` script and the Vitest `exclude` list. The Web suite imports server code, so run `npm ci` for both packages first.

### UI review

UI reviews render in real Chromium over CDP, then take screenshots and measurements; prepare Chromium as described above. The scripts live under `web/tools/ui-review/` and write to the Git-ignored `artifacts/ui-review/` directory. Do not commit one-off screenshots under `docs/`.

| Command | What it does | Output |
| --- | --- | --- |
| `npm run ui:review --prefix web` | Builds, then reviews the app screens | `artifacts/ui-review/react-app/`, result in `verification.json` |
| `npm run ui:review:only --prefix web` | Same, reusing the existing `web/dist` (used by CI) | Same |
| `npm run ui:review:reader --prefix web` | Reader scenes; does not build, run `npm run build` first | `artifacts/ui-review/reader/` |
| `npm run ui:sources --prefix web` | Builds, then runs the source workflow; needs server dependencies installed | `artifacts/ui-review/sources/` |

Set `UI_REVIEW_DIR` to change the output directory. Run a review and look at the screenshots after layout changes. Reviews do not emulate safe areas; check edge-touching bars with CDP `Emulation.setSafeAreaInsetsOverride`.

### Icons

Icons are mapped from a name to a Lucide glyph in one place, `ICONS` in `web/src/ui/icon.tsx` (use this project's own English names; `test/icons.test.ts` rejects names borrowed from other icon sets and any other file importing `lucide-react`). The rules are in `docs/ui.md` §1.

## CI and releases

- GitHub Actions `.github/workflows/ci.yml` runs on every pull request and on pushes to every branch. Server and Web each run install → typecheck → test → build; a UI review job reuses the Web build and keeps screenshots as artifacts; the Android job runs `check-shell.sh`, verifies the packed Web assets, and builds a debug APK.
- `.github/workflows/release.yml` runs only for `v*` tags or a manual run. It runs CI first, then builds the image on native amd64 and arm64 runners and publishes it to Docker Hub `hectorqin/reader-pro`: `x.y.z`, `x.y`, `latest`, and `sha-*` for tags; the branch name and `sha-*` for manual runs. It needs the `DOCKER_USERNAME` and `DOCKER_PASSWORD` repository secrets. `main` is the long-lived development branch; pushing to it does not release.

## Build and run

### Single-container image

```sh
docker build -f server/Dockerfile -t reader:local .
```

Use the repository root as the build context. The image builds both the Web client and server. To deploy from source, run `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`, and keep both `-f` options for later management commands.

### Without a container

Build both server and Web with their `npm run build` scripts, then start from the repository root:

```sh
BOOKS_DIR=/tmp/reader-dev-books DATA_DIR=/tmp/reader-dev-data WEB_DIR="$PWD/web/dist" npm start --prefix server
```

In PowerShell, set `$env:BOOKS_DIR`, `$env:DATA_DIR`, and `$env:WEB_DIR = (Resolve-Path 'web/dist').Path`, then run `npm start --prefix server`. `WEB_DIR` must point to the built client; the server does not automatically locate another project's `web/dist` directory.

### Android

Build the shared Web assets from the repository root, then build the APK:

```sh
sh android/scripts/build-web-assets.sh
cd android
./gradlew :app:assembleDebug
```

Use `gradlew.bat` from a native Windows terminal. The output is `android/app/build/outputs/apk/debug/app-debug.apk`. Add `-PdefaultServerUrl=http://nas.local:5888` to preset the server address; otherwise users enter it and sign in. Building an APK does not validate reading on a physical device.

Checks that need no JDK:

```sh
sh android/scripts/check-shell.sh        # packages, imports, JS bridge contract, render-mode vocabulary
sh android/scripts/verify-web-assets.sh  # after build-web-assets.sh: the Web assets will be packed into the APK
```

`check-shell.sh` counts only `@JavascriptInterface` methods as bridge methods and requires each to be declared in `web/src/android-bridge.d.ts` (method syntax; `name?(): T` for optional ones). See [android/README.md (中文)](../android/README.md) for the shell and [android/contract.md (中文)](../android/contract.md) for the contract.

## Code map

| Directory | Responsibility |
| --- | --- |
| `server/src/config`, `db`, `lib` | Runtime configuration, SQLite schema and access, path containment (`lib/paths.ts`) |
| `server/src/indexer` | File formats, scanning, identity, and metadata |
| `server/src/services`, `http` | Business services, API, authentication, and resources |
| `server/src/media` | Media catalog, scans, metadata, and playback |
| `web/src/app` | Runtime wiring, providers, hash routing, and lazy pages (`app/router/lazy-pages.tsx`) |
| `web/src/features` | Pages and components by domain; `features/media` holds media pages, services, and players |
| `web/src/shared` | Cross-domain queries, stores, theme, and UI |
| `server/src/sources` | Local library, OPDS, and process-based extension plugins |
| `web/src/formats` | EPUB, TXT, comics, and other format handling |
| `web/src/ui`, `styles` | Shared interactions, imperative reading stage, and reader styles |
| `web/src/core`, `store` | Platform capabilities, synchronization, and offline storage |
| `android/app/src/main/java/com/htmake/readerpro` | Android Activity, WebView, native image and speech bridges, Media3 playback |

The application UI uses React 19 and React Router (hash routing only). React Query owns server data and Zustand owns shared client state; the imperative reading stage handles book layout and measurement. Base interaction components are the project's own (`web/src/ui/toolkit.tsx`, `sheet.tsx`, `action-menu.tsx`, and others; Mantine has been removed), icons come from Lucide React and the project's own icon font, and Shadow DOM isolates book styles. The Web build has a fixed `assets/client.js` entry and one stylesheet, with rarely used screens split into lazy chunks; the same build is served by the server and bundled into Android. See [architecture (中文)](architecture.md) and [UI guidelines (中文)](ui.md) for details.

## Contributing workflow

1. Describe the issue, reproduction steps, and expected behavior. Remove credentials from logs, source rules, and examples.
2. Keep changes focused and follow existing error handling and test patterns.
3. Add appropriate regression checks for behavior changes. Documentation-only changes need link, command, and example checks.
4. Describe the changes, validation, and known limitations when submitting.

See the [API reference (中文)](api.md), [media architecture (中文)](media-implementation.md), and [media validation (中文)](media-validation.md).
