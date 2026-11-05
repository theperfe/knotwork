# Knotwork

A hands-only WebXR puzzle game for Meta Quest, built with Meta's Immersive Web SDK.
Players untangle glowing rope with their bare hands. The rope follows real knot
rules: strands are solid and can never pass through each other.

- **Unknot puzzles** look like hopeless tangles but are secretly a plain loop. You
  win when, seen from some angle, no strand crosses another.
- **Hidden-knot puzzles** contain a true knot (trefoil, figure-eight, cinquefoil…).
  No amount of pulling undoes it. Simplify it to its fewest crossings and
  Knotwork tells you which knot you found.
- **Daily Knot**: a new seeded puzzle every day, with a streak counter.

## How it works

| Part | File | Notes |
|---|---|---|
| Puzzle generation | `src/braid.js`, `src/puzzle.js` | The closure of a conjugated braid `w · core · w⁻¹` has the knot type of `core`. Conjugating by a random `w` scrambles the diagram, and a smooth twist of space lifts it into 3D. Both steps preserve the knot type. |
| Rope physics | `src/rope.js` | Position-based dynamics on a closed chain, with capsule-capsule self-collision (spatial hash). Per-substep motion is clamped below the rope radius, and grabs can't over-stretch the rope, so strands can't tunnel through each other. |
| Solve detection | `src/topology.js` | Counts crossings of planar projections over a sweep of view directions plus the best-fit-plane normal. Zero crossings means the loop is certainly unknotted. |
| Rendering | `src/knotview.js`, `src/handview.js` | Dynamic tube mesh with per-vertex colour (tangle progress, contact pressure, held sections), plus stylised hands drawn from the 25 tracked joints. |
| Input/UI | `src/input.js`, `src/ui.js` | Pinch from thumb/index joint distance (with hysteresis), poke-or-pinch buttons, controller and mouse fallbacks. |

## Run

```sh
npm install
npm run dev          # http://localhost:5173 (with the IWER Quest emulator injected)
npm test             # headless physics/topology checks
npm run build        # static build in dist/ (deploy to any HTTPS host, e.g. GitHub Pages)
```

On Quest, open the hosted URL in the Meta Quest Browser and press **Enter VR**.
In a desktop browser you can drag the rope with the mouse (right-drag to orbit).

`tools/xrtest.cjs` drives the game end to end in a scripted Quest 3 emulator
(`?emu`). `tools/demo.cjs` records demo footage frame by frame from the same emulator.
