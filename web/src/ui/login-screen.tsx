import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { InstanceInfo } from '../api/types.ts';
import { mountUI } from './mount.ts';
import { Notice } from './toolkit.tsx';
import { type JSX } from './vendor/preact.ts';

export interface LoginScreenOptions {
  api: ReaderApi;
  defaultServerUrl: string;
  onAuthenticated(): void | Promise<void>;
  onServerUrlChange(url: string): Promise<void>;
}

interface LoginState {
  serverUrl: string;
  username: string;
  password: string;
  displayName: string;
  registering: boolean;
  busy: boolean;
  error: string;
  notice: string;
  noticeKind: 'info' | 'error';
  instance: InstanceInfo | null;
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
 *
 * The whole screen is now a function of `LoginState`. The previous version kept
 * eight node references and mutated them from five places — the notice, the
 * registration toggle, the probe that resolves 400ms after the last keystroke,
 * the submit handler and `reset()` — which meant a probe landing after a submit
 * could re-label a button the user was already pressing.
 */
export class LoginScreen {
  readonly element: HTMLDivElement;
  private readonly ui: ReturnType<typeof mountUI>;
  private state: LoginState;
  /** The probe's debounce, on the instance so a re-render cannot drop it. */
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: LoginScreenOptions) {
    this.state = {
      serverUrl: options.defaultServerUrl,
      username: '',
      password: '',
      displayName: '',
      registering: false,
      busy: false,
      error: '',
      notice: '',
      noticeKind: 'info',
      instance: null,
    };

    this.element = document.createElement('div');
    this.element.className = 'login-screen';
    this.element.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;overflow-y:auto;';
    this.ui = mountUI(this.element, () => this.view(), this.state);
    this.installProbeListener();
    void this.runProbe(this.state.serverUrl);
  }

  private draw(): void {
    this.ui.update(this.state);
  }

  private patch(patch: Partial<LoginState>): void {
    this.state = { ...this.state, ...patch };
    this.draw();
  }

  private view(): JSX.Element {
    const state = this.state;
    return (
      <form
        className="centered-form"
        onSubmit={(event) => {
          event.preventDefault();
          void this.submit();
        }}
      >
        <h1 style="margin:0 0 .25rem;font-size:1.3rem;">reader</h1>
        <p className="muted" style="margin:0 0 1.25rem;font-size:.85rem;">
          自部署书库阅读器
        </p>
        {state.notice ? <Notice>{state.notice}</Notice> : null}
        <div className="field">
          <label>服务端地址</label>
          <input
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="http://192.168.1.10:8080"
            value={state.serverUrl}
            onInput={(event) => this.onServerUrlChange((event.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div className="field">
          <label>用户名</label>
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={state.username}
            onInput={(event) => this.onUsernameInput((event.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div className="field">
          <label>密码</label>
          <input
            type="password"
            autoComplete={state.registering ? 'new-password' : 'current-password'}
            value={state.password}
            onInput={(event) => this.patch({ password: (event.currentTarget as HTMLInputElement).value })}
          />
        </div>
        {state.registering ? (
          <div className="field">
            <label>显示名（可选）</label>
            <input
              type="text"
              autoComplete="nickname"
              value={state.displayName}
              onInput={(event) => this.patch({ displayName: (event.currentTarget as HTMLInputElement).value })}
            />
          </div>
        ) : null}
        <button type="submit" className="button primary" disabled={state.busy}>
          {state.registering ? '注册并登录' : '登录'}
        </button>
        <div className="field" style="margin-top:.75rem;">
          <button type="button" className="button" onClick={() => this.toggleRegister()}>
            注册新账号
          </button>
        </div>
        {state.error ? <div className="error-text">{state.error}</div> : null}
      </form>
    );
  }

  private onServerUrlChange(value: string): void {
    this.patch({ serverUrl: value });
  }

  private onUsernameInput(value: string): void {
    const patch: Partial<LoginState> = { username: value };
    // Pre-fill the display name from the username while registering, which is
    // what the old version did from an `input` listener on the field.
    if (this.state.registering && !this.state.displayName) patch.displayName = value;
    this.patch(patch);
  }

  private toggleRegister(): void {
    this.patch({ registering: !this.state.registering });
  }

  /**
   * Probes the server URL once the reader stops changing it.
   *
   * Delegated to the container so it survives every re-render, with the debounce
   * held on the instance: a listener registered per render would accumulate, and
   * a timer owned by a render would be dropped by the next keystroke.
   *
   * The first probe also runs at construction, from the baked-in or remembered
   * URL — which is what makes the button label correct before anything is typed.
   */
  private installProbeListener(): void {
    this.element.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.getAttribute('type') !== 'url') return;
      if (this.probeTimer) clearTimeout(this.probeTimer);
      this.probeTimer = setTimeout(() => {
        this.probeTimer = null;
        void this.runProbe(target.value);
      }, 400);
    });
  }

  private async runProbe(url: string): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) return;
    this.options.api.setBaseUrl(trimmed);
    try {
      const instance = await this.options.api.instance();
      await this.options.onServerUrlChange(trimmed);
      this.patch({ instance, ...noticeForInstance(instance) });
    } catch (err) {
      this.patch({
        instance: null,
        ...(err instanceof ApiError && err.isConnectivity
          ? { notice: '连不上这个地址。确认服务端已启动，且地址包含端口。', noticeKind: 'error' as const }
          : err instanceof ApiError
            ? { notice: err.message, noticeKind: 'error' as const }
            : { notice: '', instance: null }),
      });
    }
  }

  private async submit(): Promise<void> {
    const url = this.state.serverUrl.trim();
    if (!url) {
      this.patch({ error: '请填写服务端地址' });
      return;
    }
    this.options.api.setBaseUrl(url);
    const username = this.state.username.trim();
    const password = this.state.password;
    if (!username || !password) {
      this.patch({ error: '请填写用户名和密码' });
      return;
    }
    if (password.length < 8) {
      this.patch({ error: '密码至少 8 位（服务端的硬性要求）' });
      return;
    }

    this.patch({ error: '', busy: true });
    try {
      if (this.state.registering) {
        await this.options.api.register(username, password, this.state.displayName.trim() || undefined);
      } else {
        await this.options.api.login(username, password);
      }
      await this.options.onServerUrlChange(url);
      await this.options.onAuthenticated();
    } catch (err) {
      this.patch({ error: describeSubmitError(err) });
    } finally {
      this.patch({ busy: false });
    }
  }

  /** Lets the router re-show the form after a session expiry. */
  reset(message?: string): void {
    this.patch({ password: '', ...(message ? { error: message } : {}) });
    if (message) this.patch({ error: message });
  }
}

function noticeForInstance(instance: InstanceInfo): Partial<LoginState> {
  if (instance.userCount === 0) {
    return { notice: '这是一个全新的实例，第一个注册的账号会成为管理员。', noticeKind: 'info', registering: true };
  }
  if (instance.registrationOpen) {
    return { notice: `已有 ${instance.userCount} 个账号，此实例开放注册。`, noticeKind: 'info' };
  }
  return { notice: '', noticeKind: 'info' };
}

function describeSubmitError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isConnectivity) return '连不上服务端，检查地址和网络';
    if (err.code === 'REGISTRATION_DISABLED') return '此实例已关闭公开注册，请让管理员创建账号';
    if (err.code === 'PASSWORD_TOO_SHORT') return '密码至少 8 位';
    if (err.isAuthFailure) return '用户名或密码错误';
    return err.message;
  }
  return err instanceof Error ? err.message : '登录失败';
}
