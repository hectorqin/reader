# Getting started

[Project home](../README.en.md) · [Documentation](README.md) · [简体中文](getting-started.zh-CN.md)

This guide takes you through Docker deployment, account registration, and opening your first book. To run from source, use the [development guide](development.en.md).

## 1. Prepare your environment

- Install Docker Engine or Docker Desktop and the Docker Compose plugin.
- Prepare a book directory and a separate data directory.
- Make port `8080` available, or change the host port in Compose, for example to `8090:8080`.

The container serves both the API and Web UI. No separate frontend deployment is needed. Run the following commands from the repository root.

## 2. Get the deployment configuration

```sh
git clone https://cnb.cool/hectorqin/reader.git
cd reader
```

Edit [docker-compose.yml](../docker-compose.yml) and replace the host-side book path:

```yaml
volumes:
  - /path/to/your/books:/books:ro
  - ./data:/data
```

For example, use `/srv/books:/books:ro` on Linux, or `"D:/books:/books:ro"` with Docker Desktop on Windows. The relative `./data` path is resolved from the Compose file's directory.

| Directory | Purpose |
| --- | --- |
| `/books` (`BOOKS_DIR`) | Your existing book files |
| `/data` (`DATA_DIR`) | Database, accounts, reading records, covers, upload staging, downloaded files, and plugin data |

`DATA_DIR` must be outside `BOOKS_DIR` and must not be the same directory. Startup checks this constraint. Metadata stays in the data directory; reader does not create cover files or `.calibre` metadata beside your books.

### Choose read-only or writable books

- **Browse and read only**: keep `:ro`. Add books through the host or NAS and let reader scan them.
- **Manage files in the browser**: use `:rw` and give the server process write permission. Administrators can upload, rename, move, delete, and create directories in the library file manager.

A read-only book mount still allows shelves, progress, and notes to be saved in `/data`. See [configuration](configuration.en.md) for permissions and mount details.

## 3. Start and sign in

```sh
docker compose up -d
docker compose ps
docker compose logs --tail=100 reader
```

Open `http://localhost:8080`, or `http://<server-ip>:8080` from another device.

1. Register the first account. It automatically becomes the administrator.
2. Wait for the initial scan, then open a book from the shelf or library.
3. Create accounts for other members. Public registration is disabled by default after the first account.

To allow later self-registration, set `ALLOW_REGISTRATION: "true"` in the Compose `environment` section and run `docker compose up -d` again.

The health endpoint is `/api/v1/health`. For startup failures, missing books, or write errors, see [troubleshooting](configuration.en.md#troubleshooting).

### Without Compose

On Linux/macOS with a POSIX shell, you can also run the container using absolute mount paths:

```sh
mkdir -p ./data
docker run -d --name reader --restart unless-stopped \
  -p 8080:8080 \
  -v /path/to/your/books:/books:ro \
  -v "$(pwd)/data:/data" \
  cnb.cool/hectorqin/reader:latest
```

On Windows, the Compose setup above avoids shell-specific path and line-continuation syntax.

## 4. Add books and sources

### Local books

Place EPUB, TXT, PDF, CBZ/ZIP, or comic image directories in your mounted library. By default, the server runs scheduled scans every 30 minutes and checks for changes every 60 seconds. Administrators can trigger a scan manually. With a writable mount, uploads are available in the administrator file manager.

The shelf contains readable books; the library lets you browse the disk directory. Removing a book from a shelf is different from deleting its file. See the [user guide (中文)](user-guide.zh-CN.md).

### OPDS

As an administrator, add an OPDS source under Sources (书源) and configure its server URL. If authentication is required, set credentials for your current account. Open the source to browse or search its catalog and acquire books for your shelf.

## 5. Upgrade and back up

Back up both the book and data directories before upgrading. For a simple file-based SQLite backup, stop the service and copy the entire `/data` directory, including database auxiliary files, to avoid copying inconsistent live state.

```sh
docker compose stop
# Back up the host book directory and ./data here.
docker compose pull
docker compose up -d
```

Keep your data directory: it contains accounts, reading records, signing keys, and plugin state. Plugin packages are upgraded separately; disable the plugin in the UI before replacing its package.

## Next steps

- [User guide (中文)](user-guide.zh-CN.md): reading settings, shelves, sources, TTS, and offline access.
- [Configuration](configuration.en.md): environment variables, HTTPS, permissions, and troubleshooting.
- [Development](development.en.md): local setup, checks, Docker builds, and Android.
- [API reference (中文)](api.md): automation and integrations.
