import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingTimeTracker, SLOT_MS } from '../src/features/stats/reading-time.ts';
import type { ReadingTimeEntry } from '../src/api/client.ts';

function memoryKv() {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key: string) => map.get(key) ?? null,
    set: async (key: string, value: string) => { map.set(key, value); },
    remove: async (key: string) => { map.delete(key); },
  };
}

const START = Date.UTC(2026, 9, 31, 2, 0); // on a slot boundary

describe('ReadingTimeTracker', () => {
  let clock = START, visible = true;
  let sent: ReadingTimeEntry[][] = [];
  let fail = false;
  const sink = { recordReadingTime: async (_id: string, entries: ReadingTimeEntry[]) => { if (fail) throw new Error('offline'); sent.push(entries); } };

  beforeEach(() => { vi.useFakeTimers(); clock = START; visible = true; sent = []; fail = false; });
  afterEach(() => { vi.useRealTimers(); });

  const advance = (ms: number, tracker: ReadingTimeTracker) => {
    for (let left = ms; left > 0; left -= 15_000) { clock += Math.min(15_000, left); tracker.tick(); }
  };
  const total = (entries: ReadingTimeEntry[] | undefined) => (entries ?? []).reduce((sum, entry) => sum + entry.seconds, 0);

  it('counts active reading and stops three minutes after the last activity', async () => {
    const tracker = new ReadingTimeTracker(sink, memoryKv(), () => clock, () => visible);
    tracker.start('b1');
    advance(10 * 60_000, tracker);
    await tracker.stop();
    expect(total(sent.at(-1))).toBe(180);
  });

  it('keeps counting while 朗读 speaks, even hidden', async () => {
    const tracker = new ReadingTimeTracker(sink, memoryKv(), () => clock, () => visible);
    tracker.start('b1');
    tracker.setSpeaking(true);
    visible = false;
    advance(10 * 60_000, tracker);
    await tracker.stop();
    expect(total(sent.at(-1))).toBe(600);
  });

  it('does not count a hidden page, nor the idle time before the reader comes back', async () => {
    const tracker = new ReadingTimeTracker(sink, memoryKv(), () => clock, () => visible);
    tracker.start('b1');
    visible = false;
    advance(5 * 60_000, tracker);
    visible = true;
    advance(5 * 60_000, tracker); // idle since start: nothing
    tracker.activity();
    advance(60_000, tracker);
    await tracker.stop();
    expect(total(sent.at(-1))).toBe(60);
  });

  it('splits time across slots and keeps unsent time across restarts', async () => {
    const kv = memoryKv();
    fail = true;
    const first = new ReadingTimeTracker(sink, kv, () => clock, () => visible);
    clock = START + SLOT_MS - 60_000;
    first.start('b1');
    first.activity();
    advance(120_000, first);
    await first.stop();
    expect(sent).toEqual([]);

    fail = false;
    const second = new ReadingTimeTracker(sink, kv, () => clock, () => visible);
    second.start('b2');
    await second.stop();
    const entries = sent.at(-1)!;
    expect(entries.filter(entry => entry.bookId === 'b1').map(entry => [entry.slot, entry.seconds]))
      .toEqual([[START, 60], [START + SLOT_MS, 60]]);
    // The finished slot is forgotten once sent; the current one is kept to keep growing.
    const stored = JSON.parse(kv.map.get('reader.readingTime.v1')!) as { entries: ReadingTimeEntry[] };
    expect(stored.entries.map(entry => entry.slot)).toEqual([START + SLOT_MS]);
    expect(kv.map.get('reader.clientId.v1')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
