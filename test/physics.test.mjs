// Headless checks: puzzle generation, no tunnelling under violent dragging,
// and the solved detector (circle = solved, trefoil = never solved).
import { makePuzzle } from '../src/puzzle.js';
import { LEVELS, dailySpec, mulberry32 } from '../src/braid.js';
import { Rope } from '../src/rope.js';
import { TangleTracker } from '../src/topology.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

for (const [i, L] of LEVELS.entries()) {
  const t0 = performance.now();
  const { rope, crossings, word } = makePuzzle({ ...L, seed: 100 + i });
  ok(rope.minSeparation() > rope.minGap * 0.6, `${L.name}: n=${rope.n} word=${word.length} crossings=${crossings} gen=${(performance.now() - t0).toFixed(0)}ms sep=${(rope.minSeparation() / rope.minGap).toFixed(2)}`);
}
const d = dailySpec(new Date('2026-11-05'));
ok(d.strands >= 3, `daily spec ${JSON.stringify(d)}`);

// violent random dragging: rope must never pass through itself
{
  const { rope } = makePuzzle({ ...LEVELS[6], seed: 7 });
  const rnd = mulberry32(3); let worst = Infinity; const t0 = performance.now(); let steps = 0;
  for (let k = 0; k < 40; k++) {
    const a = Math.floor(rnd() * rope.n), b = Math.floor(rnd() * rope.n);
    const ta = [(rnd() - .5) * .8, (rnd() - .5) * .8, (rnd() - .5) * .8], tb = ta.map(v => -v);
    rope.grab('L', a, ta); rope.grab('R', b, tb);
    for (let s = 0; s < 20; s++) { rope.step(1 / 72); steps++; }
    worst = Math.min(worst, rope.minSeparation());
    rope.release('L'); rope.release('R');
  }
  const ms = (performance.now() - t0) / steps;
  ok(worst > rope.minGap * 0.4, `no tunnelling under violent drags: worst gap ${(worst / rope.minGap).toFixed(2)} of diameter, ${ms.toFixed(2)}ms/frame (incl. checks)`);
}
// timing of sim alone
{
  const { rope } = makePuzzle({ ...LEVELS[7], seed: 9 });
  const t0 = performance.now(); for (let i = 0; i < 200; i++) rope.step(1 / 72);
  const tr = new TangleTracker(); const t1 = performance.now(); for (let i = 0; i < 50; i++) tr.update(rope.p, rope.n, 2);
  ok(true, `perf n=${rope.n}: step ${((t1 - t0) / 200).toFixed(2)}ms, tracker ${((performance.now() - t1) / 50).toFixed(2)}ms`);
}
// circle is solved
{
  const pts = []; for (let i = 0; i < 150; i++) { const a = i / 150 * Math.PI * 2; pts.push([0.18 * Math.cos(a), 0.01 * Math.sin(5 * a), 0.18 * Math.sin(a)]); }
  ok(TangleTracker.minCrossings(Float32Array.from(pts.flat()), 150) === 0, 'circle has a 0-crossing view');
}
// trefoil can never show zero crossings, even after relaxing with pressure
{
  const pts = []; for (let i = 0; i < 220; i++) { const s = i / 220 * Math.PI * 2; pts.push([(Math.sin(s) + 2 * Math.sin(2 * s)) * .06, (Math.cos(s) - 2 * Math.cos(2 * s)) * .06, -Math.sin(3 * s) * .06]); }
  const rope = new Rope(pts, { radius: 0.0075 }); rope.pressure = 0.6;
  let min = Infinity; for (let i = 0; i < 300; i++) { rope.step(1 / 72); if (i % 30 === 0) min = Math.min(min, TangleTracker.minCrossings(rope.p, rope.n)); }
  ok(min >= 3, `trefoil keeps >=3 crossings (min seen ${min})`);
}
// a hidden trefoil built from braids must never simplify below 3 crossings
{
  const { rope, target } = makePuzzle({ ...LEVELS[3], seed: 55 });
  const rnd = mulberry32(11); let min = Infinity;
  for (let m = 0; m < 12; m++) {
    const a = Math.floor(rnd() * rope.n), b = (a + Math.floor(rope.n / 2)) % rope.n;
    const pa = Array.from(rope.p.slice(a * 3, a * 3 + 3)), pb = Array.from(rope.p.slice(b * 3, b * 3 + 3));
    rope.grab('A', a, pa); rope.grab('B', b, pb);
    for (let s = 0; s < 50; s++) { rope.moveGrab('A', pa.map((v, k) => v + (v - pb[k]) * s / 60)); rope.moveGrab('B', pb.map((v, k) => v + (v - pa[k]) * s / 60)); rope.step(1 / 72); }
    rope.release('A'); rope.release('B'); rope.pressure = 0.4; for (let s = 0; s < 100; s++) rope.step(1 / 72); rope.pressure = 0;
    min = Math.min(min, TangleTracker.minCrossings(rope.p, rope.n));
  }
  ok(target === 3 && min === 3, `hidden trefoil stays a trefoil: target ${target}, fewest crossings seen ${min}`);
}
process.exit(fail ? 1 : 0);
