/**
 * A minimal SVG path -> polyline converter.
 *
 * Only the commands this icon set actually uses: absolute and relative M, L, H, V,
 * C, Q, A and Z. Curves are flattened into short chords, because what happens next
 * is stroke expansion — which is a per-segment operation on straight edges, and
 * which cannot be applied to a curve without first deciding what "the stroke width
 * of a curve" means.
 */

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

export function pathToSubpaths(d) {
  const tokens = [];
  for (const match of d.matchAll(TOKEN)) tokens.push(match[1] ?? match[2]);

  const subpaths = [];
  let current = null;
  let cursor = [0, 0];
  let start = [0, 0];
  let command = '';
  let index = 0;

  const flush = () => {
    if (current && current.length >= 2) subpaths.push(current);
    current = null;
  };
  const next = () => Number(tokens[index++]);
  const add = (x, y) => {
    if (!current) current = [];
    current.push([x, y]);
  };

  while (index < tokens.length) {
    if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const ox = relative ? cursor[0] : 0;
    const oy = relative ? cursor[1] : 0;

    switch (upper) {
      case 'M': {
        flush();
        const x = next() + ox;
        const y = next() + oy;
        cursor = [x, y];
        start = [x, y];
        add(x, y);
        // Extra coordinate pairs after `M` are implicit `L`s.
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        const x = next() + ox;
        const y = next() + oy;
        // A `Z`-terminated subpath repeats its first point; that repeat is a
        // zero-length segment and only confuses the stroke expansion.
        if (current && current.length && x === cursor[0] && y === cursor[1]) {
          index -= 0;
        } else {
          add(x, y);
        }
        cursor = [x, y];
        break;
      }
      case 'H': {
        const x = next() + ox;
        add(x, cursor[1]);
        cursor = [x, cursor[1]];
        break;
      }
      case 'V': {
        const y = next() + oy;
        add(cursor[0], y);
        cursor = [cursor[0], y];
        break;
      }
      case 'C': {
        const points = [next() + ox, next() + oy, next() + ox, next() + oy, next() + ox, next() + oy];
        flattenCubic(current ?? [], cursor,
          [points[0], points[1]], [points[2], points[3]], [points[4], points[5]]);
        cursor = [points[4], points[5]];
        break;
      }
      case 'Q': {
        const points = [next() + ox, next() + oy, next() + ox, next() + oy];
        flattenQuadratic(current ?? [], cursor, [points[0], points[1]], [points[2], points[3]]);
        cursor = [points[2], points[3]];
        break;
      }
      case 'A': {
        const rx = next();
        const ry = next();
        const rotation = next();
        const large = next();
        const sweep = next();
        const x = next() + ox;
        const y = next() + oy;
        for (const point of flattenArc(cursor, [x, y], rx, ry, rotation, large, sweep)) {
          add(point[0], point[1]);
        }
        cursor = [x, y];
        break;
      }
      case 'Z': {
        flush();
        cursor = start;
        command = '';
        break;
      }
      default:
        index += 1;
    }
  }
  flush();
  return subpaths;
}

function flattenCubic(list, [x0, y0], [x1, y1], [x2, y2], [x3, y3]) {
  // Step count from the control polygon's length: a short curve does not need 16
  // chords, and a long one needs more than 8.
  const approx = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
  const steps = Math.max(4, Math.min(24, Math.ceil(approx / 1.5)));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    list.push([
      mt ** 3 * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x3,
      mt ** 3 * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y3,
    ]);
  }
}

function flattenQuadratic(list, [x0, y0], [x1, y1], [x2, y2]) {
  const approx = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(3, Math.min(16, Math.ceil(approx / 1.5)));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    list.push([
      mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
      mt * mt * y0 + 2 * mt * t * y1 + t * t * y2,
    ]);
  }
}

/** SVG elliptical-arc endpoint parameterisation, sampled. */
function flattenArc([x1, y1], [x2, y2], rx, ry, rotation, largeArc, sweep) {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const px = cos * dx + sin * dy;
  const py = -sin * dx + cos * dy;
  const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const numerator = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
  const denominator = rx * rx * py * py + ry * ry * px * px;
  const coefficient = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * py) / ry;
  const cyp = (-coefficient * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    const value = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -value : value;
  };
  const startAngle = angle(1, 0, (px - cxp) / rx, (py - cyp) / ry);
  let delta = angle((px - cxp) / rx, (py - cyp) / ry, (-px - cxp) / rx, (-py - cyp) / ry);
  if (delta < 0 && sweep) delta += 2 * Math.PI;
  if (delta > 0 && !sweep) delta -= 2 * Math.PI;

  const steps = Math.max(8, Math.ceil((Math.abs(delta) * Math.max(rx, ry)) / 0.8));
  const points = [];
  for (let s = 1; s <= steps; s++) {
    const t = startAngle + (delta * s) / steps;
    points.push([
      cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx,
      sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy,
    ]);
  }
  return points;
}
