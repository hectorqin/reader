import { type JSX, useEffect, useState } from 'react';
import { Sheet } from './sheet.tsx';
import { Button } from './toolkit.tsx';

export type CompanionEntityCategory = 'character' | 'item' | 'place' | 'organization' | 'term';

const CATEGORY_LABELS: Record<CompanionEntityCategory, string> = {
  character: '人物',
  item: '物品',
  place: '地点',
  organization: '势力',
  term: '术语',
};

const CATEGORY_ORDER: readonly CompanionEntityCategory[] = ['character', 'item', 'place', 'organization', 'term'];

export interface CompanionEntity {
  name: string;
  category: CompanionEntityCategory;
  aliases: string[];
  role: string;
  note: string;
  firstSeenSeq: number;
  lastSeenSeq: number;
  mentions: number;
  timeline: Array<{ seq: number; note: string }>;
}

export interface CompanionRelation {
  from: string;
  to: string;
  label: string;
  firstSeenSeq: number;
  lastSeenSeq: number;
  history: Array<{ seq: number; label: string }>;
}

export interface CompanionData {
  bookId: string;
  title: string;
  uptoSeq: number;
  chapterTitle: string;
  totalChapters: number;
  coveredChapters: number;
  newlyExtracted: number;
  recap: string;
  recapCached: boolean;
  entities: CompanionEntity[];
  relations: CompanionRelation[];
  openThreads: string[];
}

function CharacterGraphSvg({
  entities,
  relations,
}: {
  entities: CompanionEntity[];
  relations: CompanionRelation[];
}): JSX.Element | null {
  const characters = entities.filter((e) => e.category === 'character');
  const nodes = (characters.length > 0 ? characters : entities).slice(0, 10);
  if (nodes.length === 0) return null;
  const cx = 200;
  const cy = 140;
  const radius = nodes.length <= 2 ? 70 : 96;
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, idx) => {
    const angle = (2 * Math.PI * idx) / nodes.length - Math.PI / 2;
    positions.set(node.name.toLowerCase(), {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });

  const edges = relations.filter(
    (rel) => positions.has(rel.from.toLowerCase()) && positions.has(rel.to.toLowerCase()),
  );

  return (
    <svg
      viewBox="0 0 400 280"
      role="img"
      aria-label="人物关系图谱"
      style={{
        width: '100%',
        height: 'auto',
        maxHeight: '260px',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-surface-subtle)',
      }}
    >
      {edges.map((rel, idx) => {
        const a = positions.get(rel.from.toLowerCase())!;
        const b = positions.get(rel.to.toLowerCase())!;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={`${rel.from}-${rel.to}-${idx}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--color-border-strong)"
              strokeWidth="1.5"
              strokeOpacity="0.8"
            />
            <text x={mx} y={my - 4} textAnchor="middle" fontSize="10" fill="var(--color-text-secondary)">
              {rel.label.slice(0, 12)}
            </text>
          </g>
        );
      })}
      {nodes.map((node) => {
        const pos = positions.get(node.name.toLowerCase())!;
        return (
          <g key={node.name}>
            <circle
              cx={pos.x}
              cy={pos.y}
              r="22"
              fill="var(--color-surface)"
              stroke="var(--color-accent)"
              strokeWidth="1.8"
            />
            <text
              x={pos.x}
              y={pos.y + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="var(--color-text-primary)"
            >
              {node.name.slice(0, 5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function GlossaryEntrySheet({
  entity,
  uptoSeq,
  onOpenCompanion,
  onClose,
}: {
  entity: CompanionEntity;
  uptoSeq: number;
  onOpenCompanion?(): void;
  onClose(): void;
}): JSX.Element {
  return (
    <Sheet
      title={`${CATEGORY_LABELS[entity.category]} · ${entity.name}`}
      size="compact"
      className="ai-assist-sheet"
      onClose={onClose}
      footer={onOpenCompanion ? <Button onClick={onOpenCompanion}>查看完整 AI 伴读</Button> : undefined}
    >
      <div className="ai-assist">
        <p className="ai-assist-hint">
          防剧透词典（截至第 {uptoSeq + 1} 章） · 首见第 {entity.firstSeenSeq + 1} 章 · 共出现 {entity.mentions} 章
        </p>
        {entity.aliases.length > 0 && (
          <p>
            <strong>别名 / 简称：</strong>
            {entity.aliases.join('、')}
          </p>
        )}
        {entity.role && (
          <p>
            <strong>定位 / 属性：</strong>
            {entity.role}
          </p>
        )}
        <p>{entity.note || '已出场'}</p>
        {entity.timeline.length > 1 && (
          <div>
            <strong>已读章节轨迹</strong>
            <ul>
              {entity.timeline.map((item, idx) => (
                <li key={idx}>
                  第 {item.seq + 1} 章：{item.note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Spoiler-free AI reading companion: 30-second recap, evolving character graph,
 * and an X-Ray style book glossary (characters, items, places, organizations, terms)
 * strictly bounded by `section_seq <= current`.
 */
export function AiCompanionSheet({
  load,
  onLoaded,
  onClose,
}: {
  load(windowSize: number): Promise<CompanionData>;
  onLoaded?(data: CompanionData): void;
  onClose(): void;
}): JSX.Element {
  const [tab, setTab] = useState<'recap' | 'graph' | 'glossary'>('recap');
  const [category, setCategory] = useState<'all' | CompanionEntityCategory>('all');
  const [query, setQuery] = useState('');
  const [windowSize, setWindowSize] = useState(8);
  const [data, setData] = useState<CompanionData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    void load(windowSize)
      .then((result) => {
        if (live) {
          setData(result);
          onLoaded?.(result);
        }
      })
      .catch((failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : 'AI 伴读加载失败');
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [load, windowSize]);

  const counts: Record<CompanionEntityCategory, number> = {
    character: 0,
    item: 0,
    place: 0,
    organization: 0,
    term: 0,
  };
  for (const entity of data?.entities ?? []) {
    counts[entity.category] = (counts[entity.category] ?? 0) + 1;
  }

  const needle = query.trim().toLowerCase();
  const glossaryItems = (data?.entities ?? []).filter((entity) => {
    if (category !== 'all' && entity.category !== category) return false;
    if (!needle) return true;
    return (
      entity.name.toLowerCase().includes(needle) ||
      entity.aliases.some((a) => a.toLowerCase().includes(needle)) ||
      entity.role.toLowerCase().includes(needle) ||
      entity.note.toLowerCase().includes(needle)
    );
  });

  return (
    <Sheet title="防剧透 AI 伴读" className="ai-assist-sheet" onClose={onClose}>
      <div className="ai-assist">
        {data && (
          <p className="ai-assist-hint">
            防剧透边界：截至第 {data.uptoSeq + 1} 章{data.chapterTitle ? `（${data.chapterTitle}）` : ''} · 已纳入{' '}
            {data.coveredChapters} 章记忆，绝不剧透未读章节。
          </p>
        )}
        <div className="ai-assist-actions">
          <Button aria-pressed={tab === 'recap'} onClick={() => setTab('recap')}>
            前情提要
          </Button>
          <Button aria-pressed={tab === 'graph'} onClick={() => setTab('graph')}>
            人物图谱
          </Button>
          <Button aria-pressed={tab === 'glossary'} onClick={() => setTab('glossary')}>
            书内词典{data ? `（${data.entities.length}）` : ''}
          </Button>
          {windowSize < 16 && (
            <Button disabled={busy} onClick={() => setWindowSize(16)}>
              回溯 16 章
            </Button>
          )}
        </div>
        {busy && (
          <p className="ai-assist-status" role="status">
            正在按已读进度提取与汇总（绝不读取未读章节）…
          </p>
        )}
        {error && (
          <p className="ai-assist-error" role="alert">
            {error}
          </p>
        )}
        {data && tab === 'recap' && (
          <article className="ai-assist-answer" aria-live="polite">
            <p>{data.recap || '当前进度范围内暂无可汇总的章节文本。'}</p>
            {data.openThreads.length > 0 && (
              <div>
                <strong>当前未解伏笔</strong>
                <ul>
                  {data.openThreads.map((thread, index) => (
                    <li key={index}>{thread}</li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        )}
        {data && tab === 'graph' && (
          <div className="ai-assist">
            <CharacterGraphSvg entities={data.entities} relations={data.relations} />
            {data.relations.length > 0 ? (
              <div>
                <strong>已揭示的关系演变</strong>
                <ul>
                  {data.relations.map((rel, index) => (
                    <li key={index}>
                      {rel.from} → {rel.to}：{rel.label}
                      {rel.history.length > 1
                        ? `（演变：${rel.history.map((h) => `第${h.seq + 1}章 ${h.label}`).join(' → ')}）`
                        : `（第 ${rel.firstSeenSeq + 1} 章）`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="ai-assist-hint">截至当前进度暂未提取到人物关系连线。</p>
            )}
          </div>
        )}
        {data && tab === 'glossary' && (
          <div className="ai-assist">
            <label className="sheet-field">
              <span>搜索人物、物品、地点、势力或术语</span>
              <input
                value={query}
                placeholder="输入名称、别名或关键词…"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <div className="ai-assist-actions">
              <Button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
                全部（{data.entities.length}）
              </Button>
              {CATEGORY_ORDER.map((cat) => (
                <Button key={cat} aria-pressed={category === cat} onClick={() => setCategory(cat)}>
                  {CATEGORY_LABELS[cat]}（{counts[cat]}）
                </Button>
              ))}
            </div>
            {glossaryItems.length > 0 ? (
              <ul>
                {glossaryItems.map((entity) => (
                  <li key={`${entity.category}:${entity.name}`}>
                    <strong>
                      [{CATEGORY_LABELS[entity.category]}] {entity.name}
                    </strong>
                    {entity.aliases.length > 0 ? `（别名：${entity.aliases.join(' / ')}）` : ''}
                    {entity.role ? ` · ${entity.role}` : ''}
                    <div>
                      {entity.note || '已出场'} · 首见第 {entity.firstSeenSeq + 1} 章（共出现 {entity.mentions} 章）
                    </div>
                    {entity.timeline.length > 1 && (
                      <small>
                        轨迹：{entity.timeline.map((t) => `第${t.seq + 1}章 ${t.note}`).join(' → ')}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ai-assist-hint">当前筛选条件下暂无词条。</p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
