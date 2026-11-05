import { InstancedMesh, SphereGeometry, CylinderGeometry, MeshStandardMaterial, Matrix4, Vector3, Quaternion } from '@iwsdk/core';

// Glowing "ghost" hands drawn from the 25 tracked joints, matching the game's
// look (and visible in the emulator, where no hand model is downloaded).
// Joint order follows the WebXR Hand Input spec.
const BONES = [];
for (const f of [[1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24]]) {
  BONES.push([0, f[0]]);
  for (let i = 0; i < f.length - 1; i++) BONES.push([f[i], f[i + 1]]);
}
BONES.push([5, 10], [10, 15], [15, 20], [1, 5]);
const _m = new Matrix4(), _a = new Vector3(), _b = new Vector3(), _d = new Vector3(), _q = new Quaternion(), _s = new Vector3(), UP = new Vector3(0, 1, 0);

export class HandView {
  constructor(scene) {
    const mat = new MeshStandardMaterial({ color: 0xbfd8ff, emissive: 0x2a4a7a, emissiveIntensity: 0.6, roughness: 0.5, transparent: true, opacity: 0.42, depthWrite: false });
    this.joints = new InstancedMesh(new SphereGeometry(1, 10, 8), mat, 50);
    this.bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8, 1, true), mat, BONES.length * 2);
    for (const m of [this.joints, this.bones]) { m.frustumCulled = false; m.count = 0; m.renderOrder = 5; scene.add(m); }
  }
  update(hands) {
    let ji = 0, bi = 0;
    for (const h of hands) {
      if (h.kind !== 'hand' || !h.joints) continue;
      const J = h.joints, R = h.radii;
      for (let j = 0; j < 25; j++) {
        const r = Math.max(0.004, (R[j] || 0.008) * 0.85);
        _m.makeScale(r, r, r).setPosition(J[j * 3], J[j * 3 + 1], J[j * 3 + 2]);
        this.joints.setMatrixAt(ji++, _m);
      }
      for (const [a, b] of BONES) {
        _a.fromArray(J, a * 3); _b.fromArray(J, b * 3); _d.subVectors(_b, _a);
        const len = _d.length(); if (len < 1e-5) continue;
        const r = Math.max(0.0035, Math.min(R[a] || 0.008, R[b] || 0.008) * 0.75);
        _q.setFromUnitVectors(UP, _d.normalize());
        _m.compose(_a.add(_b).multiplyScalar(0.5), _q, _s.set(r, len, r));
        this.bones.setMatrixAt(bi++, _m);
      }
    }
    this.joints.count = ji; this.bones.count = bi;
    this.joints.instanceMatrix.needsUpdate = true; this.bones.instanceMatrix.needsUpdate = true;
  }
}
