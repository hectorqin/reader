import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.ts';
import type { AppConfig } from '../config/index.ts';
import type { Scanner } from '../indexer/scanner.ts';
import type { UserService, PublicUser } from '../services/users.ts';
import type { ShelfService } from '../services/shelf.ts';
import type { SyncService } from '../services/sync.ts';
import type { TtsService } from '../services/tts.ts';
import type { BrowseService } from '../services/browse.ts';
import type { UploadService } from '../services/uploads.ts';
import type { SourceHost } from '../services/source-host.ts';

export interface AppContext {
  config: AppConfig;
  db: Db;
  scanner: Scanner;
  users: UserService;
  shelf: ShelfService;
  sync: SyncService;
  tts: TtsService;
  /**
   * The library tree, for the file-manager screen.
   *
   * Separate from `shelf` on purpose: the shelf serves *books*, keyed by a
   * stable identity, and cannot answer "what is on the disk" — a path is not
   * part of a book's DTO anywhere in the API.
   */
  browse: BrowseService;
  /**
   * Uploads into the library, and the incremental scan that follows.
   *
   * Held apart from `browse` because the two disagree on the one thing that
   * matters: `browse` never writes unless the deployment allows it, and an
   * upload *is* the write the reader asked for. Keeping them separate keeps the
   * file manager's "this mount is read-only, so here is a screen with no write
   * buttons" answer from being weakened by the one feature whose whole purpose
   * is to write.
   */
  uploads: UploadService;
  sources?: SourceHost;
  log: FastifyBaseLogger;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the auth preHandler; absent on public routes. */
    currentUser?: PublicUser;
  }
}
