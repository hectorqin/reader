import type { Db } from '../src/db/index.ts';

/**
 * Turns on `library.autoShelf` for a suite written against a library whose books
 * reach every shelf by themselves. It is off by default: a shelf holds what its
 * reader put there.
 */
export function autoShelf(db: Db): void {
  db.run(
    "INSERT INTO business_settings (name, value, revision) VALUES ('library', ?, 1) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
    JSON.stringify({ memberUpload: true, autoShelf: true }),
  );
}
