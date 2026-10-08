# reader

**One home for your books, movies, series, music, and audiobooks.**

A self-hosted reading and media library for browsers and Android, with EPUB typography, comic reading, media playback, and per-user progress sync.

[简体中文](README.md) · **English**

[Get started](docs/getting-started.en.md) · [Reading guide (中文)](docs/user-guide.zh-CN.md) · [Media guide (中文)](docs/media-user-guide.zh-CN.md) · [Configuration](docs/configuration.en.md) · [Documentation](docs/README.md)

## Why reader

- **Your own libraries**: mount existing directories, connect OPDS book catalogs, or add OpenList media directories. Books and media are organized separately; indexes, covers, and user state live in the data directory.
- **Built for reading**: preserve EPUB publisher styles, detect TXT encodings and chapters, and enjoy comics, paged or scrolling reading, themes, fonts, and text-to-speech.
- **Media browsing**: browse movies and series, artists and albums, or audiobooks and narrators. Filter by library, search, save favorites, and manage playback history and queues.
- **Metadata and organization**: read local tags, NFO, artwork, lyrics, and subtitles. Configure TMDB and MusicBrainz for online matching, review candidates, or edit metadata and editions manually.
- **Continue across devices**: accounts have independent shelves, notes, reading and playback progress. Web video uses DPlayer; audio includes lyrics, speed controls, and a sleep timer. Android supports native background playback.
- **Simple hosting**: one Docker container serves the backend and Web UI. Media scanning only reads source files, with separate databases and service threads for reading and media.

## Supported content

| Type | Support |
| --- | --- |
| EPUB / TXT | Publisher typography, contents, footnotes; TXT encoding detection and inferred chapters |
| CBZ / ZIP / image directories | Natural page ordering, comic paging, and volumes |
| PDF | Basic browser or device viewing without reflow |
| OPDS | Browse, search, and acquire books; publish a read-only catalog to external readers |
| Movies / series | Artwork, metadata, seasons, episodes, editions, subtitles, and progress |
| Music | Artists, albums, tracks, lyrics, queues, and continuous playback |
| Audiobooks | Narrators, descriptions, chapters, playback speed, and sleep timers |
| OpenList | Scan remote media and sidecar metadata, then play through Reader's authorized streaming API |

## Get started

Prepare Docker, Docker Compose, a book directory, and a separate data directory. Open `http://<your-host>:5888` after starting the service. The first registered account becomes the administrator. Follow the [getting started guide](docs/getting-started.en.md).

Reader opens on the video page (`#/media/video`) by default. Use the channel navigation to switch between video, music, audiobooks, and reading; the media entry on the shelf also opens the video page. Media settings include multiple themes; reading controls and bookshelf settings remain separate.

From the video page, open More actions → Media settings → Media libraries to add a server directory or OpenList library. Mount local media into Docker first and enter its container path. Library creation starts a scan. See the [media guide (中文)](docs/media-user-guide.zh-CN.md) and [OpenList setup (中文)](docs/media-openlist.md).

## Documentation

| I want to… | Start here |
| --- | --- |
| Deploy reader and add books or media | [Getting started](docs/getting-started.en.md) |
| Use shelves, reading, OPDS, and text-to-speech | [Reading guide (中文)](docs/user-guide.zh-CN.md) |
| Manage media, match metadata, and play content | [Media guide (中文)](docs/media-user-guide.zh-CN.md) |
| Connect OpenList / NAS / cloud storage mounts | [OpenList setup (中文)](docs/media-openlist.md) |
| Configure HTTPS, metadata tools, or TTS | [Configuration](docs/configuration.en.md) |
| Back up accounts, reading, and media state | [Backup and restore (中文)](docs/backup.zh-CN.md) |
| Develop, test, or build Android | [Development](docs/development.en.md), [media validation (中文)](docs/media-validation.md) |

## Current limits

- No audio/video transcoding. Playback depends on the browser or device's container and codec support.
- OpenList supports sidecar NFO, artwork, lyrics, and subtitles; remote embedded tags, artwork, and chapters are not read. Some drivers require OpenList Web proxy and correct Range support.
- No TVBox/JAR, media offline downloads, or direct cloud account login. OpenList manages cloud storage mounts.
- PDF viewing is basic; `.rar/.cbr` and general book conversion are unsupported. Offline reading depends on content cached on the current device.
- Web and Android clients are available. There are no standalone iOS or desktop clients; use a browser on desktop.

## Contributing

Bug reports, documentation improvements, and code contributions are welcome. Include reproduction steps, your environment, and redacted logs. See the [development guide](docs/development.en.md).

## License

[GNU Affero General Public License v3.0](LICENSE).
