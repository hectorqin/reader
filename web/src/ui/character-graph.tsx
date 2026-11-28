import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanionEntity, CompanionRelation } from './ai-companion.tsx';

interface NodePos {
  id: string;
  entity: CompanionEntity;
  x: number;
  y: number;
  r: number;
  paletteIndex: number;
}

const VIEW_W = 640;
const VIEW_H = 400;
const PAD = 54;

/** Theme-aligned soft palettes using the app's own semantic tokens (light & dark safe). */
const NODE_PALETTES = [
  { fill: 'var(--color-brand-soft)', stroke: 'var(--color-brand-text)', text: 'var(--color-brand-text)' },
  { fill: 'var(--color-ch-video-soft)', stroke: 'var(--color-ch-video-text)', text: 'var(--color-ch-video-text)' },
  { fill: 'var(--color-ch-music-soft)', stroke: 'var(--color-ch-music-text)', text: 'var(--color-ch-music-text)' },
  { fill: 'var(--color-ch-audio-soft)', stroke: 'var(--color-ch-audio-text)', text: 'var(--color-ch-audio-text)' },
] as const;

/**
 * Deterministic force-directed layout (Fruchterman-Reingold style) so related
 * characters cluster naturally, central protagonists sit near the middle, and
 * nodes never pile on top of one another.
 */
function computeForceLayout(
  entities: readonly CompanionEntity[],
  relations: readonly CompanionRelation[],
): NodePos[] {
  const characters = entities.filter((e) => e.category === 'character');
  const picked = (characters.length > 0 ? characters : entities).slice(0, 14);
  if (picked.length === 0) return [];

  const maxMentions = Math.max(1, ...picked.map((e) => e.mentions));
  const nodes: NodePos[] = picked.map((entity, idx) => {
    const ratio = entity.mentions / maxMentions;
    const r = Math.round(20 + ratio * 10);
    // Place the top character near center, others on golden-angle spiral for deterministic spread
    const angle = idx * 2.399963229728653;
    const dist = idx === 0 ? 0 : 75 + Math.sqrt(idx) * 44;
    return {
      id: entity.name.toLowerCase(),
      entity,
      x: VIEW_W / 2 + Math.cos(angle) * dist,
      y: VIEW_H / 2 + Math.sin(angle) * dist * 0.72,
      r,
      paletteIndex: idx % NODE_PALETTES.length,
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = relations
    .map((rel) => ({ a: byId.get(rel.from.toLowerCase()), b: byId.get(rel.to.toLowerCase()) }))
    .filter((e): e is { a: NodePos; b: NodePos } => !!e.a && !!e.b && e.a !== e.b);

  const area = VIEW_W * VIEW_H;
  const k = Math.sqrt(area / Math.max(2, nodes.length)) * 0.62;
  const iterations = 120;

  for (let iter = 0; iter < iterations; iter += 1) {
    const temp = (1 - iter / iterations) * 28 + 1.5;
    const dx = new Float64Array(nodes.length);
    const dy = new Float64Array(nodes.length);

    // Pairwise repulsion
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let vx = a.x - b.x;
        let vy = a.y - b.y;
        let dist = Math.hypot(vx, vy);
        if (dist < 1) {
          vx = (i - j) * 0.5 || 1;
          vy = 0.5;
          dist = Math.hypot(vx, vy);
        }
        const minDist = a.r + b.r + 44;
        const repulse = (k * k) / dist + (dist < minDist ? (minDist - dist) * 3.5 : 0);
        const fx = (vx / dist) * repulse;
        const fy = (vy / dist) * repulse;
        dx[i] = dx[i]! + fx;
        dy[i] = dy[i]! + fy;
        dx[j] = dx[j]! - fx;
        dy[j] = dy[j]! - fy;
      }
    }

    // Spring attraction along edges
    for (const { a, b } of edges) {
      const i = nodes.indexOf(a);
      const j = nodes.indexOf(b);
      const vx = a.x - b.x;
      const vy = a.y - b.y;
      const dist = Math.max(1, Math.hypot(vx, vy));
      const ideal = Math.max(125, a.r + b.r + 75);
      const attract = ((dist - ideal) * dist) / (k * 2.2);
      const fx = (vx / dist) * attract;
      const fy = (vy / dist) * attract;
      dx[i] = dx[i]! - fx;
      dy[i] = dy[i]! - fy;
      dx[j] = dx[j]! + fx;
      dy[j] = dy[j]! + fy;
    }

    // Gentle center gravity + apply step
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i]!;
      const gx = (VIEW_W / 2 - n.x) * 0.08;
      const gy = (VIEW_H / 2 - n.y) * 0.1;
      const mx = dx[i]! + gx;
      const my = dy[i]! + gy;
      const mag = Math.hypot(mx, my);
      if (mag > 0) {
        const step = Math.min(mag, temp);
        n.x += (mx / mag) * step;
        n.y += (my / mag) * step;
      }
      n.x = Math.min(VIEW_W - PAD, Math.max(PAD, n.x));
      n.y = Math.min(VIEW_H - PAD, Math.max(PAD, n.y));
    }
  }

  return nodes;
}

export function CharacterRelationshipGraph({
  entities,
  relations,
}: {
  entities: CompanionEntity[];
  relations: CompanionRelation[];
}): JSX.Element | null {
  const initialNodes = useMemo(() => computeForceLayout(entities, relations), [entities, relations]);
  const [nodes, setNodes] = useState<NodePos[]>(initialNodes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<{ id: string; moved: boolean } | null>(null);

  useEffect(() => {
    setNodes(initialNodes);
    setSelectedId(null);
    setZoom(1);
  }, [initialNodes]);

  if (nodes.length === 0) return null;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visibleEdges = relations
    .map((rel, idx) => {
      const from = nodeMap.get(rel.from.toLowerCase());
      const to = nodeMap.get(rel.to.toLowerCase());
      return from && to && from.id !== to.id ? { rel, from, to, key: `${from.id}->${to.id}-${idx}` } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  // Detect reverse pairs so A->B and B->A curve away from each other cleanly
  const edgePairKeys = new Set(visibleEdges.map((e) => `${e.from.id}->${e.to.id}`));

  const connectedIds = new Set<string>();
  if (selectedId) {
    connectedIds.add(selectedId);
    for (const edge of visibleEdges) {
      if (edge.from.id === selectedId || edge.to.id === selectedId) {
        connectedIds.add(edge.from.id);
        connectedIds.add(edge.to.id);
      }
    }
  }

  const clientToSvg = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const vw = VIEW_W / zoom;
    const vh = VIEW_H / zoom;
    const vx = (VIEW_W - vw) / 2;
    const vy = (VIEW_H - vh) / 2;
    return {
      x: vx + ((clientX - rect.left) / rect.width) * vw,
      y: vy + ((clientY - rect.top) / rect.height) * vh,
    };
  };

  const selectedNode = selectedId ? nodeMap.get(selectedId) ?? null : null;
  const selectedRelations = selectedId
    ? relations.filter((r) => r.from.toLowerCase() === selectedId || r.to.toLowerCase() === selectedId)
    : [];

  const vw = VIEW_W / zoom;
  const vh = VIEW_H / zoom;
  const viewBox = `${(VIEW_W - vw) / 2} ${(VIEW_H - vh) / 2} ${vw} ${vh}`;

  return (
    <div className="ai-graph-shell">
      <div className="ai-graph-canvas-wrap">
        <div className="ai-graph-controls" aria-label="图谱缩放控制">
          <button
            type="button"
            className="ai-graph-ctrl"
            aria-label="放大图谱"
            onClick={() => setZoom((z) => Math.min(2, Number((z + 0.2).toFixed(2))))}
          >
            +
          </button>
          <button
            type="button"
            className="ai-graph-ctrl"
            aria-label="缩小图谱"
            onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.2).toFixed(2))))}
          >
            −
          </button>
          <button
            type="button"
            className="ai-graph-ctrl"
            aria-label="重置视图"
            onClick={() => {
              setNodes(initialNodes);
              setSelectedId(null);
              setZoom(1);
            }}
          >
            重置
          </button>
        </div>

        <svg
          ref={svgRef}
          className="ai-graph-svg"
          viewBox={viewBox}
          role="img"
          aria-label="人物关系图谱"
          onPointerMove={(event) => {
            if (!dragging.current) return;
            const pt = clientToSvg(event.clientX, event.clientY);
            if (!pt) return;
            dragging.current.moved = true;
            const dragId = dragging.current.id;
            setNodes((prev) =>
              prev.map((n) =>
                n.id === dragId
                  ? { ...n, x: Math.min(VIEW_W - 28, Math.max(28, pt.x)), y: Math.min(VIEW_H - 28, Math.max(28, pt.y)) }
                  : n,
              ),
            );
          }}
          onPointerUp={() => {
            dragging.current = null;
          }}
          onPointerLeave={() => {
            dragging.current = null;
          }}
          onClick={() => setSelectedId(null)}
        >
          <defs>
            <pattern id="ai-graph-dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="var(--color-line)" />
            </pattern>
            <marker
              id="ai-graph-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--color-muted)" />
            </marker>
            <marker
              id="ai-graph-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--color-brand-text)" />
            </marker>
            <filter id="ai-graph-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodOpacity="0.12" />
            </filter>
          </defs>

          <rect x={-VIEW_W} y={-VIEW_H} width={VIEW_W * 3} height={VIEW_H * 3} fill="url(#ai-graph-dots)" />

          {visibleEdges.map(({ rel, from, to, key }) => {
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dist = Math.max(1, Math.hypot(dx, dy));
            const ux = dx / dist;
            const uy = dy / dist;
            // Perpendicular normal for curve offset
            const nx = -uy;
            const ny = ux;
            const hasReverse = edgePairKeys.has(`${to.id}->${from.id}`);
            const curve = hasReverse ? 28 : 14;

            const startX = from.x + ux * (from.r + 3);
            const startY = from.y + uy * (from.r + 3);
            const endX = to.x - ux * (to.r + 7);
            const endY = to.y - uy * (to.r + 7);
            const ctrlX = (startX + endX) / 2 + nx * curve;
            const ctrlY = (startY + endY) / 2 + ny * curve;
            // Quadratic bezier midpoint at t=0.5
            const labelX = 0.25 * startX + 0.5 * ctrlX + 0.25 * endX;
            const labelY = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY;

            const active = selectedId ? from.id === selectedId || to.id === selectedId : false;
            const dimmed = selectedId !== null && !active;
            const label = rel.label.length > 8 ? `${rel.label.slice(0, 7)}…` : rel.label;
            const pillW = Math.max(38, label.length * 10.5 + 14);

            return (
              <g key={key} className="ai-graph-edge" style={{ opacity: dimmed ? 0.16 : 1 }}>
                <path
                  d={`M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`}
                  fill="none"
                  stroke={active ? 'var(--color-brand-text)' : 'var(--color-muted)'}
                  strokeWidth={active ? 2.2 : 1.4}
                  strokeOpacity={active ? 0.95 : 0.55}
                  markerEnd={active ? 'url(#ai-graph-arrow-active)' : 'url(#ai-graph-arrow)'}
                />
                <g transform={`translate(${labelX}, ${labelY})`}>
                  <rect
                    x={-pillW / 2}
                    y={-10}
                    width={pillW}
                    height={20}
                    rx={10}
                    fill="var(--color-surface)"
                    stroke={active ? 'var(--color-brand-text)' : 'var(--color-line)'}
                    strokeWidth={active ? 1.2 : 1}
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight={active ? '600' : '500'}
                    fill={active ? 'var(--color-brand-text)' : 'var(--color-muted)'}
                  >
                    {label}
                  </text>
                </g>
              </g>
            );
          })}

          {nodes.map((node) => {
            const palette = NODE_PALETTES[node.paletteIndex]!;
            const isSelected = selectedId === node.id;
            const dimmed = selectedId !== null && !connectedIds.has(node.id);
            const shortName = node.entity.name.length > 5 ? `${node.entity.name.slice(0, 4)}…` : node.entity.name;

            return (
              <g
                key={node.id}
                className="ai-graph-node"
                transform={`translate(${node.x}, ${node.y})`}
                style={{ opacity: dimmed ? 0.22 : 1, cursor: 'grab' }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  (event.currentTarget as SVGGElement).setPointerCapture?.(event.pointerId);
                  dragging.current = { id: node.id, moved: false };
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (dragging.current?.moved) return;
                  setSelectedId((prev) => (prev === node.id ? null : node.id));
                }}
              >
                {isSelected && (
                  <circle
                    r={node.r + 6}
                    fill="none"
                    stroke="var(--color-brand-text)"
                    strokeWidth="2"
                    strokeDasharray="4 3"
                  />
                )}
                <circle
                  r={node.r}
                  fill={palette.fill}
                  stroke={isSelected ? 'var(--color-brand-text)' : palette.stroke}
                  strokeWidth={isSelected ? 2.4 : 1.6}
                  filter="url(#ai-graph-shadow)"
                />
                <text
                  y={4}
                  textAnchor="middle"
                  fontSize={node.r >= 26 ? '12.5' : '11.5'}
                  fontWeight="600"
                  fill={palette.text}
                >
                  {shortName}
                </text>
                {node.entity.role && (
                  <text
                    y={node.r + 14}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--color-muted)"
                  >
                    {node.entity.role.length > 8 ? `${node.entity.role.slice(0, 7)}…` : node.entity.role}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <p className="ai-graph-tip">点击人物聚焦关系 · 拖拽节点调整布局</p>
      </div>

      {selectedNode && (
        <div className="ai-companion-card is-focused" role="region" aria-label={`人物详情：${selectedNode.entity.name}`}>
          <div className="ai-companion-card-head">
            <strong>{selectedNode.entity.name}</strong>
            {selectedNode.entity.role && <span className="ai-companion-badge">{selectedNode.entity.role}</span>}
            <span className="ai-companion-meta">
              首见第 {selectedNode.entity.firstSeenSeq + 1} 章 · 出现 {selectedNode.entity.mentions} 章
            </span>
          </div>
          {selectedNode.entity.aliases.length > 0 && (
            <p className="ai-companion-sub">别名：{selectedNode.entity.aliases.join(' / ')}</p>
          )}
          <p className="ai-companion-body">{selectedNode.entity.note || '已出场'}</p>
          {selectedRelations.length > 0 && (
            <div className="ai-companion-rel-list">
              {selectedRelations.map((rel, idx) => (
                <span className="ai-companion-rel-chip" key={idx}>
                  {rel.from} → {rel.to}：{rel.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
