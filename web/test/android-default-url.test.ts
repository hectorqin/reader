// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { inferDefaultUrl, validServerUrl } from '../src/app.ts';

afterEach(() => { vi.unstubAllGlobals(); delete window.ReaderAndroid; });

it('never infers the Android local asset origin as a server', () => {
  vi.stubGlobal('location', new URL('https://appassets.androidplatform.net/assets/index.html'));
  expect(inferDefaultUrl()).toBe('');
  expect(validServerUrl('https://appassets.androidplatform.net')).toBe('');
});

it('reads the configured native server and keeps manual server settings valid', () => {
  vi.stubGlobal('location', new URL('https://appassets.androidplatform.net/assets/index.html'));
  vi.stubGlobal('ReaderAndroid', { configuredServerUrl: () => 'https://reader.example.com' });
  expect(inferDefaultUrl()).toBe('https://reader.example.com');
  expect(validServerUrl('http://192.168.1.10:5888')).toBe('http://192.168.1.10:5888');
});

it('preserves same-origin browser defaults', () => {
  vi.stubGlobal('location', new URL('https://reader.example.com/'));
  expect(inferDefaultUrl()).toBe('https://reader.example.com');
});
