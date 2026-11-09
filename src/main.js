import { World, SessionMode } from '@iwsdk/core';
import { GameSystem } from './game.js';

// ?emu: scripted Quest 3 emulator (no dev UI) for automated tests and the demo recorder
if (new URLSearchParams(location.search).has('emu')) {
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3, { stereoEnabled: false });
  device.installRuntime({ forceInstall: true });
  window.IWER_DEVICE = device;
}

const container = document.getElementById('scene-container');
const world = await World.create(container, {
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'none',
    features: { handTracking: { required: false } },
  },
  render: { fov: 60, near: 0.01, far: 60, camera: { position: [0, 1.3, 0.2] } },
  features: { spatialUI: false, grabbing: false, locomotion: false },
});
// sharper image in the headset: render a bit above the default resolution and keep
// fixed foveation low (three.js defaults to maximum, which blurs everything off-centre)
world.renderer.xr.setFramebufferScaleFactor(1.25);
world.renderer.xr.setFoveation(0.25);
world.registerSystem(GameSystem);
window.world = world;

const enter = document.getElementById('enter');
const supported = navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false));
enter.textContent = supported ? 'Enter VR' : 'VR not available: play with the mouse';
enter.disabled = !supported;
enter.addEventListener('click', () => { world.knotworkSound?.start?.(); world.launchXR(); });
document.getElementById('overlay').classList.add('ready');
