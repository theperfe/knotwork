// Small WebAudio synth: soft pad, plucks on grab/release, a tension hum that
// rises as the rope goes taut, and a chime when the loop comes free.
const PENTA = [0, 2, 4, 7, 9];
const midi = m => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  constructor() { this.ctx = null; this.enabled = true; }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(ctx.destination);
    // reverb-ish feedback delay
    const dl = ctx.createDelay(); dl.delayTime.value = 0.23; const fb = ctx.createGain(); fb.gain.value = 0.32;
    const lp = ctx.createBiquadFilter(); lp.frequency.value = 2400;
    dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.master);
    this.send = ctx.createGain(); this.send.gain.value = 0.5; this.send.connect(dl);
    // pad
    this.pad = ctx.createGain(); this.pad.gain.value = 0; this.pad.connect(this.master);
    this.padOsc = [45, 52, 57, 60, 64].map((m, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = midi(m); o.detune.value = (i - 2) * 4;
      const g = ctx.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(this.pad); o.start(); return o;
    });
    // tension hum
    this.hum = ctx.createOscillator(); this.hum.type = 'sawtooth'; this.hum.frequency.value = 110;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 500; hf.Q.value = 4;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    this.hum.connect(hf); hf.connect(this.humGain); this.humGain.connect(this.master); this.hum.start();
    this.humFilter = hf;
    this.setPad(0.7);
  }
  now() { return this.ctx ? this.ctx.currentTime : 0; }
  setPad(v, major = false) {
    if (!this.ctx) return;
    this.pad.gain.setTargetAtTime(v * 0.5, this.now(), 0.8);
    this.padOsc[3].frequency.setTargetAtTime(midi(major ? 61 : 60), this.now(), 0.3);
  }
  tension(k) { // 0..1
    if (!this.ctx) return;
    this.humGain.gain.setTargetAtTime(Math.max(0, k - 0.15) * 0.08, this.now(), 0.08);
    this.hum.frequency.setTargetAtTime(90 + k * 120, this.now(), 0.08);
    this.humFilter.frequency.setTargetAtTime(300 + k * 1500, this.now(), 0.08);
  }
  pluck(m, amp = 0.2, dur = 1.2, type = 'triangle') {
    if (!this.ctx) return;
    const t = this.now(), o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = midi(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.master); g.connect(this.send); o.start(t); o.stop(t + dur + 0.05);
  }
  grab(i, n) { this.pluck(69 + PENTA[Math.floor((i / n) * 10) % 5] + (i / n > 0.5 ? 12 : 0), 0.16, 0.9); }
  release() { this.pluck(57, 0.06, 0.4, 'sine'); }
  click() { this.pluck(81, 0.08, 0.15, 'square'); }
  progress(up) { this.pluck(up ? 76 : 64, 0.07, 0.6, 'sine'); }
  solved() {
    this.setPad(0.9, true);
    [69, 73, 76, 81, 85, 88].forEach((m, i) => setTimeout(() => this.pluck(m, 0.16, 2.4), i * 90));
  }
}
