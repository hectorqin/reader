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
 *
 * This is the oldest screen in the client and the one that shows what the
 * component layer is for: the mode, the two fields, the error line and the
 * button's own disabled state used to be four DOM nodes mutated by hand from
 * `run()`, and every one of them could disagree with the others after a failure.
 * Here they are all drawn from the same state.
 */

import { ApiClient } from '../net/api.ts';
import { mountUI } from './mount.ts';
import type { JSX } from './vendor/preact.ts';

export interface AuthHost {
  onSignedIn?: () => void;
}

interface AuthState {
  mode: 'register' | 'login';
  hint: string;
  username: string;
  password: string;
  error: string;
  busy: boolean;
}

export class AuthView {
  private readonly ui: ReturnType<typeof mountUI>;
  private state: AuthState = {
    mode: 'login',
    hint: '请用管理员创建的账号登录。',
    username: '',
    password: '',
    error: '',
    busy: false,
  };

  constructor(
    host: HTMLElement,
    private readonly api: ApiClient,
    private readonly options: AuthHost = {},
  ) {
    const root = document.createElement('div');
    root.className = 'dialog';
    host.replaceChildren(root);
    this.ui = mountUI(root, () => this.view(), this.state);
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
    const mode: AuthState['mode'] = registrationOpen && userCount === 0 ? 'register' : 'login';
    this.state = {
      ...this.state,
      mode,
      hint: mode === 'register' ? '第一个注册的账号会自动成为管理员。' : '请用管理员创建的账号登录。',
    };
    this.draw();
  }

  private draw(): void {
    this.ui.update(this.state);
  }

  private view(): JSX.Element {
    return <AuthPanel state={this.state} onPatch={(patch) => this.patch(patch)} onSubmit={() => void this.submit()} />;
  }

  private patch(patch: Partial<AuthState>): void {
    this.state = { ...this.state, ...patch };
    this.draw();
  }

  private async submit(): Promise<void> {
    this.patch({ error: '', busy: true });
    try {
      if (this.state.mode === 'register') await this.api.register(this.state.username.trim(), this.state.password);
      else await this.api.login(this.state.username.trim(), this.state.password);
      this.options.onSignedIn?.();
    } catch (failure) {
      this.patch({ error: describe(failure) });
    } finally {
      this.patch({ busy: false });
    }
  }
}

/**
 * The form itself.
 *
 * A component so the "busy" state, the error line and the button label are
 * rendered from one value: the old version hid and unhid the error node and
 * toggled `disabled` from inside an async function, which is how a rejected
 * login could leave the button disabled for good.
 */
function AuthPanel({
  state,
  onPatch,
  onSubmit,
}: {
  state: AuthState;
  onPatch(patch: Partial<AuthState>): void;
  onSubmit(): void;
}): JSX.Element {
  const registering = state.mode === 'register';
  return (
    <div className="dialog__panel">
      <h2 className="dialog__title">{registering ? '创建第一个账号' : '登录'}</h2>
      <p className="dialog__row">{state.hint}</p>
      <label className="dialog__row">
        用户名
        <input
          autoComplete="username"
          placeholder="用户名"
          value={state.username}
          onInput={(event) => onPatch({ username: (event.currentTarget as HTMLInputElement).value })}
        />
      </label>
      <label className="dialog__row">
        口令
        <input
          type="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          placeholder="口令"
          value={state.password}
          onInput={(event) => onPatch({ password: (event.currentTarget as HTMLInputElement).value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit();
          }}
        />
      </label>
      {state.error ? <div className="reader__warning">{state.error}</div> : null}
      <div className="dialog__actions">
        <button type="button" className="dialog__button dialog__button--primary" disabled={state.busy} onClick={onSubmit}>
          {registering ? '创建并登录' : '登录'}
        </button>
      </div>
    </div>
  );
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
