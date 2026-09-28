# Configuration

[Project home](../README.en.md) · [Documentation](README.md) · [简体中文](configuration.zh-CN.md)

For a first installation, follow [getting started](getting-started.en.md). This page covers configuration, maintenance, and troubleshooting.

## Directories and permissions

- `BOOKS_DIR` contains your books. Use `:ro` for read-only access, or `:rw` plus filesystem write permissions for administrator file management.
- `DATA_DIR` stores SQLite, accounts, reading records, keys, covers, scan state, upload staging, downloaded files, and media metadata. It must always be writable.
- `DATA_DIR` must not be the same directory as, or a child of, `BOOKS_DIR`. Startup rejects that configuration.
- The image entrypoint attempts to fix ownership of the data directory itself, then runs as the `reader` user. It does not change book-directory ownership or recursively repair existing data-file permissions.

Read-only books do not prevent account or progress updates in the data directory. To enable uploads, check host ACLs and directory permissions as well as changing the mount to `:rw`.

## Business settings in the UI

Administrators configure HTTP speech, scanning, login lifetimes, public URL, browser origins and WebDAV under System settings → Service configuration. TMDB and MusicBrainz are also editable in Media settings → Metadata providers. Registration remains under Registration and invitations. Values persist in reader.db and apply without restarting.

On first upgrade, legacy business environment variables are imported once. Existing database values, including cleared credentials, always win. See [business settings (中文)](business-settings.zh-CN.md).

## Deployment environment variables

These are defaults when running the server directly. The Docker image additionally sets `DATA_DIR=/data` and `WEB_DIR=/app/web`, with `BOOKS_DIR=/books`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOOKS_DIR` | `/books` | Book directory |
| `DATA_DIR` | `data` under the current working directory | Server state and caches |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `5888` | Listen port |
| `READER_TOKEN_SECRET` | Generated | Signing secret, at least 16 characters; otherwise stored in `DATA_DIR/token.secret` |
| `LOG_LEVEL` | `info` | Logging level |
| `MEDIA_FFPROBE_PATH` | `ffprobe` | Local media probe executable |
| `MEDIA_FFMPEG_PATH` | `ffmpeg` | Embedded artwork and subtitle extraction |
| `WEB_DIR` | `web` under the current working directory | Built Web client directory |

Run `docker compose up -d` after changing environment variables. Keep the signing secret stable to preserve sessions. Accounts, progress, and notes cannot be recovered by rescanning book files.

## HTTPS and reverse proxies

Use `http://<server-ip>:5888` on your LAN. Use HTTPS for public access to protect login credentials and access tokens.

For Caddy running on the same host as reader:

```caddyfile
reader.example.com {
    reverse_proxy 127.0.0.1:5888
}
```

Set the public URL to `https://reader.example.com` in Login and service access. If Caddy also runs in a container, use reader's service address on the container network instead.

For separately hosted frontends, set allowed browser origins in Login and service access to the Web client's actual origin. Source search uses Streamable HTTP: proxies must forward `text/event-stream` incrementally rather than buffer the entire response. A VPN or tunnel can provide access when you have no public IP.

## HTTP text-to-speech

Use Android system speech or browser `speechSynthesis` when available. To enable an HTTP speech service, configure a compatible upstream in the administrator UI:

Configure the synthesis URL, token, voices URL, timeout and cache limit in System settings → Service configuration → HTTP speech. Test the connection and preview audio before saving.

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

## Media libraries

Mount local movie, series, music, and audiobook directories separately (read-only is recommended), then enter their container paths in media settings. For a native server, use absolute local paths. Do not use DATA_DIR as a media root. Users see authorized libraries; administrators manage scans, matching, and metadata.

The official image includes ffprobe and ffmpeg. For native runs, put them on PATH or set MEDIA_FFPROBE_PATH / MEDIA_FFMPEG_PATH to executable paths. They probe metadata and extract embedded resources; they do not enable transcoding.

Configure TMDB credentials and MusicBrainz contact information in Media settings → Metadata providers. Changes apply without restarting. Local tags and NFO work without online credentials.

Configure OpenList in the library creation form; no local mount is needed. Reader must reach OpenList and its download upstreams. Remote embedded metadata is not read, and some drivers require OpenList Web proxy. See [OpenList setup (中文)](media-openlist.md).

Media uses media.db; reading and accounts use reader.db. Back up the complete DATA_DIR and restore both together. See [backup and restore (中文)](backup.zh-CN.md).

### Media unavailable or playback fails

A healthy reading endpoint does not imply media readiness. Retry MEDIA_STARTING after initialization; inspect server logs and data storage for MEDIA_UNAVAILABLE. For scan failures, inspect task errors and fix paths, permissions, or OpenList connectivity before rescanning.

If metadata appears but playback fails, check browser codec/container support, upstream connectivity, and Range responses. Transcoding is not provided. Drivers requiring special download headers may need OpenList Web proxy. Do not delete media.db as a recovery step.
