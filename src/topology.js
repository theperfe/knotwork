// Crossing counts of planar projections. A closed loop is certainly the unknot
// if some projection of it has zero crossings, so "solved" = we can find a
// viewing direction in which no strand crosses another.

function basis(d) {
  const [x, y, z] = d;
  const a = Math.abs(x) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let e1 = [y * a[2] - z * a[1], z * a[0] - x * a[2], x * a[1] - y * a[0]];
  const l = Math.hypot(...e1); e1 = e1.map(v => v / l);
  const e2 = [y * e1[2] - z * e1[1], z * e1[0] - x * e1[2], x * e1[1] - y * e1[0]];
  return [e1, e2];
}

export function crossings(p, n, dir, cap = Infinity) {
  const [e1, e2] = basis(dir);
  const u = new Float32Array(n), v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    u[i] = x * e1[0] + y * e1[1] + z * e1[2];
    v[i] = x * e2[0] + y * e2[1] + z * e2[2];
  }
  // bounding boxes per segment for a cheap reject
  let count = 0;
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    const ax = u[i], ay = v[i], bx = u[i1], by = v[i1];
    const minx = Math.min(ax, bx), maxx = Math.max(ax, bx), miny = Math.min(ay, by), maxy = Math.max(ay, by);
    for (let j = i + 2; j < n; j++) {
      const j1 = (j + 1) % n;
      if (j1 === i) continue;
      const cx = u[j], cy = v[j], dx = u[j1], dy = v[j1];
      if (Math.max(cx, dx) < minx || Math.min(cx, dx) > maxx || Math.max(cy, dy) < miny || Math.min(cy, dy) > maxy) continue;
      const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      if ((d1 > 0) === (d2 > 0)) continue;
      const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if ((d3 > 0) === (d4 > 0)) continue;
      if (++count >= cap) return count;
    }
  }
  return count;
}

// Normal of the best-fit plane (smallest principal axis): the most likely
// direction for a zero-crossing view of a nearly-flat loop.
export function planeNormal(p, n) {
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const x = p[i * 3] - cx, y = p[i * 3 + 1] - cy, z = p[i * 3 + 2] - cz;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  const tr = xx + yy + zz;
  // power iteration on (tr·I − C) finds the eigenvector of C's smallest eigenvalue
  let v = [0.3, 0.8, 0.5];
  for (let k = 0; k < 30; k++) {
    const a = [(tr - xx) * v[0] - xy * v[1] - xz * v[2], -xy * v[0] + (tr - yy) * v[1] - yz * v[2], -xz * v[0] - yz * v[1] + (tr - zz) * v[2]];
    const l = Math.hypot(...a) || 1; v = a.map(q => q / l);
  }
  return v;
}

// Fibonacci-sphere hemisphere directions
export const DIRS = (() => {
  const out = [], N = 24;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) / N; const r = Math.sqrt(1 - y * y), th = i * 2.399963;
    out.push([r * Math.cos(th), y, r * Math.sin(th)]);
  }
  return out;
})();

// Incremental tracker: checks a few directions per frame and reports the
// lowest crossing count seen across a full sweep.
export class TangleTracker {
  constructor() { this.k = 0; this.sweep = []; this.best = Infinity; this.bestDir = [0, 1, 0]; this.current = Infinity; }
  update(p, n, perFrame = 3) {
    // always test the best-fit plane normal; it is what a flat loop looks like
    const pn = planeNormal(p, n);
    const c0 = crossings(p, n, pn);
    this.sweep.push([c0, pn]);
    for (let q = 0; q < perFrame; q++) {
      const d = DIRS[this.k++ % DIRS.length];
      this.sweep.push([crossings(p, n, d), d]);
    }
    if (this.sweep.length >= DIRS.length + 8) this.sweep.splice(0, this.sweep.length - (DIRS.length + 8));
    let best = Infinity, bd = pn;
    for (const [c, d] of this.sweep) if (c < best) { best = c; bd = d; }
    this.best = best; this.bestDir = bd; this.current = c0;
    return { best, planar: c0, dir: bd };
  }
  // exhaustive count (used once at puzzle creation)
  static minCrossings(p, n) {
    let best = crossings(p, n, planeNormal(p, n));
    for (const d of DIRS) best = Math.min(best, crossings(p, n, d, best));
    return best;
  }
}
