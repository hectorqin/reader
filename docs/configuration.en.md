# Configuration

[Project home](../README.en.md) · [Documentation](README.md) · [简体中文](configuration.zh-CN.md)

For a first installation, follow [getting started](getting-started.en.md). This page covers configuration, maintenance, and troubleshooting.

## Directories and permissions

- `BOOKS_DIR` contains your books. Use `:ro` for read-only access, or `:rw` plus filesystem write permissions for administrator file management.
- `DATA_DIR` stores SQLite, accounts, reading records, keys, covers, scan state, upload staging, remote downloads, and plugin data. It must always be writable.
- `DATA_DIR` must not be the same directory as, or a child of, `BOOKS_DIR`. Startup rejects that configuration.
- The image entrypoint attempts to fix ownership of the data directory itself, then runs as the `reader` user. It does not change book-directory ownership or recursively repair existing data-file permissions.

Read-only books do not prevent account or progress updates in the data directory. To enable uploads, check host ACLs and directory permissions as well as changing the mount to `:rw`.

## Environment variables

These are defaults when running the server directly. The Docker image additionally sets `DATA_DIR=/data` and `WEB_DIR=/app/web`, with `BOOKS_DIR=/books`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOOKS_DIR` | `/books` | Book directory |
| `DATA_DIR` | `data` under the current working directory | Server state and caches |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `8080` | Listen port |
| `PUBLIC_URL` | Empty | Public-facing URL; set when using a reverse proxy |
| `SCAN_INTERVAL` | `1800` | Scheduled scan interval in seconds; `0` disables it |
| `WATCH_INTERVAL` | `60` | Change-check interval in seconds; `0` disables it |
| `ALLOW_REGISTRATION` | `false` | Allow public registration after the first account |
| `ACCESS_TOKEN_TTL` | `86400` | Access-token lifetime in seconds |
| `REFRESH_TOKEN_TTL` | `31536000` | Refresh-token lifetime in seconds |
| `READER_TOKEN_SECRET` | Generated | Signing secret, at least 16 characters; otherwise stored in `DATA_DIR/token.secret` |
| `LOG_LEVEL` | `info` | Logging level |
| `CORS_ORIGINS` | Empty | Comma-separated browser origins; empty reflects the requesting origin |
| `WEB_DIR` | `web` under the current working directory | Built Web client directory |
| `TTS_URL` | Empty | HTTP speech upstream; empty disables HTTP speech |
| `TTS_TOKEN` | Empty | Upstream Bearer token |
| `TTS_VOICES_URL` | `<TTS_URL>/voices` | Upstream voice list |
| `TTS_TIMEOUT_MS` | `20000` | Speech request timeout in milliseconds |
| `TTS_CACHE_BYTES` | `268435456` | Byte limit for `DATA_DIR/tts-cache`; `0` disables caching |

Run `docker compose up -d` after changing environment variables. Keep the signing secret stable to preserve sessions. Accounts, progress, and notes cannot be recovered by rescanning book files.

## HTTPS and reverse proxies

Use `http://<server-ip>:8080` on your LAN. Use HTTPS for public access to protect login credentials and access tokens.

For Caddy running on the same host as reader:

```caddyfile
reader.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Set `PUBLIC_URL=https://reader.example.com`. If Caddy also runs in a container, use reader's service address on the container network instead.

For separately hosted frontends, set `CORS_ORIGINS` to the Web client's actual origin. Source search uses Streamable HTTP: proxies must forward `text/event-stream` incrementally rather than buffer the entire response. A VPN or tunnel can provide access when you have no public IP.

## HTTP text-to-speech

Use Android system speech or browser `speechSynthesis` when available. To enable an HTTP speech service, configure a compatible upstream in Compose:

```yaml
environment:
  TTS_URL: "http://your-tts-host:5002/tts"
  # TTS_TOKEN: "your-token"
  # TTS_VOICES_URL: "http://your-tts-host:5002/voices"
  TTS_CACHE_BYTES: "268435456"
```

reader proxies speech requests and does not include a synthesis model. The upstream must implement the expected request protocol; a service's name alone does not establish compatibility. See the [TTS API (中文)](api.md). The address must be reachable from the reader container; `localhost` inside a container refers to that container.

## Troubleshooting

### Data directory is not writable at startup

Check `docker compose logs --tail=100 reader`. For `EACCES` on `/data/token.secret`, the database, or caches:

1. Confirm `/data` is writable and has free space.
2. If you set `user:`, `--user`, or replace the entrypoint, ensure that user can write the data directory.
3. Run `docker compose run --rm --no-deps --entrypoint id reader reader` to inspect the image's `reader` UID/GID, then correct host directory ownership or ACLs. If you use a custom runtime user, use that user's identity instead.
4. NFS, SMB, and NTFS may need their own permission configuration rather than `chown` alone.

Setting `READER_TOKEN_SECRET` only avoids writing the secret file. It does not remove the need for writable database and cache storage.

### File management returns `READ_ONLY_MOUNT`

Check whether the mount uses `:ro`. After switching to `:rw` and recreating the container, verify the server process can write the target directory. Uploads are available only on the administrator file-management page.

### The UI opens but books are missing

Check that the mounted files are readable and supported, then wait for scanning or trigger a scan as an administrator. The scanner skips directories such as `.git`, `@eaDir`, and `#recycle` and does not follow symlinks. Use the library file page to inspect the actual directory.

### Remote source searches fail

Check the source address, current account credentials and the error details shown next to the search results. Verify that the source and its plugin are enabled. Runtime dependencies and provider-specific configuration are documented by the plugin author.
