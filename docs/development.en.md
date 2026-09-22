# Development

[Project home](../README.en.md) · [Documentation](README.md) · [简体中文](development.zh-CN.md)

## Requirements

- Node.js 24 is recommended to match the current container and CI. The server uses built-in `node:sqlite`.
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

Open two terminals at the repository root. Use a test library and keep data outside it.

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

Open `http://localhost:5174`. Vite proxies `/api` to `http://127.0.0.1:8080` by default. Set `READER_SERVER` to change the proxy target.

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

Web tests use both Vitest and Node's test runner. UI reviews use real Chromium; prepare it as described above. Historical test counts are not a substitute for current results.

For UI changes, run `npm run ui:review --prefix web`; source workflows have `npm run ui:sources --prefix web`. See [UI review (中文)](ui-review/README.md) for tooling and requirements. Reviews generate screenshots and reports; screenshots are ignored by Git by default.

## Build and run

### Single-container image

```sh
docker build -f server/Dockerfile -t reader:local .
```

Use the repository root as the build context. The image builds both the Web client and server. Set the Compose image to `reader:local`, or use its commented `build` configuration.

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

Use `gradlew.bat` from a native Windows terminal. The output is `android/app/build/outputs/apk/debug/app-debug.apk`. Add `-PdefaultServerUrl=http://nas.local:8080` to preset the server address; otherwise users enter it and sign in. Building an APK does not validate reading on a physical device.

## Code map

| Directory | Responsibility |
| --- | --- |
| `server/src/config`, `db` | Runtime configuration, SQLite schema and access |
| `server/src/indexer` | File formats, scanning, identity, and metadata |
| `server/src/services`, `http` | Business services, API, authentication, and resources |
| `server/src/sources` | Built-in sources and generic plugin contracts |
| `web/src/formats` | EPUB, TXT, comics, and other format handling |
| `web/src/ui`, `styles` | Preact UI, reading stage, and styles |
| `web/src/core`, `store` | Platform capabilities, synchronization, and offline storage |
| `android/app/src/main/java/cool/cnb/reader` | Android Activity, WebView, native image and speech bridges |

Preact manages UI state; the reading stage handles content layout and measurement. Shadow DOM isolates book styles, and icons use Lucide SVG. Both the server and Android consume the Web build. See [architecture (中文)](architecture.md) and [UI guidelines (中文)](ui.md) for details.

## Contributing workflow

1. Describe the issue, reproduction steps, and expected behavior. Remove credentials from logs, source rules, and examples.
2. Keep changes focused and follow existing error handling and test patterns.
3. Add appropriate regression checks for behavior changes. Documentation-only changes need link, command, and example checks.
4. Describe the changes, validation, and known limitations when submitting.

For integrations, see the [API reference (中文)](api.md), [source architecture (中文)](source-plugins.md), and [extension protocol (中文)](plugin-extensions.md).
