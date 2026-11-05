// Puzzle generation: closures of conjugated braids.
// The closure of w · (σ1 σ2 … σ(n-1)) · w⁻¹ is always the unknot (conjugation
// is a Markov move and the closure of σ1…σ(n-1) is a single unknotted loop),
// yet its diagram can be made arbitrarily tangled by growing w. So every
// generated knot is guaranteed solvable, and no shortcut exists: the strands
// physically can't pass through each other.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A braid word is a list of signed generators: +i means σi, -i means σi⁻¹ (1-based).
export function makeUnknotBraid({ strands, conjLength, seed }) {
  const rnd = mulberry32(seed);
  const w = [];
  for (let i = 0; i < conjLength; i++) {
    let g;
    do {
      g = (1 + Math.floor(rnd() * (strands - 1))) * (rnd() < 0.5 ? -1 : 1);
    } while (w.length && w[w.length - 1] === -g); // avoid trivial σσ⁻¹ cancellation
    w.push(g);
  }
  const core = [];
  for (let i = 1; i < strands; i++) core.push(rnd() < 0.5 ? i : -i);
  const winv = w.slice().reverse().map(g => -g);
  return [...w, ...core, ...winv];
}

// Turn a braid word into a closed 3D polyline (one component).
// Strands run around a ring of radius R; slot k sits at radius R + offset(k).
export function braidToCurve(word, strands, { R = 0.12, slot = 0.032, lift = 0.028, samplesPerStep = 10 } = {}) {
  const m = word.length;
  // slotOf[s][k] = slot occupied at step s by the strand that started in slot k
  let pos = Array.from({ length: strands }, (_, k) => k); // pos[strandId] = slot
  const tracks = Array.from({ length: strands }, () => []);
  const off = k => (k - (strands - 1) / 2) * slot;
  for (let s = 0; s < m; s++) {
    const g = word[s], i = Math.abs(g) - 1; // swaps slots i and i+1
    const over = g > 0 ? i : i + 1; // slot whose strand goes over
    for (let id = 0; id < strands; id++) {
      const a = pos[id];
      const b = a === i ? i + 1 : a === i + 1 ? i : a;
      for (let q = 0; q < samplesPerStep; q++) {
        const u = q / samplesPerStep;
        const e = u * u * (3 - 2 * u);
        const th = (2 * Math.PI * (s + u)) / m;
        const r = R + off(a) + (off(b) - off(a)) * e;
        const z = a !== b ? (a === over ? 1 : -1) * lift * Math.sin(Math.PI * u) : 0;
        tracks[id].push([r * Math.cos(th), z, r * Math.sin(th)]);
      }
      pos[id] = b;
    }
  }
  // after the full word strand `id` ends in slot pos[id]; the closure joins it
  // to the strand that *started* in that slot. Follow the cycle.
  const startOfSlot = k => k; // strand id k started at slot k
  const pts = [];
  let id = 0; const seen = new Set();
  while (!seen.has(id)) {
    seen.add(id);
    pts.push(...tracks[id]);
    id = startOfSlot(pos[id]);
  }
  if (seen.size !== strands) throw new Error('braid closure has more than one component');
  return pts;
}

// Resample a closed polyline to n points evenly spaced by arc length.
export function resampleClosed(pts, n) {
  const L = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = L[pts.length], out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / n;
    while (L[j + 1] < d) j++;
    const a = pts[j], b = pts[(j + 1) % pts.length], t = (d - L[j]) / (L[j + 1] - L[j] || 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return { points: out, length: total };
}

// Level table. Early levels teach; later ones get long conjugators.
export const LEVELS = [
  { name: 'Twist', strands: 2, conj: 0 },
  { name: 'Double Twist', strands: 2, conj: 2 },
  { name: 'Figure Loop', strands: 3, conj: 0 },
  { name: 'Braid', strands: 3, conj: 2 },
  { name: 'Snarl', strands: 3, conj: 3 },
  { name: 'Cat\'s Cradle', strands: 3, conj: 4 },
  { name: 'Hydra', strands: 4, conj: 3 },
  { name: 'Gordian', strands: 4, conj: 5 },
];
export function dailySpec(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const rnd = mulberry32(day * 2654435761);
  const strands = 3 + (rnd() < 0.35 ? 1 : 0);
  return { name: 'Daily Knot', number: day - 20400, strands, conj: 3 + Math.floor(rnd() * 2), seed: day };
}
