// Experiment: can simple hand-like moves (pinch two points, pull apart, shake,
// release) undo each level? Gives a rough difficulty read and a demo script.
import { makePuzzle } from '../src/puzzle.js';
import { LEVELS, mulberry32 } from '../src/braid.js';
import { TangleTracker } from '../src/topology.js';

const lv = +(process.argv[2] ?? 0), tries = +(process.argv[3] ?? 12);
const L = LEVELS[lv];
let solved = 0;
for (let t = 0; t < tries; t++) {
  const { rope, crossings, target } = makePuzzle({ ...L, seed: 1000 + lv * 17 });
  const rnd = mulberry32(t + 1);
  let moves = 0, done = false;
  for (; moves < 10 && !done; moves++) {
    const a = Math.floor(rnd() * rope.n), b = (a + Math.floor(rope.n * (0.35 + rnd() * 0.3))) % rope.n;
    const pa = Array.from(rope.p.slice(a * 3, a * 3 + 3)), pb = Array.from(rope.p.slice(b * 3, b * 3 + 3));
    const dir = pa.map((v, k) => v - pb[k]); const dl = Math.hypot(...dir) || 1; dir.forEach((v, k) => dir[k] = v / dl);
    const half = rope.rest * rope.n * 0.22;
    const c = pa.map((v, k) => (v + pb[k]) / 2);
    rope.grab('A', a, pa); rope.grab('B', b, pb);
    for (let s = 0; s <= 60; s++) {
      const k = s / 60, wob = 0.03 * Math.sin(s * 0.4);
      rope.moveGrab('A', c.map((v, i) => v + dir[i] * half * k + (i === 1 ? wob : 0)));
      rope.moveGrab('B', c.map((v, i) => v - dir[i] * half * k - (i === 1 ? wob : 0)));
      rope.step(1 / 72);
    }
    rope.release('A'); rope.release('B');
    rope.pressure = 0.4;
    for (let s = 0; s < 120; s++) rope.step(1 / 72);
    rope.pressure = 0.02;
    done = TangleTracker.minCrossings(rope.p, rope.n) <= target;
  }
  if (done) solved++;
  console.log(`${L.name} try ${t}: start ${crossings} crossings -> ${done ? 'SOLVED in ' + moves + ' moves' : 'not solved, ' + TangleTracker.minCrossings(rope.p, rope.n) + ' left'}`);
}
console.log(`${L.name}: ${solved}/${tries} solved by random pull-apart moves`);
