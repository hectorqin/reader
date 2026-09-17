import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.ts';
import type { AppConfig } from '../config/index.ts';
import type { Scanner } from '../indexer/scanner.ts';
import type { UserService, PublicUser } from '../services/users.ts';
import type { ShelfService } from '../services/shelf.ts';
import type { SyncService } from '../services/sync.ts';
import type { TtsService } from '../services/tts.ts';
import type { BrowseService } from '../services/browse.ts';

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
  log: FastifyBaseLogger;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the auth preHandler; absent on public routes. */
    currentUser?: PublicUser;
  }
}
