import { useEffect, useRef, useState } from 'react';
import { ApiError, type ReaderApi } from '../api/client.ts';
import type { McpCredential, McpScope } from '../api/sources.ts';
import { Button } from './toolkit.tsx';
import { FloatingNotice } from './floating-notice.tsx';
import { Select } from './select.tsx';

/**
 * Personal MCP credentials for AI assistants (Claude Desktop, Claude Code,
 * Cursor, OpenClaw, etc.). Mirrors `OpdsAccess` under 我的 (/me/mcp).
 */
export function McpAccess({ api, onSignedOut }: { api: ReaderApi; onSignedOut(): void }) {
  const [items, setItems] = useState<McpCredential[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<McpScope>('read');
  const [created, setCreated] = useState<{ id: string; token: string; scope: McpScope } | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const running = useRef(false);

  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      if (active.current) {
        if (reason instanceof ApiError && reason.isAuthFailure) onSignedOut();
        else setError(reason instanceof Error ? reason.message : '操作失败');
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };

  const reload = async () => {
    const value = await api.mcpCredentials();
    if (!active.current) return;
    setItems(value.credentials);
    setUrl(new URL(value.endpointUrl, api.baseUrl || location.href).href);
  };

  useEffect(() => {
    void run(reload);
    return () => {
      active.current = false;
    };
  }, []);

  const snippet = created
    ? JSON.stringify(
        {
          mcpServers: {
            reader: {
              url,
              headers: { Authorization: `Bearer ${created.token}` },
            },
          },
        },
        null,
        2,
      )
    : '';

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => {
        if (active.current) setCopied('');
      }, 2000);
    } catch {
      setError('当前环境不支持一键复制，请手动选择复制');
    }
  };

  return (
    <div className="sheet-form opds-access">
      <FloatingNotice message={busy ? '正在处理…' : copied ? `已复制${copied}` : error} busy={busy} error={!!error} />
      <p className="sheet-text">
        通过标准 MCP（Streamable HTTP）让 Claude、Cursor、OpenClaw 等 AI 助手直连当前账号的书架、章节正文与读书笔记。
      </p>
      <label className="sheet-field">
        MCP 端点地址
        <input readOnly value={url} />
      </label>
      <p className="sheet-text">凭据有效期一年，可随时撤销；建议优先使用只读权限，仅在需要 AI 写入笔记时开启读写。</p>
      {created && (
        <div className="sheet-form" role="status">
          <p className="sheet-text">Token 仅展示这一次，请先保存。关闭后无法重新查看。</p>
          <label className="sheet-field">
            Bearer Token（{created.scope === 'write' ? '读写' : '只读'}）
            <input readOnly value={created.token} autoComplete="off" />
          </label>
          <label className="sheet-field">
            客户端配置示例（JSON）
            <textarea readOnly rows={8} value={snippet} />
          </label>
          <div>
            <Button type="button" onClick={() => void copyText('配置 JSON', snippet)}>
              复制配置 JSON
            </Button>
          </div>
        </div>
      )}
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const result = await api.createMcpCredential(name, scope);
            if (!active.current) return;
            setCreated({ id: result.id, token: result.token, scope: result.scope });
            setName('');
            await reload();
          });
        }}
      >
        <label className="sheet-field">
          客户端名称
          <input
            required
            maxLength={80}
            value={name}
            disabled={busy}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder="例如：Cursor / Claude Code"
          />
        </label>
        <label className="sheet-field">
          权限范围
          <Select value={scope} disabled={busy} onChange={(event) => setScope(event.currentTarget.value as McpScope)}>
            <option value="read">只读（检索书架、分片读正文、查笔记）</option>
            <option value="write">读写（包含只读能力 + 允许写入读书笔记）</option>
          </Select>
        </label>
        <Button type="submit" disabled={busy || !name.trim()}>
          创建 MCP 凭据
        </Button>
      </form>
      {items.map((item) => (
        <article className="sources-row" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <small>
              {item.scope === 'write' ? '读写' : '只读'} · 到期：{new Date(item.expiresAt).toLocaleDateString()}
            </small>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.revokeMcpCredential(item.id);
                if (!active.current) return;
                if (created?.id === item.id) setCreated(null);
                await reload();
              })
            }
          >
            撤销 {item.name}
          </Button>
        </article>
      ))}
    </div>
  );
}
