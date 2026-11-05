import { makeUnknotBraid, braidToCurve, resampleClosed, mulberry32, KNOTS } from './braid.js';
import { Rope } from './rope.js';
import { TangleTracker } from './topology.js';

export const ROPE_RADIUS = 0.0075;

// Build a puzzle rope centred at the origin. Topology is fixed by the braid;
// the crumple pass just scrambles its shape (collisions keep it honest).
export const CRUMPLE = { steps: 50, pressure: -0.12 };
// Try successive warp seeds until the loop really looks tangled from every angle.
export function makePuzzle(spec, opts = {}) {
  const target = KNOTS[spec.knot || 'unknot'].crossings;
  const want = spec.minCrossings ?? Math.max(4, spec.strands + spec.conj) + target * 2;
  let best = null;
  for (let k = 0; k < 8; k++) {
    const r = makeOne({ ...spec, seed: (spec.seed ?? 1) + k * 7919 }, opts);
    if (!best || r.crossings > best.crossings) best = r;
    if (r.crossings >= want) break;
  }
  best.target = target;
  return best;
}

function makeOne(spec, { crumpleSteps = CRUMPLE.steps, record = false } = {}) {
  const { strands, conj, seed = 1 } = spec;
  const word = makeUnknotBraid({ strands, conjLength: conj, seed, knot: spec.knot || 'unknot' });
  const R = 0.05 + strands * 0.012;
  const raw = braidToCurve(word, strands, { R, slot: 0.026, lift: 0.024 });
  let len = 0; for (let i = 0; i < raw.length; i++) { const a = raw[i], b = raw[(i + 1) % raw.length]; len += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  const n = Math.max(60, Math.round(len / (ROPE_RADIUS * 2.2)));
  const { points } = resampleClosed(raw, n);
  // Lift the flat braid ring into 3D with a smooth global warp. Any smooth
  // invertible map of space keeps the knot type, so this can't create a knot.
  const rnd0 = mulberry32(seed * 7 + 3);
  const tw = (rnd0() - 0.5) * 2.4, bend = (rnd0() - 0.5) * 1.6, sy = 2.2 + rnd0();
  for (const q of points) {
    let [x, y, z] = q; y *= sy;
    // each rotation's angle depends only on the coordinate along its own axis,
    // so the map is a diffeomorphism (a twist), never a fold
    const a = tw * x / R, ca = Math.cos(a), sa = Math.sin(a);
    [y, z] = [y * ca - z * sa, y * sa + z * ca];
    const b = bend * z / R, cb = Math.cos(b), sb = Math.sin(b);
    [x, y] = [x * cb - y * sb, x * sb + y * cb];
    q[0] = x; q[1] = y; q[2] = z;
  }
  const rope = new Rope(points, { radius: ROPE_RADIUS });
  rope.rnd = mulberry32(seed ^ 0x9e3779b9);
  // crumple: squeeze + jitter, then a short settle
  rope.pressure = CRUMPLE.pressure; rope.noise = ROPE_RADIUS * 0.2;
  const frames = record ? [rope.p.slice()] : null;
  for (let i = 0; i < crumpleSteps; i++) { rope.step(1 / 60); if (record && i % 2) frames.push(rope.p.slice()); }
  rope.pressure = 0.05; rope.noise = 0;
  for (let i = 0; i < 30; i++) { rope.step(1 / 60); if (record && i % 2) frames.push(rope.p.slice()); }
  rope.pressure = 0;
  const c = rope.centroid(); rope.translate(c.map(v => -v));
  if (record) for (const f of frames) for (let i = 0; i < rope.n; i++) { f[i * 3] -= c[0]; f[i * 3 + 1] -= c[1]; f[i * 3 + 2] -= c[2]; }
  rope.prev.set(rope.p);
  const crossings = TangleTracker.minCrossings(rope.p, rope.n);
  return { rope, word, crossings, length: len, frames };
}
