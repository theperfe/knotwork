// Closed-loop rope simulated with position-based dynamics.
// Self-collision is segment-vs-segment (capsules), with per-substep motion
// clamped below the rope radius so strands can never tunnel through each
// other: the topology of the loop is preserved, which is the whole game.

export class Rope {
  constructor(points, { radius = 0.008, substeps = 6, iterations = 2 } = {}) {
    this.n = points.length;
    this.r = radius;
    this.substeps = substeps;
    this.iterations = iterations;
    const n = this.n;
    this.p = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.w = new Float32Array(n).fill(1); // inverse mass (0 = held)
    this.contact = new Float32Array(n); // smoothed contact pressure per node, for visuals
    points.forEach((q, i) => { this.p.set(q, i * 3); this.prev.set(q, i * 3); });
    let L = 0;
    for (let i = 0; i < n; i++) L += this.dist(i, (i + 1) % n);
    this.rest = L / n;
    this.rest2 = this.rest * 2 * 0.985; // bend constraint length (slightly < straight)
    this.damping = 0.88;
    this.pressure = 0.0;   // >0 opens the loop up like a rubber band, <0 crumples
    this.noise = 0;        // random jitter (used when crumpling)
    this.grabs = new Map(); // id -> { i, target:[x,y,z] }
    this.maxStep = radius * 0.5;
    this.minGap = 2 * radius;
    // spatial hash
    this.cell = this.rest + 2 * radius;
    this.H = 4096;
    this.cellStart = new Int32Array(this.H + 1);
    this.cellEntries = new Int32Array(n);
    this.segCell = new Int32Array(n * 3);
    this.grabMass = 0.04; // held nodes are heavy, not immovable: a taut rope can't be over-stretched
    this.rnd = Math.random;
  }
  dist(i, j) {
    const p = this.p;
    return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
  }
  centroid() {
    const c = [0, 0, 0];
    for (let i = 0; i < this.n; i++) { c[0] += this.p[i * 3]; c[1] += this.p[i * 3 + 1]; c[2] += this.p[i * 3 + 2]; }
    return c.map(v => v / this.n);
  }
  translate(d) {
    for (let i = 0; i < this.n; i++) for (let k = 0; k < 3; k++) { this.p[i * 3 + k] += d[k]; this.prev[i * 3 + k] += d[k]; }
  }
  nearest(q, maxDist = Infinity) {
    let best = -1, bd = maxDist * maxDist;
    for (let i = 0; i < this.n; i++) {
      const dx = this.p[i * 3] - q[0], dy = this.p[i * 3 + 1] - q[1], dz = this.p[i * 3 + 2] - q[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  grab(id, i, target) { this.grabs.set(id, { i, target: target.slice() }); }
  moveGrab(id, target) { const g = this.grabs.get(id); if (g) g.target = target.slice(); }
  release(id) { this.grabs.delete(id); }

  step(dt) {
    const h = dt / this.substeps;
    for (let s = 0; s < this.substeps; s++) this.substep(h);
    for (let i = 0; i < this.n; i++) this.contact[i] *= 0.9;
  }

  substep(h) {
    const { n, p, prev } = this;
    const c = this.pressure ? this.centroid() : null;
    // integrate (verlet) with damping, pressure, clamped velocity
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let vx = (p[o] - prev[o]) * this.damping, vy = (p[o + 1] - prev[o + 1]) * this.damping, vz = (p[o + 2] - prev[o + 2]) * this.damping;
      if (c) {
        const dx = p[o] - c[0], dy = p[o + 1] - c[1], dz = p[o + 2] - c[2], l = Math.hypot(dx, dy, dz) || 1;
        const f = this.pressure * h * h;
        vx += dx / l * f; vy += dy / l * f; vz += dz / l * f;
      }
      if (this.noise) { vx += (this.rnd() - .5) * this.noise; vy += (this.rnd() - .5) * this.noise; vz += (this.rnd() - .5) * this.noise; }
      const sp = Math.hypot(vx, vy, vz);
      if (sp > this.maxStep) { const k = this.maxStep / sp; vx *= k; vy *= k; vz *= k; }
      prev[o] = p[o]; prev[o + 1] = p[o + 1]; prev[o + 2] = p[o + 2];
      p[o] += vx; p[o + 1] += vy; p[o + 2] += vz;
    }
    // grabbed nodes chase their targets, but never faster than maxStep
    this.w.fill(1);
    this.buildHash();
    this.buildPairs();
    for (const g of this.grabs.values()) {
      const o = g.i * 3;
      let dx = g.target[0] - p[o], dy = g.target[1] - p[o + 1], dz = g.target[2] - p[o + 2];
      const l = Math.hypot(dx, dy, dz);
      if (l > this.maxStep) { const k = this.maxStep / l; dx *= k; dy *= k; dz *= k; }
      p[o] += dx; p[o + 1] += dy; p[o + 2] += dz;
      this.w[g.i] = this.grabMass;
    }
    for (let it = 0; it < this.iterations; it++) {
      this.solveLengths(1, this.rest, 1.0);
      this.solveLengths(2, this.rest2, 0.08);
      this.solveCollisions();
    }
    // final stretch pass keeps the rope inextensible
    this.solveLengths(1, this.rest, 1.0);
  }

  solveLengths(step, rest, stiff) {
    const { n, p, w } = this;
    for (let i = 0; i < n; i++) {
      const j = (i + step) % n, a = i * 3, b = j * 3;
      const wi = w[i], wj = w[j], ws = wi + wj; if (!ws) continue;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
      const l = Math.hypot(dx, dy, dz) || 1e-9;
      if (step > 1 && l > rest) continue; // bend constraint only resists folding
      const k = ((l - rest) / l) * stiff / ws;
      p[a] += dx * k * wi; p[a + 1] += dy * k * wi; p[a + 2] += dz * k * wi;
      p[b] -= dx * k * wj; p[b + 1] -= dy * k * wj; p[b + 2] -= dz * k * wj;
    }
  }

  hashKey(x, y, z) { return (Math.abs((x * 92837111) ^ (y * 689287499) ^ (z * 283923481))) % this.H; }
  // counting-sort spatial hash of segment midpoints (built once per substep;
  // the cell is large enough to cover the motion within one substep)
  buildHash() {
    const { n, p, cell, H, cellStart, cellEntries, segCell } = this;
    cellStart.fill(0);
    const keys = this._keys || (this._keys = new Int32Array(n));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x = Math.floor((p[i * 3] + p[j * 3]) * 0.5 / cell), y = Math.floor((p[i * 3 + 1] + p[j * 3 + 1]) * 0.5 / cell), z = Math.floor((p[i * 3 + 2] + p[j * 3 + 2]) * 0.5 / cell);
      segCell[i * 3] = x; segCell[i * 3 + 1] = y; segCell[i * 3 + 2] = z;
      const k = this.hashKey(x, y, z); keys[i] = k; cellStart[k]++;
    }
    let acc = 0; for (let k = 0; k < H; k++) { acc += cellStart[k]; cellStart[k] = acc; } cellStart[H] = acc;
    for (let i = 0; i < n; i++) cellEntries[--cellStart[keys[i]]] = i;
  }

  // broad phase once per substep: candidate segment pairs whose midpoints are close
  buildPairs() {
    const { n, p, cellStart, cellEntries, segCell } = this;
    const seen = this._seen || (this._seen = new Int32Array(n).fill(-1));
    let pairs = this._pairs || (this._pairs = new Int32Array(n * 32));
    const reach = this.rest + this.minGap * 1.5, reach2 = reach * reach;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const mx = (p[i * 3] + p[i1 * 3]) * 0.5, my = (p[i * 3 + 1] + p[i1 * 3 + 1]) * 0.5, mz = (p[i * 3 + 2] + p[i1 * 3 + 2]) * 0.5;
      const cx = segCell[i * 3], cy = segCell[i * 3 + 1], cz = segCell[i * 3 + 2];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const k = this.hashKey(cx + dx, cy + dy, cz + dz);
        for (let e = cellStart[k], end = cellStart[k + 1]; e < end; e++) {
          const j = cellEntries[e];
          if (j <= i || seen[j] === i) continue;
          seen[j] = i; // hash collisions can list a segment twice
          let sep = j - i; sep = Math.min(sep, n - sep);
          if (sep < 3) continue; // neighbours along the rope
          const j1 = (j + 1) % n;
          const ex = (p[j * 3] + p[j1 * 3]) * 0.5 - mx, ey = (p[j * 3 + 1] + p[j1 * 3 + 1]) * 0.5 - my, ez = (p[j * 3 + 2] + p[j1 * 3 + 2]) * 0.5 - mz;
          if (ex * ex + ey * ey + ez * ez > reach2) continue;
          if (m + 2 > pairs.length) { const np = new Int32Array(pairs.length * 2); np.set(pairs); pairs = this._pairs = np; }
          pairs[m++] = i; pairs[m++] = j;
        }
      }
    }
    seen.fill(-1);
    this.pairCount = m;
  }

  solveCollisions() {
    const { n, _pairs: pairs, pairCount: m } = this;
    const gap = this.minGap;
    for (let q = 0; q < m; q += 2) {
      const i = pairs[q], j = pairs[q + 1];
      this.collidePair(i, (i + 1) % n, j, (j + 1) % n, gap);
    }
  }

  // capsule-capsule: segments (a,b) and (c,d)
  collidePair(a, b, c, d, gap) {
    const p = this.p, w = this.w;
    const A = a * 3, B = b * 3, C = c * 3, D = d * 3;
    const ux = p[B] - p[A], uy = p[B + 1] - p[A + 1], uz = p[B + 2] - p[A + 2];
    const vx = p[D] - p[C], vy = p[D + 1] - p[C + 1], vz = p[D + 2] - p[C + 2];
    const rx = p[A] - p[C], ry = p[A + 1] - p[C + 1], rz = p[A + 2] - p[C + 2];
    const uu = ux * ux + uy * uy + uz * uz, vv = vx * vx + vy * vy + vz * vz, uv = ux * vx + uy * vy + uz * vz;
    const ur = ux * rx + uy * ry + uz * rz, vr = vx * rx + vy * ry + vz * rz;
    const den = uu * vv - uv * uv;
    let s = den > 1e-12 ? (uv * vr - vv * ur) / den : 0;
    s = Math.min(1, Math.max(0, s));
    let t = (uv * s + vr) / (vv || 1e-12);
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -ur / (uu || 1e-12))); }
    else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (uv - ur) / (uu || 1e-12))); }
    const px = p[A] + ux * s - (p[C] + vx * t), py = p[A + 1] + uy * s - (p[C + 1] + vy * t), pz = p[A + 2] + uz * s - (p[C + 2] + vz * t);
    const dist = Math.hypot(px, py, pz);
    if (dist >= gap) return;
    let nx, ny, nz;
    if (dist > 1e-7) { nx = px / dist; ny = py / dist; nz = pz / dist; }
    else { nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    const wa = w[a] * (1 - s), wb = w[b] * s, wc = w[c] * (1 - t), wd = w[d] * t;
    const wsum = wa * (1 - s) + wb * s + wc * (1 - t) + wd * t;
    if (wsum < 1e-9) return;
    const corr = (gap - dist) / wsum;
    p[A] += nx * corr * wa; p[A + 1] += ny * corr * wa; p[A + 2] += nz * corr * wa;
    p[B] += nx * corr * wb; p[B + 1] += ny * corr * wb; p[B + 2] += nz * corr * wb;
    p[C] -= nx * corr * wc; p[C + 1] -= ny * corr * wc; p[C + 2] -= nz * corr * wc;
    p[D] -= nx * corr * wd; p[D + 1] -= ny * corr * wd; p[D + 2] -= nz * corr * wd;
    const k = 0.35;
    this.contact[a] += k; this.contact[b] += k; this.contact[c] += k; this.contact[d] += k;
  }

  // smallest distance between any non-adjacent segment pair (for tests)
  minSeparation() {
    const { n, p } = this; let best = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 3; j < n; j++) {
      if (n - (j - i) < 3) continue;
      best = Math.min(best, segDist(p, i, (i + 1) % n, j, (j + 1) % n));
    }
    return best;
  }
}

export function segDist(p, a, b, c, d) {
  const A = a * 3, B = b * 3, C = c * 3, D = d * 3;
  const ux = p[B] - p[A], uy = p[B + 1] - p[A + 1], uz = p[B + 2] - p[A + 2];
  const vx = p[D] - p[C], vy = p[D + 1] - p[C + 1], vz = p[D + 2] - p[C + 2];
  const rx = p[A] - p[C], ry = p[A + 1] - p[C + 1], rz = p[A + 2] - p[C + 2];
  const uu = ux * ux + uy * uy + uz * uz, vv = vx * vx + vy * vy + vz * vz, uv = ux * vx + uy * vy + uz * vz;
  const ur = ux * rx + uy * ry + uz * rz, vr = vx * rx + vy * ry + vz * rz;
  const den = uu * vv - uv * uv;
  let s = den > 1e-12 ? (uv * vr - vv * ur) / den : 0; s = Math.min(1, Math.max(0, s));
  let t = (uv * s + vr) / (vv || 1e-12);
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -ur / (uu || 1e-12))); }
  else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (uv - ur) / (uu || 1e-12))); }
  return Math.hypot(rx + ux * s - vx * t, ry + uy * s - vy * t, rz + uz * s - vz * t);
}
