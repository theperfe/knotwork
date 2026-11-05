import { Vector3, Matrix4, Raycaster, Vector2, Plane } from '@iwsdk/core';

// Unified pointers: tracked hands (pinch), XR controllers (trigger/grip as
// fallback) and the desktop mouse (for the browser preview).
// Each pointer: { id, kind, pos (world pinch point), tip (index tip), down, pressed, released, tracked }

const PINCH_ON = 0.022, PINCH_OFF = 0.04;
const _m = new Matrix4(), _v = new Vector3();

export class Pointers {
  constructor(world) {
    this.world = world;
    this.list = new Map();
    this.mouse = { ndc: new Vector2(), down: false, pressed: false, released: false, inside: false, button: 0 };
    this.ray = new Raycaster();
    const el = world.renderer.domElement;
    el.addEventListener('pointerdown', e => { this.mouse.down = true; this.mouse.pressed = true; this.mouse.button = e.button; this.setNdc(e); el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => { this.setNdc(e); this.mouse.inside = true; this.mouse.dx = (this.mouse.dx || 0) + e.movementX; this.mouse.dy = (this.mouse.dy || 0) + e.movementY; });
    el.addEventListener('pointerup', e => { this.mouse.down = false; this.mouse.released = true; });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { this.mouse.wheel = (this.mouse.wheel || 0) + e.deltaY; e.preventDefault(); }, { passive: false });
  }
  setNdc(e) {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  get(id) {
    let p = this.list.get(id);
    if (!p) this.list.set(id, p = { id, kind: '', pos: new Vector3(), tip: new Vector3(), down: false, pressed: false, released: false, tracked: false, strength: 0 });
    return p;
  }

  update(frame) {
    for (const p of this.list.values()) { p.pressed = p.released = false; p.tracked = false; }
    const world = this.world, session = world.session;
    this.xr = !!(session && frame);
    if (this.xr) {
      const ref = world.renderer.xr.getReferenceSpace();
      const origin = world.player.matrixWorld;
      for (const src of session.inputSources) {
        const side = src.handedness; if (side !== 'left' && side !== 'right') continue;
        if (src.hand) {
          const tj = src.hand.get('thumb-tip'), ij = src.hand.get('index-finger-tip');
          const tp = tj && frame.getJointPose(tj, ref), ip = ij && frame.getJointPose(ij, ref);
          if (!tp || !ip) continue;
          const p = this.get(side); p.kind = 'hand'; p.tracked = true;
          // all 25 joints, for the stylised hand renderer
          if (!p.joints) { p.joints = new Float32Array(25 * 3); p.radii = new Float32Array(25); p.poses = new Float32Array(25 * 16); p.spaces = [...src.hand.values()]; }
          if (frame.fillPoses && frame.fillPoses(p.spaces, ref, p.poses)) {
            for (let j = 0; j < 25; j++) { _v.set(p.poses[j * 16 + 12], p.poses[j * 16 + 13], p.poses[j * 16 + 14]).applyMatrix4(origin); p.joints.set([_v.x, _v.y, _v.z], j * 3); }
            if (frame.fillJointRadii) frame.fillJointRadii(p.spaces, p.radii);
          } else {
            p.spaces.forEach((sp, j) => { const jp = frame.getJointPose(sp, ref); if (jp) { _v.set(jp.transform.position.x, jp.transform.position.y, jp.transform.position.z).applyMatrix4(origin); p.joints.set([_v.x, _v.y, _v.z], j * 3); p.radii[j] = jp.radius || 0.008; } });
          }
          const t = new Vector3(tp.transform.position.x, tp.transform.position.y, tp.transform.position.z).applyMatrix4(origin);
          p.tip.set(ip.transform.position.x, ip.transform.position.y, ip.transform.position.z).applyMatrix4(origin);
          const d = t.distanceTo(p.tip);
          p.pos.copy(t).add(p.tip).multiplyScalar(0.5);
          p.strength = Math.max(0, Math.min(1, (PINCH_OFF - d) / (PINCH_OFF - PINCH_ON)));
          this.setDown(p, p.down ? d < PINCH_OFF : d < PINCH_ON);
        } else if (src.gripSpace || src.targetRaySpace) {
          const pose = frame.getPose(src.gripSpace || src.targetRaySpace, ref); if (!pose) continue;
          const p = this.get(side); p.kind = 'controller'; p.tracked = true;
          _m.fromArray(pose.transform.matrix).premultiply(origin);
          p.pos.set(0, -0.01, -0.06).applyMatrix4(_m); // a little ahead of the grip
          p.tip.copy(p.pos);
          const gp = src.gamepad, pressed = gp && ((gp.buttons[0] && gp.buttons[0].pressed) || (gp.buttons[1] && gp.buttons[1].pressed));
          p.strength = pressed ? 1 : 0;
          this.setDown(p, !!pressed);
        }
      }
      for (const p of this.list.values()) if (!p.tracked && p.down && p.id !== 'mouse') this.setDown(p, false);
    }
    const m = this.mouse;
    m.pressedNow = m.pressed; m.releasedNow = m.released; m.pressed = m.released = false;
    m.dxNow = m.dx || 0; m.dyNow = m.dy || 0; m.dx = m.dy = 0; m.wheelNow = m.wheel || 0; m.wheel = 0;
    if (!this.xr) {
      this.ray.setFromCamera(m.ndc, world.camera);
    }
  }
  setDown(p, down) {
    if (down && !p.down) p.pressed = true;
    if (!down && p.down) p.released = true;
    p.down = down;
  }
  hands() { return [...this.list.values()].filter(p => p.tracked && p.id !== 'mouse'); }
}

// Project the mouse ray onto a camera-facing plane through `point`.
export function rayToPlane(ray, camera, point, out = new Vector3()) {
  const nrm = camera.getWorldDirection(_v).clone();
  const plane = new Plane().setFromNormalAndCoplanarPoint(nrm, point);
  return ray.ray.intersectPlane(plane, out) || out.copy(point);
}
