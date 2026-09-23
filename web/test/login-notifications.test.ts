// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import { LoginScreen } from '../src/ui/login-screen.tsx';
import { FakeTransport, makePlatform } from './helpers/env.ts';
import { noticeText, visibleNotices } from './helpers/notices.ts';

const screens: LoginScreen[] = [];
afterEach(() => { screens.splice(0).forEach(screen => screen.dispose()); document.body.replaceChildren(); });

function setup() {
  const transport = new FakeTransport();
  const api = new ReaderApi(makePlatform(transport), { async load() { return null; }, async save() {}, async clear() {} });
  transport.json({ userCount: 1, registrationOpen: false });
  const screen = new LoginScreen({ api, defaultServerUrl: 'https://reader.test', onAuthenticated() {}, async onServerUrlChange() {} });
  screens.push(screen); document.body.append(screen.element);
  return { screen, transport };
}

it('shows login validation globally, keeps the form in place and clears its notice on disposal', async () => {
  const { screen } = setup();
  await vi.waitFor(() => expect(screen.element.querySelector('button[type=submit]')?.textContent).toBe('登录'));
  const form = screen.element.querySelector('form')!;
  const children = [...form.children];
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(noticeText()).toBe('请填写用户名和密码');
  expect(document.querySelector('body > .notyf [role=alert]')).not.toBeNull();
  expect([...form.children]).toEqual(children);
  expect(form.querySelector('.error-text, .notyf')).toBeNull();
  screen.dispose();
  expect(visibleNotices()).toHaveLength(0);
});

it('does not publish a late probe failure after leaving login', async () => {
  const { screen, transport } = setup();
  let reject!: (error: Error) => void;
  transport.respondWith(() => new Promise((_, fail) => { reject = fail; }));
  const input = screen.element.querySelector<HTMLInputElement>('input[type=url]')!;
  input.value = 'https://another.test'; input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
  screen.dispose(); reject(new Error('late failure'));
  await Promise.resolve();
  expect(visibleNotices()).toHaveLength(0);
});
