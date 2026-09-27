// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { promoteSpeechInterface } from '../src/core/android-platform.ts';
import type { AndroidBridge, SpeechBridge } from '../src/android-bridge.ts';

afterEach(() => { delete window.ReaderAndroidSpeech; });

it('keeps injected methods bound to their native receiver when promoting speech', () => {
  const raw: AndroidBridge = {
    shellVersion: () => 3,
    deviceLabel: () => 'test',
    watchConnectivity: () => undefined,
    toast: () => undefined,
    hasNetwork: () => true,
    viewport: () => '{}',
    cacheUsage: () => '{}',
    diagnostics: () => '{}',
    hidePage: () => undefined,
    canOpenDocument: () => false,
    connectivity() {
      if (this !== raw) throw new Error('non-injected object');
      return 'online';
    },
    renderPage(request: string) {
      if (this !== raw) throw new Error('non-injected object');
      return request === 'page';
    },
  };
  const speech = { available: () => true } as SpeechBridge;
  Reflect.set(raw, 'speech', () => null);
  window.ReaderAndroidSpeech = speech;
  const promoted = promoteSpeechInterface(raw);
  expect(promoted.connectivity()).toBe('online');
  expect(promoted.renderPage('page')).toBe(true);
  expect(promoted.speech?.available()).toBe(true);
  expect(typeof raw.speech).toBe('function');
});

it('registers callback names and decodes native speech JSON without changing receivers', () => {
  const names: Record<string, string> = {};
  const raw = { watchConnectivity(name: string) { expect(this).toBe(raw); names.connectivity = name; } };
  const speech = {
    onSpeechEvent(name: string) { expect(this).toBe(speech); names.event = name; },
    onVoices(name: string) { expect(this).toBe(speech); names.voices = name; },
  };
  window.ReaderAndroidSpeech = speech as unknown as SpeechBridge;
  const adapted = promoteSpeechInterface(raw as unknown as AndroidBridge);
  const events: unknown[] = [];
  adapted.watchConnectivity(value => events.push(value));
  adapted.speech!.onSpeechEvent(value => events.push(value));
  adapted.speech!.onVoices(value => events.push(value));
  for (const name of Object.values(names)) expect(name).toMatch(/^[a-zA-Z_$][\w$]*$/);
  Reflect.get(window, names.connectivity!)('offline');
  Reflect.get(window, names.event!)(JSON.stringify({ type: 'done', id: 'sentence-1' }));
  Reflect.get(window, names.voices!)(JSON.stringify([{ id: 'zh', lang: 'zh-CN' }]));
  Reflect.get(window, names.event!)('invalid JSON');
  expect(events).toEqual(['offline', { type: 'done', id: 'sentence-1' }, [{ id: 'zh', lang: 'zh-CN' }]]);
  const replacement: unknown[] = [];
  adapted.speech!.onSpeechEvent(value => replacement.push(value));
  Reflect.get(window, names.event!)(JSON.stringify({ type: 'done', id: 'sentence-2' }));
  expect(events).toHaveLength(3);
  expect(replacement).toEqual([{ type: 'done', id: 'sentence-2' }]);
});

it('preserves bridges without a separate speech interface', () => {
  const raw = {} as AndroidBridge;
  expect(promoteSpeechInterface(raw)).toBe(raw);
});
