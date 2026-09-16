/**
 * Sign-in.
 *
 * The first account on a fresh instance becomes the admin, so this screen has to
 * know whether the instance is empty — showing a login form to the person setting
 * the server up for the first time is the most common way a self-hosted product
 * loses a user in the first two minutes.
 *
 * The instance probe is unauthenticated by design, so it can run before anyone
 * has a token.
 */

import { ApiClient } from '../net/api.ts';

export interface AuthHost {
  onSignedIn?: () => void;
}

export class AuthView {
  private readonly root: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly api: ApiClient,
    private readonly options: AuthHost = {},
  ) {
    this.root = document.createElement('div');
    this.root.className = 'dialog';
    host.replaceChildren(this.root);
  }

  async render(): Promise<void> {
    let registrationOpen = true;
    let userCount = 0;
    try {
      const instance = await this.api.instance();
      registrationOpen = instance.registrationOpen;
      userCount = instance.userCount;
    } catch {
      // An unreachable server is reported by the submit handler with a real
      // message; guessing here would only duplicate it worse.
    }
    // The first account is always allowed, whatever the instance says.
    const mode: 'register' | 'login' = registrationOpen && userCount === 0 ? 'register' : 'login';

    const panel = document.createElement('div');
    panel.className = 'dialog__panel';
    const title = document.createElement('h2');
    title.className = 'dialog__title';
    title.textContent = mode === 'register' ? '创建第一个账号' : '登录';

    const hint = document.createElement('p');
    hint.className = 'dialog__row';
    hint.textContent =
      mode === 'register' ? '第一个注册的账号会自动成为管理员。' : '请用管理员创建的账号登录。';

    const username = document.createElement('input');
    username.autocomplete = 'username';
    username.placeholder = '用户名';
    const password = document.createElement('input');
    password.type = 'password';
    password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    password.placeholder = '口令';

    const userRow = document.createElement('label');
    userRow.className = 'dialog__row';
    userRow.append('用户名', username);
    const passRow = document.createElement('label');
    passRow.className = 'dialog__row';
    passRow.append('口令', password);

    const error = document.createElement('div');
    error.className = 'reader__warning';
    error.hidden = true;

    const submit = document.createElement('button');
    submit.className = 'dialog__button dialog__button--primary';
    submit.textContent = mode === 'register' ? '创建并登录' : '登录';

    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    actions.append(submit);
    panel.append(title, hint, userRow, passRow, error, actions);
    this.root.replaceChildren(panel);

    const run = async (): Promise<void> => {
      error.hidden = true;
      submit.disabled = true;
      try {
        if (mode === 'register') await this.api.register(username.value.trim(), password.value);
        else await this.api.login(username.value.trim(), password.value);
        this.options.onSignedIn?.();
      } catch (failure) {
        error.hidden = false;
        error.textContent = describe(failure);
      } finally {
        submit.disabled = false;
      }
    };

    submit.addEventListener('click', () => void run());
    password.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void run();
    });
    username.focus();
  }
}

/**
 * Turn a server error into something a person can act on.
 *
 * The codes are part of the API's compatibility promise, so mapping them here is
 * safe — and the server's own messages are English, while this UI is not.
 */
function describe(failure: unknown): string {
  const code = (failure as { code?: string }).code;
  switch (code) {
    case 'BAD_CREDENTIALS':
      return '用户名或口令错误';
    case 'REGISTRATION_DISABLED':
      return '这个实例已关闭公开注册，请让管理员创建账号';
    case 'PASSWORD_TOO_SHORT':
      return '口令至少 8 位';
    case 'USERNAME_TAKEN':
      return '用户名已被占用';
    case 'ACCOUNT_DISABLED':
      return '账号已被停用';
    case 'HTTP_ERROR':
    case undefined:
      return '无法连接服务端，检查地址与网络';
    default:
      return failure instanceof Error ? failure.message : '操作失败';
  }
}
