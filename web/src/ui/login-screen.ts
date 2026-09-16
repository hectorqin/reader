import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { InstanceInfo } from '../api/types.ts';
import { clear, el } from './dom.ts';

export interface LoginScreenOptions {
  api: ReaderApi;
  defaultServerUrl: string;
  onAuthenticated(): void;
  onServerUrlChange(url: string): Promise<void>;
}

/**
 * Sign-in, and the first-run experience.
 *
 * The first-run path is the one that decides whether a self-hosted product gets
 * adopted, so it is explicit rather than clever: probe the URL, show whether the
 * instance is fresh or already claimed, and only offer registration when the
 * server will actually accept it. Finding that out by submitting a form and
 * getting `REGISTRATION_DISABLED` back is the kind of first impression that
 * loses a user.
 */
export class LoginScreen {
  readonly element: HTMLDivElement;
  private readonly serverInput: HTMLInputElement;
  private readonly usernameInput: HTMLInputElement;
  private readonly passwordInput: HTMLInputElement;
  private readonly displayNameInput: HTMLInputElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly errorText: HTMLDivElement;
  private readonly notice: HTMLDivElement;
  private instance: InstanceInfo | null = null;
  private registering = false;

  constructor(private readonly options: LoginScreenOptions) {
    this.serverInput = el('input', {
      attrs: { type: 'url', inputmode: 'url', autocomplete: 'url', placeholder: 'http://192.168.1.10:8080', value: options.defaultServerUrl },
    });
    this.usernameInput = el('input', { attrs: { type: 'text', autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' } });
    this.passwordInput = el('input', { attrs: { type: 'password', autocomplete: 'current-password' } });
    this.displayNameInput = el('input', { attrs: { type: 'text', autocomplete: 'nickname' } });
    this.errorText = el('div', { className: 'error-text', attrs: { hidden: true } }) as HTMLDivElement;
    this.notice = el('div', { className: 'notice', attrs: { hidden: true } }) as HTMLDivElement;
    this.submitButton = el('button', {
      className: 'button primary',
      text: '登录',
      attrs: { type: 'submit' },
    }) as HTMLButtonElement;

    const form = el('form', {
      className: 'centered-form',
      on: { submit: (event) => { event.preventDefault(); void this.submit(); } },
      children: [
        el('h1', { text: 'reader', attrs: { style: 'margin:0 0 .25rem;font-size:1.3rem;' } }),
        el('p', { className: 'muted', text: '自部署书库阅读器', attrs: { style: 'margin:0 0 1.25rem;font-size:.85rem;' } }),
        this.notice,
        el('div', { className: 'field', children: [el('label', { text: '服务端地址' }), this.serverInput] }),
        el('div', { className: 'field', children: [el('label', { text: '用户名' }), this.usernameInput] }),
        el('div', { className: 'field', children: [el('label', { text: '密码' }), this.passwordInput] }),
        el('div', {
          className: 'field',
          attrs: { hidden: true },
          dataset: { role: 'display-name' },
          children: [el('label', { text: '显示名（可选）' }), this.displayNameInput],
        }),
        this.submitButton,
        el('div', { className: 'field', attrs: { style: 'margin-top:.75rem;' }, children: [
          el('button', {
            className: 'button',
            text: '注册新账号',
            attrs: { type: 'button', 'data-role': 'toggle-register' },
            on: { click: () => this.toggleRegister() },
          }),
        ]}),
        this.errorText,
      ],
    });

    this.element = el('div', {
      className: 'login-screen',
      children: [form],
    }) as HTMLDivElement;
    this.element.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;overflow-y:auto;';

    // Probe as soon as the URL stops changing, so the button label is correct
    // before the reader types anything into the credential fields.
    let probeTimer: ReturnType<typeof setTimeout> | null = null;
    this.serverInput.addEventListener('input', () => {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = setTimeout(() => void this.probe(), 400);
    });
    this.usernameInput.addEventListener('input', () => {
      if (this.registering && this.instance) {
        this.displayNameInput.value = this.displayNameInput.value || this.usernameInput.value;
      }
    });

    void this.probe();
  }

  private async probe(): Promise<void> {
    const url = this.serverInput.value.trim();
    if (!url) return;
    this.options.api.setBaseUrl(url);
    try {
      this.instance = await this.options.api.instance();
      await this.options.onServerUrlChange(url);
      if (this.instance.userCount === 0) {
        this.setNotice('这是一个全新的实例，第一个注册的账号会成为管理员。');
        this.setRegistering(true);
      } else if (this.instance.registrationOpen) {
        this.setNotice(`已有 ${this.instance.userCount} 个账号，此实例开放注册。`);
      } else {
        this.clearNotice();
      }
    } catch (err) {
      this.instance = null;
      if (err instanceof ApiError && err.isConnectivity) {
        this.setNotice('连不上这个地址。确认服务端已启动，且地址包含端口。', 'error');
      } else if (err instanceof ApiError) {
        this.setNotice(err.message, 'error');
      }
    }
  }

  private toggleRegister(): void {
    this.setRegistering(!this.registering);
  }

  private setRegistering(registering: boolean): void {
    this.registering = registering;
    const displayNameField = this.element.querySelector('[data-role="display-name"]') as HTMLElement | null;
    if (displayNameField) displayNameField.hidden = !registering;
    this.submitButton.textContent = registering ? '注册并登录' : '登录';
    this.passwordInput.setAttribute('autocomplete', registering ? 'new-password' : 'current-password');
  }

  private setNotice(text: string, kind: 'info' | 'error' = 'info'): void {
    this.notice.hidden = false;
    this.notice.textContent = text;
    this.notice.style.background = kind === 'error'
      ? 'color-mix(in srgb, #b6453a 14%, var(--reader-surface))'
      : '';
  }

  private clearNotice(): void {
    this.notice.hidden = true;
  }

  private showError(message: string): void {
    this.errorText.hidden = false;
    this.errorText.textContent = message;
  }

  private clearError(): void {
    this.errorText.hidden = true;
  }

  private async submit(): Promise<void> {
    this.clearError();
    const url = this.serverInput.value.trim();
    if (!url) {
      this.showError('请填写服务端地址');
      return;
    }
    this.options.api.setBaseUrl(url);
    const username = this.usernameInput.value.trim();
    const password = this.passwordInput.value;
    if (!username || !password) {
      this.showError('请填写用户名和密码');
      return;
    }
    if (password.length < 8) {
      this.showError('密码至少 8 位（服务端的硬性要求）');
      return;
    }

    this.submitButton.disabled = true;
    try {
      if (this.registering) {
        await this.options.api.register(username, password, this.displayNameInput.value.trim() || undefined);
      } else {
        await this.options.api.login(username, password);
      }
      await this.options.onServerUrlChange(url);
      this.options.onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.isConnectivity) this.showError('连不上服务端，检查地址和网络');
        else if (err.code === 'REGISTRATION_DISABLED') this.showError('此实例已关闭公开注册，请让管理员创建账号');
        else if (err.code === 'PASSWORD_TOO_SHORT') this.showError('密码至少 8 位');
        else if (err.isAuthFailure) this.showError('用户名或密码错误');
        else this.showError(err.message);
      } else {
        this.showError(err instanceof Error ? err.message : '登录失败');
      }
    } finally {
      this.submitButton.disabled = false;
    }
  }

  /** Lets the router re-show the form after a session expiry. */
  reset(message?: string): void {
    this.passwordInput.value = '';
    if (message) this.showError(message);
    clear(this.errorText);
    if (message) this.showError(message);
    this.usernameInput.focus();
  }
}
