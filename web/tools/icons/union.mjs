/**
 * Exact polygon union via Clipper.
 *
 * Clipper rather than a hand-rolled boolean because the input is adversarial for
 * naive clipping: a stroked polyline is a chain of shapes that meet at exactly one
 * endpoint each, so consecutive pieces touch at a single point and frequently share
 * collinear edges. That is the case a simple sweep-line reports as "unable to
 * complete output ring"; Clipper handles touching and collinear input by
 * construction.
 *
 * Two details are load-bearing:
 *
 *  - Clipper works in **integers**. Coordinates are scaled up before clipping and
 *    down after. Clipping in floats and rounding the output is what leaves rings
 *    that do not close.
 *  - The result is read from a **PolyTree**, not a flat path list, because a tree
 *    says which rings are holes and which are outers. A flat list leaves that to be
 *    guessed from winding, and a guessed hole renders solid.
 */

import ClipperLib from 'clipper-lib';

const SCALE = 1e6;

export function unionPolygons(rings) {
  const clipper = new ClipperLib.Clipper();
  const paths = rings.map((ring) => ring.map(([x, y]) => ({
    X: Math.round(x * SCALE),
    Y: Math.round(y * SCALE),
  })));
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const solution = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    // `pftNonZero` unions rings wound consistently; `pftEvenOdd` would subtract
    // every overlap instead, which is the opposite of what a stroke union means.
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return readTree(solution);
}

/** PolyTree -> [{ ring, depth }], depth 0 being an outer boundary. */
function readTree(tree) {
  const out = [];
  const walk = (node, depth) => {
    for (const child of node.Childs()) {
      const ring = child.Contour().map((point) => [point.X / SCALE, point.Y / SCALE]);
      if (ring.length >= 3) out.push({ ring, depth });
      walk(child, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}
