import { BufferGeometry, BufferAttribute, Mesh, MeshStandardMaterial, MeshBasicMaterial, AdditiveBlending, Color, Vector3 } from '@iwsdk/core';

// Renders the rope as a smooth tube (Catmull-Rom doubled resolution) with
// per-vertex colour: hue follows how tangled the loop still is, contact
// points glow warm (shows where it's jammed), and held sections glow white.
const RAD = 10;
const WARM = new Color(1.0, 0.22, 0.62), COOL = new Color(0.18, 0.85, 1.0), HOT = new Color(1.0, 0.62, 0.2), HELD = new Color(1, 1, 1), GOLD = new Color(1.0, 0.84, 0.35);

export class KnotView {
  constructor(scene, n, radius) {
    this.n = n; this.m = n * 2; this.radius = radius;
    const verts = this.m * RAD;
    const g = new BufferGeometry();
    this.pos = new Float32Array(verts * 3); this.nor = new Float32Array(verts * 3); this.col = new Float32Array(verts * 3);
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new BufferAttribute(this.nor, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    const idx = new Uint32Array(this.m * RAD * 6); let k = 0;
    for (let i = 0; i < this.m; i++) for (let j = 0; j < RAD; j++) {
      const a = i * RAD + j, b = ((i + 1) % this.m) * RAD + j, c = ((i + 1) % this.m) * RAD + (j + 1) % RAD, d = i * RAD + (j + 1) % RAD;
      idx.set([a, b, d, b, c, d], k); k += 6;
    }
    g.setIndex(new BufferAttribute(idx, 1));
    this.geo = g;
    this.mesh = new Mesh(g, new MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.0, emissive: 0x000000 }));
    this.mesh.frustumCulled = false;
    // neon look: vertex colour also drives emission, lighting still reads over/under
    this.mesh.material.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor * 0.42;');
    };
    // emissive via onBeforeCompile would be nicer; a cheap glow shell does the job
    const gg = new BufferGeometry();
    this.gpos = new Float32Array(verts * 3);
    gg.setAttribute('position', new BufferAttribute(this.gpos, 3));
    gg.setAttribute('color', g.getAttribute('color'));
    gg.setIndex(g.getIndex());
    this.glow = new Mesh(gg, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false }));
    this.glow.frustumCulled = false;
    scene.add(this.mesh, this.glow);
    this.c = new Float32Array(this.m * 3);
    this.tan = new Float32Array(this.m * 3);
  }
  dispose() { this.mesh.removeFromParent(); this.glow.removeFromParent(); this.geo.dispose(); this.glow.geometry.dispose(); }
  set visible(v) { this.mesh.visible = this.glow.visible = v; }

  update(p, { tangle = 1, contact, held, flash = 0, solvedK = 0, pulse = 0 }) {
    const { n, m, c, tan } = this;
    // centreline: original nodes + Catmull-Rom midpoints
    for (let i = 0; i < n; i++) {
      const i0 = (i - 1 + n) % n, i2 = (i + 1) % n, i3 = (i + 2) % n;
      for (let k = 0; k < 3; k++) {
        const P0 = p[i0 * 3 + k], P1 = p[i * 3 + k], P2 = p[i2 * 3 + k], P3 = p[i3 * 3 + k];
        c[i * 6 + k] = P1;
        c[i * 6 + 3 + k] = (-P0 + 9 * P1 + 9 * P2 - P3) / 16;
      }
    }
    for (let i = 0; i < m; i++) {
      const a = ((i - 1 + m) % m) * 3, b = ((i + 1) % m) * 3;
      let x = c[b] - c[a], y = c[b + 1] - c[a + 1], z = c[b + 2] - c[a + 2]; const l = Math.hypot(x, y, z) || 1;
      tan[i * 3] = x / l; tan[i * 3 + 1] = y / l; tan[i * 3 + 2] = z / l;
    }
    // parallel-transport frame
    let nx = 0, ny = 1, nz = 0;
    { const tx = tan[0], ty = tan[1], tz = tan[2]; if (Math.abs(ty) > 0.9) { nx = 1; ny = 0; } const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; }
    const r = this.radius, rg = r * 2.3, col = new Color(), base = new Color();
    base.copy(WARM).lerp(COOL, Math.min(1, Math.max(0, 1 - tangle)));
    for (let i = 0; i < m; i++) {
      const tx = tan[i * 3], ty = tan[i * 3 + 1], tz = tan[i * 3 + 2];
      const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const node = i >> 1;
      const ct = contact ? Math.min(1, Math.max(0, contact[node] - 0.6) * 0.35) : 0;
      const hd = held ? held[node] : 0;
      const shimmer = 0.85 + 0.15 * Math.sin(i * 0.35 - pulse * 3);
      col.copy(base).multiplyScalar(shimmer).lerp(HOT, ct * 0.85).lerp(HELD, hd * 0.7).lerp(GOLD, solvedK);
      if (flash) col.lerp(HELD, flash);
      for (let j = 0; j < RAD; j++) {
        const a = (j / RAD) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const ox = nx * ca + bx * sa, oy = ny * ca + by * sa, oz = nz * ca + bz * sa;
        const v = (i * RAD + j) * 3;
        this.pos[v] = c[i * 3] + ox * r; this.pos[v + 1] = c[i * 3 + 1] + oy * r; this.pos[v + 2] = c[i * 3 + 2] + oz * r;
        this.gpos[v] = c[i * 3] + ox * rg; this.gpos[v + 1] = c[i * 3 + 1] + oy * rg; this.gpos[v + 2] = c[i * 3 + 2] + oz * rg;
        this.nor[v] = ox; this.nor[v + 1] = oy; this.nor[v + 2] = oz;
        this.col[v] = col.r; this.col[v + 1] = col.g; this.col[v + 2] = col.b;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.glow.geometry.attributes.position.needsUpdate = true;
  }
}
