import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.ts';
import type { AppConfig } from '../config/index.ts';
import type { Scanner } from '../indexer/scanner.ts';
import type { UserService, PublicUser } from '../services/users.ts';
import type { ShelfService } from '../services/shelf.ts';
import type { SyncService } from '../services/sync.ts';
import type { TtsService } from '../services/tts.ts';

export interface AppContext {
  config: AppConfig;
  db: Db;
  scanner: Scanner;
  users: UserService;
  shelf: ShelfService;
  sync: SyncService;
  tts: TtsService;
  log: FastifyBaseLogger;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the auth preHandler; absent on public routes. */
    currentUser?: PublicUser;
  }
}
