# reader

**One reading space for your local books, OPDS catalogs, and remote book sources.**

A self-hosted library and reader for browsers and Android, with EPUB typography, comic reading, per-user sync, and extensible sources.

[简体中文](README.md) · **English**

[Get started](docs/getting-started.en.md) · [User guide (中文)](docs/user-guide.zh-CN.md) · [Configuration](docs/configuration.en.md) · [Documentation](docs/README.md)

## Why reader

- **Your own library**: mount an existing book directory without reorganizing it first. Covers, indexes, and server state live in a separate data directory.
- **Built for reading**: preserve publisher styles in EPUBs and detect encodings and chapters in TXT files. Choose paged or scrolling reading, themes, fonts, and text-to-speech.
- **Multiple sources**: local libraries and OPDS are built in; independent plugins add remote book sources.
- **Continue across devices**: each account has its own shelf, progress, notes, and highlights. Browsers and Android connect to the same server.
- **Simple hosting**: one Docker container serves both the backend and Web UI. Mount your books read-only or writable according to your needs.

## Books and sources

| Type | Support |
| --- | --- |
| EPUB | Publisher styles, embedded fonts, table of contents, footnotes, and inline images |
| TXT | Encoding detection, inferred chapters, adjustable font size and line spacing |
| CBZ / ZIP / image directories | Natural page ordering, comic paging, and volumes |
| PDF | Basic viewing through the browser or device viewer, without reflow |
| OPDS | Browsing, search, pagination, and book acquisition |
| Remote source plugins | Multi-source search, chapter reading, rich text and images, catalog refresh, and automatic update tracking |

## Get started

Prepare Docker, Docker Compose, and a directory of books. After starting the service, open `http://<your-host>:8080`. The first registered account becomes the administrator.

**[Open the getting started guide →](docs/getting-started.en.md)**

The guide covers Compose setup, first login, adding books, read-only and writable mounts, and upgrades. The database, caches, and upload staging live in `DATA_DIR`, which must be outside `BOOKS_DIR` and must not be the same directory.

## Documentation

| I want to… | Start here |
| --- | --- |
| Install reader and open my first book | [Getting started](docs/getting-started.en.md) |
| Use shelves, the reader, sources, and text-to-speech | [User guide (中文)](docs/user-guide.zh-CN.md) |
| Configure environment variables, HTTPS, TTS, or troubleshoot deployment | [Configuration](docs/configuration.en.md) |
| Run from source, test changes, or build Android | [Development](docs/development.en.md) |
| Build a source plugin or use the API | [Documentation index](docs/README.md) |

## Current limits

- PDF support is basic viewing; `.rar/.cbr` and general format conversion are not supported.
- Offline access depends on cached content. Whole-book prefetch and cache quotas for remote chapters are not implemented.
- Clients are available for Web and Android. There are no standalone iOS or desktop clients; desktop users can use a browser.

## Contributing

Bug reports, documentation improvements, and code contributions are welcome. Include reproduction steps, your environment, and redacted logs. See the [development guide](docs/development.en.md) for the workflow and checks.

## License

[GNU Affero General Public License v3.0](LICENSE).
