import { type JSX, useEffect, useRef, useState } from 'react';
import { Sheet } from './sheet.tsx';
import { Button } from './toolkit.tsx';
import { CharacterRelationshipGraph } from './character-graph.tsx';

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
  uncachedChapters?: number;
  hasMoreBackfill?: boolean;
  newlyExtracted: number;
  recap: string;
  recapCached: boolean;
  entities: CompanionEntity[];
  relations: CompanionRelation[];
  openThreads: string[];
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
const BACKFILL_BATCH = 8;
const MAX_AUTO_BACKFILL_BATCHES = 64;

export function AiCompanionSheet({
  load,
  onLoaded,
  onClose,
}: {
  load(options: { window: number; backfill?: boolean; generateRecap?: boolean }): Promise<CompanionData>;
  onLoaded?(data: CompanionData): void;
  onClose(): void;
}): JSX.Element {
  const [tab, setTab] = useState<'recap' | 'graph' | 'glossary'>('recap');
  const [category, setCategory] = useState<'all' | CompanionEntityCategory>('all');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<CompanionData | null>(null);
  const [busy, setBusy] = useState(true);
  const [backfillMode, setBackfillMode] = useState<'idle' | 'single' | 'all'>('idle');
  const [error, setError] = useState('');
  const cancelBackfillRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    cancelBackfillRef.current = false;
    let live = true;
    setBusy(true);
    setError('');
    void load({ window: BACKFILL_BATCH })
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
      mountedRef.current = false;
      cancelBackfillRef.current = true;
    };
  }, [load]);

  const backfilling = backfillMode !== 'idle';

  const runBackfill = async (mode: 'single' | 'all') => {
    if (busy || backfilling) return;
    cancelBackfillRef.current = false;
    setBackfillMode(mode);
    setError('');
    const maxRounds = mode === 'all' ? MAX_AUTO_BACKFILL_BATCHES : 1;
    try {
      for (let round = 0; round < maxRounds; round += 1) {
        if (cancelBackfillRef.current || !mountedRef.current) break;
        const result = await load({ window: BACKFILL_BATCH, backfill: true, generateRecap: false });
        if (!mountedRef.current) break;
        setData((prev) => ({
          ...result,
          recap: result.recap || prev?.recap || '',
        }));
        onLoaded?.(result);
        const rem = Math.max(0, result.uncachedChapters ?? result.uptoSeq + 1 - result.coveredChapters);
        const hasMore = (result.hasMoreBackfill ?? rem > 0) && rem > 0;
        if (!hasMore || result.newlyExtracted === 0) break;
      }
    } catch (failure: unknown) {
      if (mountedRef.current) {
        setError(failure instanceof Error ? failure.message : '补提更早章节失败');
      }
    } finally {
      if (mountedRef.current) setBackfillMode('idle');
    }
  };

  const stopBackfill = () => {
    cancelBackfillRef.current = true;
  };

  const remainingUncached = data ? Math.max(0, data.uncachedChapters ?? data.uptoSeq + 1 - data.coveredChapters) : 0;
  const canBackfill = Boolean(data && (data.hasMoreBackfill ?? remainingUncached > 0) && remainingUncached > 0);

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
            防剧透边界：截至第 {data.uptoSeq + 1} 章{data.chapterTitle ? `（${data.chapterTitle}）` : ''} · 已缓存{' '}
            {data.coveredChapters}/{data.uptoSeq + 1} 章记忆（自动复用缓存，绝不剧透未读章节）。
          </p>
        )}
        <div className="ai-companion-tabs" role="tablist" aria-label="AI 伴读视图">
          <button
            type="button"
            role="tab"
            className={tab === 'recap' ? 'ai-companion-tab is-active' : 'ai-companion-tab'}
            aria-selected={tab === 'recap'}
            onClick={() => setTab('recap')}
          >
            前情提要
          </button>
          <button
            type="button"
            role="tab"
            className={tab === 'graph' ? 'ai-companion-tab is-active' : 'ai-companion-tab'}
            aria-selected={tab === 'graph'}
            onClick={() => setTab('graph')}
          >
            人物图谱
          </button>
          <button
            type="button"
            role="tab"
            className={tab === 'glossary' ? 'ai-companion-tab is-active' : 'ai-companion-tab'}
            aria-selected={tab === 'glossary'}
            onClick={() => setTab('glossary')}
          >
            书内词典{data ? ` (${data.entities.length})` : ''}
          </button>
        </div>
        {(canBackfill || backfillMode === 'all') && (
          <div className="ai-companion-toolbar">
            {backfillMode === 'all' ? (
              <Button onClick={stopBackfill}>停止补全（已缓存 {data?.coveredChapters ?? 0} 章）</Button>
            ) : (
              <>
                <Button disabled={busy || backfilling} onClick={() => void runBackfill('single')}>
                  {backfilling
                    ? '正在按批补提…'
                    : remainingUncached <= BACKFILL_BATCH
                      ? `补提剩余 ${remainingUncached} 章`
                      : `补提 ${BACKFILL_BATCH} 章`}
                </Button>
                {remainingUncached > BACKFILL_BATCH && (
                  <Button disabled={busy || backfilling} onClick={() => void runBackfill('all')}>
                    一键补全（剩余 {remainingUncached} 章）
                  </Button>
                )}
              </>
            )}
          </div>
        )}
        {(busy || backfilling) && (
          <p className="ai-assist-status" role="status">
            {backfillMode === 'all' && data
              ? `正在一键分批补全更早未缓存章节（已缓存 ${data.coveredChapters}/${data.uptoSeq + 1} 章，剩余 ${remainingUncached} 章）…`
              : backfilling
                ? '正在按批补提更早未缓存章节，已缓存章节自动复用…'
                : '正在按已读进度提取与汇总（绝不读取未读章节）…'}
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
              <div className="ai-companion-card">
                <div className="ai-companion-card-head">
                  <strong>当前未解伏笔</strong>
                </div>
                <ul className="ai-companion-threads">
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
            <CharacterRelationshipGraph entities={data.entities} relations={data.relations} />
            {data.relations.length > 0 ? (
              <div className="ai-companion-cards">
                {data.relations.map((rel, index) => (
                  <div className="ai-companion-card" key={index}>
                    <div className="ai-companion-card-head">
                      <strong>
                        {rel.from} → {rel.to}
                      </strong>
                      <span className="ai-companion-badge">{rel.label}</span>
                    </div>
                    <p className="ai-companion-meta">
                      {rel.history.length > 1
                        ? `关系演变：${rel.history.map((h) => `第 ${h.seq + 1} 章 ${h.label}`).join(' → ')}`
                        : `首次揭示于第 ${rel.firstSeenSeq + 1} 章`}
                    </p>
                  </div>
                ))}
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
            <div className="ai-glossary-pills">
              <button
                type="button"
                className={category === 'all' ? 'ai-glossary-pill is-active' : 'ai-glossary-pill'}
                onClick={() => setCategory('all')}
              >
                全部 ({data.entities.length})
              </button>
              {CATEGORY_ORDER.map((cat) => (
                <button
                  type="button"
                  key={cat}
                  className={category === cat ? 'ai-glossary-pill is-active' : 'ai-glossary-pill'}
                  onClick={() => setCategory(cat)}
                >
                  {CATEGORY_LABELS[cat]} ({counts[cat]})
                </button>
              ))}
            </div>
            {glossaryItems.length > 0 ? (
              <div className="ai-companion-cards">
                {glossaryItems.map((entity) => (
                  <div className="ai-companion-card" key={`${entity.category}:${entity.name}`}>
                    <div className="ai-companion-card-head">
                      <span className="ai-companion-badge" data-category={entity.category}>
                        {CATEGORY_LABELS[entity.category]}
                      </span>
                      <strong>{entity.name}</strong>
                      {entity.role && <span className="ai-companion-meta">{entity.role}</span>}
                    </div>
                    {entity.aliases.length > 0 && (
                      <p className="ai-companion-sub">别名：{entity.aliases.join(' / ')}</p>
                    )}
                    <p className="ai-companion-body">{entity.note || '已出场'}</p>
                    <p className="ai-companion-meta">
                      首见第 {entity.firstSeenSeq + 1} 章 · 共出现 {entity.mentions} 章
                    </p>
                    {entity.timeline.length > 1 && (
                      <p className="ai-companion-timeline">
                        轨迹：{entity.timeline.map((t) => `第 ${t.seq + 1} 章 ${t.note}`).join(' → ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="ai-assist-hint">当前筛选条件下暂无词条。</p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
