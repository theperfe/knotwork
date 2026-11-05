// Find a short sequence of two-hand pull moves that solves a level under the
// in-game physics (pressure 0.02, dt 1/72). Used to script the demo video.
import { makePuzzle } from '../src/puzzle.js';
import { LEVELS, mulberry32 } from '../src/braid.js';
import { TangleTracker } from '../src/topology.js';

export function runMoves(rope, target, moves, onStep) {
  rope.pressure = +(process.env.P || 0.02);
  for (const mv of moves) {
    const { a, b, pull, lift, frames = 90, rest = 72 } = mv;
    const pa = Array.from(rope.p.slice(a * 3, a * 3 + 3)), pb = Array.from(rope.p.slice(b * 3, b * 3 + 3));
    const dir = pa.map((v, k) => v - pb[k]); const dl = Math.hypot(...dir) || 1; dir.forEach((v, k) => dir[k] = v / dl);
    const c = pa.map((v, k) => (v + pb[k]) / 2);
    const tA = s => { const k = s / frames; return c.map((v, i) => v + dir[i] * (dl / 2 + pull * k) + (i === 1 ? lift * Math.sin(k * Math.PI) : 0)); };
    const tB = s => { const k = s / frames; return c.map((v, i) => v - dir[i] * (dl / 2 + pull * k) - (i === 1 ? lift * Math.sin(k * Math.PI) : 0)); };
    rope.grab('right', a, pa); rope.grab('left', b, pb);
    for (let s = 0; s <= frames; s++) { rope.moveGrab('right', tA(s)); rope.moveGrab('left', tB(s)); rope.step(1 / 72); onStep && onStep('pull', tA(s), tB(s)); }
    rope.release('right'); rope.release('left');
    for (let s = 0; s < rest; s++) { rope.step(1 / 72); onStep && onStep('rest'); }
    if (TangleTracker.minCrossings(rope.p, rope.n) <= target) return true;
  }
  return false;
}

if (process.argv[1].endsWith('search.mjs')) {
  const lv = +process.argv[2], L = LEVELS[lv];
  const spec = { ...L, index: lv, seed: 1000 + lv * 17 };
  for (let t = 0; t < 12; t++) {
    const { rope, target } = makePuzzle(spec);
    const tgt = target ? target + 1 : 0;
    const rnd = mulberry32(t * 31 + 7), moves = [];
    for (let m = 0; m < 10; m++) {
      const a = Math.floor(rnd() * rope.n), b = (a + Math.floor(rope.n * (0.3 + rnd() * 0.4))) % rope.n;
      moves.push({ a, b, pull: 0.04 + rnd() * 0.1, lift: (rnd() - 0.5) * 0.12 });
    }
    // find shortest prefix that solves
    for (let k = 1; k <= moves.length; k++) {
      const { rope: r2 } = makePuzzle(spec);
      if (runMoves(r2, tgt, moves.slice(0, k))) { console.log(JSON.stringify({ level: lv, try: t, moves: moves.slice(0, k) })); process.exit(0); }
    }
  }
  console.log('none found');
}
