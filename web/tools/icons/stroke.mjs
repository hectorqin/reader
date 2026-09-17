/**
 * Stroke expansion.
 *
 * The set is authored as stroked polylines, and a font renders filled outlines. The
 * bridge is to give each segment its own closed ring — a rectangle with a
 * semicircular cap at each end — and let a boolean union merge the rings.
 *
 * Rounding both ends the same way is what makes a polyline read as one continuous
 * stroke: square ends leave the two halves of an arc visibly separate, and mitred
 * joins put a spike on the outside of every bend at small sizes.
 *
 * The winding is the part that is easy to get subtly wrong. The ring has to travel
 * *out along one side of the segment and back along the other*, turning through the
 * head and the tail; if both caps sweep the same way the ring self-intersects and the
 * union returns two half-shapes instead of one bar.
 */

/** Cap sampling: a semicircle in 8 chords is well under one font unit of error. */
const CAP_STEPS = 8;

/**
 * One segment's outline as a closed ring, or `null` for a zero-length segment.
 *
 * Coordinates are in the same units as the input; the caller scales.
 */
export function segmentPolygon(x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;

  const radius = width / 2;
  const direction = Math.atan2(dy, dx);

  const ring = [];
  /*
   * Start cap: sweep from the side at `direction + 90°` round through the tail
   * (`direction + 180°`) to the side at `direction + 270°`. In a y-down coordinate
   * system that is half a turn, and it ends where the second cap will begin.
   */
  for (let i = 0; i <= CAP_STEPS; i++) {
    const t = direction + Math.PI / 2 + (Math.PI * i) / CAP_STEPS;
    ring.push([x1 + Math.cos(t) * radius, y1 + Math.sin(t) * radius]);
  }
  /*
   * End cap: the other half turn, starting at `direction - 90°` so it continues from
   * the first cap's last point and closes back onto its first.
   */
  for (let i = 0; i <= CAP_STEPS; i++) {
    const t = direction - Math.PI / 2 + (Math.PI * i) / CAP_STEPS;
    ring.push([x2 + Math.cos(t) * radius, y2 + Math.sin(t) * radius]);
  }
  return close(ring);
}

/**
 * Removes consecutive duplicates and the explicit closing point.
 *
 * Clipper treats a repeated first/last vertex as a degenerate edge, and degenerate
 * edges are reported as "unable to complete output ring".
 */
function close(ring) {
  const out = [];
  for (const point of ring) {
    const previous = out[out.length - 1];
    if (previous && Math.abs(previous[0] - point[0]) < 1e-9 && Math.abs(previous[1] - point[1]) < 1e-9) {
      continue;
    }
    out.push([+point[0].toFixed(4), +point[1].toFixed(4)]);
  }
  return out.length >= 3 ? out : null;
}
