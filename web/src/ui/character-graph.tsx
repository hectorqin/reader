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
 * Deterministic concentric + gentle force layout with guaranteed collision
 * separation and viewport fit. Prevents nodes from collapsing onto a line or
 * piling up on the canvas edges regardless of graph density (2..14 characters).
 */
export function computeForceLayout(
  entities: readonly CompanionEntity[],
  relations: readonly CompanionRelation[],
): NodePos[] {
  const characters = entities.filter((e) => e.category === 'character');
  const picked = (characters.length > 0 ? characters : entities).slice(0, 14);
  if (picked.length === 0) return [];

  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;

  // Rank by degree + mentions so the most connected protagonist anchors the center
  const degree = new Map<string, number>();
  for (const rel of relations) {
    const f = rel.from.toLowerCase();
    const t = rel.to.toLowerCase();
    degree.set(f, (degree.get(f) ?? 0) + 1);
    degree.set(t, (degree.get(t) ?? 0) + 1);
  }
  const ranked = [...picked].sort((a, b) => {
    const scoreA = (degree.get(a.name.toLowerCase()) ?? 0) * 3 + a.mentions;
    const scoreB = (degree.get(b.name.toLowerCase()) ?? 0) * 3 + b.mentions;
    return scoreB - scoreA || a.firstSeenSeq - b.firstSeenSeq;
  });

  const maxMentions = Math.max(1, ...ranked.map((e) => e.mentions));
  const nodes: NodePos[] = ranked.map((entity, idx) => {
    const ratio = entity.mentions / maxMentions;
    const r = Math.round(20 + ratio * 9);
    let x = cx;
    let y = cy;

    if (ranked.length === 1) {
      x = cx;
      y = cy;
    } else if (ranked.length === 2) {
      x = cx + (idx === 0 ? -120 : 120);
      y = cy;
    } else if (ranked.length <= 4) {
      // Clean triangle or diamond around center — never collinear
      const angle = -Math.PI / 2 + (idx / ranked.length) * Math.PI * 2;
      x = cx + Math.cos(angle) * 155;
      y = cy + Math.sin(angle) * 105;
    } else if (idx === 0) {
      // Central protagonist
      x = cx;
      y = cy;
    } else {
      // Concentric rings: inner ring up to 6 nodes, outer ring for the rest
      const others = ranked.length - 1;
      const innerCount = Math.min(6, others);
      if (idx <= innerCount) {
        const angle = -Math.PI / 2 + ((idx - 1) / innerCount) * Math.PI * 2;
        const rx = others <= 6 ? 190 : 145;
        const ry = others <= 6 ? 120 : 92;
        x = cx + Math.cos(angle) * rx;
        y = cy + Math.sin(angle) * ry;
      } else {
        const outerCount = others - innerCount;
        const outerIdx = idx - innerCount - 1;
        // Stagger outer ring angles so they sit between inner ring rays
        const angle = -Math.PI / 2 + ((outerIdx + 0.5) / outerCount) * Math.PI * 2;
        x = cx + Math.cos(angle) * 245;
        y = cy + Math.sin(angle) * 145;
      }
    }

    return {
      id: entity.name.toLowerCase(),
      entity,
      x,
      y,
      r,
      paletteIndex: idx % NODE_PALETTES.length,
    };
  });

  if (nodes.length <= 2) return nodes;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = relations
    .map((rel) => ({ a: byId.get(rel.from.toLowerCase()), b: byId.get(rel.to.toLowerCase()) }))
    .filter((e): e is { a: NodePos; b: NodePos } => !!e.a && !!e.b && e.a !== e.b);

  // Gentle spring refinement + local collision avoidance (bounded, never blasts to walls)
  const iterations = 60;
  for (let iter = 0; iter < iterations; iter += 1) {
    const cooling = 1 - iter / iterations;
    const dx = new Float64Array(nodes.length);
    const dy = new Float64Array(nodes.length);

    // 1. Short-range pairwise separation (only pushes when nodes are too close)
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let vx = a.x - b.x;
        let vy = a.y - b.y;
        let dist = Math.hypot(vx, vy);
        if (dist < 0.5) {
          const angle = ((i * 7 + j * 13) % 12) * (Math.PI / 6);
          vx = Math.cos(angle);
          vy = Math.sin(angle);
          dist = 1;
        }
        const minGap = a.r + b.r + 68;
        if (dist < minGap) {
          const push = (minGap - dist) * 0.35;
          const fx = (vx / dist) * push;
          const fy = (vy / dist) * push;
          dx[i] = dx[i]! + fx;
          dy[i] = dy[i]! + fy;
          dx[j] = dx[j]! - fx;
          dy[j] = dy[j]! - fy;
        }
      }
    }

    // 2. Gentle spring along edges toward an ideal readable length
    for (const { a, b } of edges) {
      const i = nodes.indexOf(a);
      const j = nodes.indexOf(b);
      const vx = a.x - b.x;
      const vy = a.y - b.y;
      const dist = Math.max(1, Math.hypot(vx, vy));
      const ideal = Math.max(135, a.r + b.r + 82);
      const pull = (dist - ideal) * 0.04;
      const fx = (vx / dist) * pull;
      const fy = (vy / dist) * pull;
      dx[i] = dx[i]! - fx;
      dy[i] = dy[i]! - fy;
      dx[j] = dx[j]! + fx;
      dy[j] = dy[j]! + fy;
    }

    // 3. Soft center gravity + apply damped step
    const maxStep = 10 * cooling + 1;
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i]!;
      const mx = dx[i]! + (cx - n.x) * 0.015;
      const my = dy[i]! + (cy - n.y) * 0.02;
      const mag = Math.hypot(mx, my);
      if (mag > 0) {
        const step = Math.min(mag, maxStep);
        n.x += (mx / mag) * step;
        n.y += (my / mag) * step;
      }
    }
  }

  // 4. Normalize bounding box smoothly into the safe viewport so nodes never hug walls
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const availW = VIEW_W - PAD * 2;
  const availH = VIEW_H - PAD * 2;
  const scale = Math.min(1, availW / spanX, availH / spanY);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  for (const n of nodes) {
    n.x = cx + (n.x - midX) * scale;
    n.y = cy + (n.y - midY) * scale;
  }

  // 5. Final hard non-overlap pass within safe canvas bounds
  for (let pass = 0; pass < 20; pass += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let vx = a.x - b.x;
        let vy = a.y - b.y;
        let dist = Math.hypot(vx, vy);
        const minDist = a.r + b.r + 36;
        if (dist < minDist) {
          if (dist < 0.5) {
            vx = Math.cos(i + j);
            vy = Math.sin(i + j);
            dist = 1;
          }
          const delta = (minDist - dist) / 2;
          const ox = (vx / dist) * delta;
          const oy = (vy / dist) * delta;
          a.x = Math.min(VIEW_W - PAD, Math.max(PAD, a.x + ox));
          a.y = Math.min(VIEW_H - PAD, Math.max(PAD, a.y + oy));
          b.x = Math.min(VIEW_W - PAD, Math.max(PAD, b.x - ox));
          b.y = Math.min(VIEW_H - PAD, Math.max(PAD, b.y - oy));
          moved = true;
        }
      }
    }
    if (!moved) break;
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
