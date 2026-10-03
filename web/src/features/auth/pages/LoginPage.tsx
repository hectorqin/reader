import { Alert, Badge, Button, Center, Divider, Group, Loader, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { InstanceInfo } from '../../../api/types.ts';
import { ApiError } from '../../../api/errors.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { validServerUrl } from '../../../app/runtime.ts';

export function LoginPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const session = useAuthStore(state => state.session);
  const [serverUrl, setServerUrl] = useState(runtime.api.baseUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [registering, setRegistering] = useState(false);
  const [instance, setInstance] = useState<InstanceInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const probe = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeGeneration = useRef(0);
  useEffect(() => { if (session) navigate('/media/video', { replace: true }); }, [session, navigate]);
  useEffect(() => {
    const value = serverUrl.trim();
    probeGeneration.current += 1;
    if (probe.current) clearTimeout(probe.current);
    if (!value) { setInstance(null); setNotice('请输入服务端地址'); return;
    }
    if (!validServerUrl(value)) { setInstance(null); setNotice('请输入 http:// 或 https:// 开头的地址'); return; }
    probe.current = setTimeout(() => { void probeServer(value); }, 350);
    return () => { if (probe.current) clearTimeout(probe.current); };
  }, [serverUrl]);
  const probeServer = async (value: string) => {
    const generation = ++probeGeneration.current;
    setProbing(true); runtime.api.setBaseUrl(value);
    try {
      const result = await runtime.api.instance();
      if (generation !== probeGeneration.current) return;
      setInstance(result);
      if (result.userCount === 0) { setRegistering(true); setNotice('这是一个全新的实例，第一个注册的账号会成为管理员。'); }
      else if (result.registrationOpen) setNotice(result.invitationRequired ? '此书房需要邀请码注册，请向管理员获取。' : `已有 ${result.userCount} 个账号，此实例开放注册。`);
      else { setRegistering(false); setNotice('此实例已关闭公开注册，请使用已有账号登录。'); }
    } catch (reason) {
      if (generation !== probeGeneration.current) return;
      setInstance(null); setNotice(reason instanceof ApiError && reason.isConnectivity ? '连不上这个地址，请检查服务端是否已启动。' : '无法读取服务端信息，请核对地址。');
    } finally { if (generation === probeGeneration.current) setProbing(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const url = validServerUrl(serverUrl);
    const name = username.trim();
    if (!url || !name || !password) { setError('请填写有效的服务端地址、用户名和密码'); return; }
    if (password.length < 8) { setError('密码至少 8 位'); return; }
    if (registering && instance && !instance.registrationOpen) { setError('此实例已关闭公开注册，请使用已有账号登录'); return; }
    setBusy(true); setError(''); runtime.api.setBaseUrl(url);
    try {
      if (registering) await runtime.api.register(name, password, displayName.trim() || undefined, inviteCode.trim() || undefined);
      else await runtime.api.login(name, password);
      await runtime.settings.setServerUrl(url);
      await runtime.authenticated();
    } catch (reason) {
      setError(reason instanceof ApiError ? (reason.isConnectivity ? '连不上服务端，检查地址和网络' : reason.code === 'REGISTRATION_DISABLED' ? '此实例已关闭公开注册，请让管理员创建账号' : reason.code === 'INVITE_REQUIRED' || reason.code === 'INVALID_INVITE' ? '请输入有效的邀请码' : reason.code === 'PASSWORD_TOO_SHORT' ? '密码至少 8 位' : reason.isAuthFailure ? '用户名或密码错误' : reason.message) : reason instanceof Error ? reason.message : '登录失败');
    } finally { setBusy(false); }
  };
  const canRegister = !!instance?.registrationOpen;
  return <Center mih="100vh" p="md"><form onSubmit={submit} style={{ width: 'min(100%, 28rem)' }}><Stack gap="md"><Stack gap={2}><Title order={1}>reader</Title><Text c="dimmed">你的私人书房</Text></Stack><TextInput label="服务端地址" type="url" value={serverUrl} onChange={event => setServerUrl(event.currentTarget.value)} placeholder="http://127.0.0.1:5888" required rightSection={probing ? <Loader size="xs" /> : instance ? <Badge color="green">在线</Badge> : undefined} /><Group justify="space-between" align="center"><Text size="sm" c="dimmed">{instance?.name || '尚未连接服务端'}</Text>{instance && <Text size="xs" c="dimmed">API v{instance.apiVersion}</Text>}</Group><Divider /><TextInput label="用户名" autoComplete="username" value={username} onChange={event => setUsername(event.currentTarget.value)} required />{registering && <TextInput label="显示名（可选）" value={displayName} onChange={event => setDisplayName(event.currentTarget.value)} />}{registering && instance?.invitationRequired && <TextInput label="邀请码" value={inviteCode} onChange={event => setInviteCode(event.currentTarget.value)} required />}{registering && <Text size="xs" c="dimmed">注册后会自动登录并保存此服务端地址。</Text>}<PasswordInput label="密码" autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.currentTarget.value)} required />{notice && <Alert color={instance ? 'blue' : 'yellow'}>{notice}</Alert>}{error && <Alert color="red">{error}</Alert>}<Button type="submit" loading={busy} disabled={!validServerUrl(serverUrl)}>{registering ? '注册并登录' : '登录'}</Button>{(canRegister || registering) && <Button type="button" variant="subtle" disabled={busy} onClick={() => setRegistering(value => !value)}>{registering ? '返回登录' : '注册新账号'}</Button>}</Stack></form></Center>;
}
