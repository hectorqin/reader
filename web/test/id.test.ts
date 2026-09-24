import { expect, it, vi } from 'vitest';
import { newId } from '../src/core/id.ts';

it('generates distinct RFC 4122 v4 record IDs without randomUUID on LAN HTTP', () => {
  const random = globalThis.crypto;
  vi.stubGlobal('crypto',{getRandomValues:random.getRandomValues.bind(random)});
  try {
    const values=Array.from({length:1000},()=>newId());
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  } finally { vi.unstubAllGlobals(); }
});
