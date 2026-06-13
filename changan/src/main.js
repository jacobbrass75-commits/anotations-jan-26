// Chang'an, 743 CE — entry point.
import * as THREE from 'three';
import { makeRng } from './rng.js';
import { buildTextures } from './textures.js';
import { Instancer, initParts } from './parts.js';
import { CITY, buildWards, paintCityMap } from './layout.js';
import { buildOuterWalls, buildWardsGeo, buildMarkets, buildStreetTrees } from './city.js';
import {
  buildImperialCity, buildTaijiPalace, buildDamingPalace,
  buildXingqingPalace, buildMonasteries, buildQujiang,
} from './palaces.js';
import { Crowd } from './npcs.js';
import { Player } from './player.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const LITE = params.has('lite');

/* ----------------------------- renderer ---------------------------- */

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = !LITE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.className = 'webgl';
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.3, 9000);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ------------------------------ world ------------------------------ */

const T = buildTextures();
const world = {
  scene,
  rng: makeRng(20260613),
  inst: null,
  mats: null,
  roofDefs: null,
  colliders: [],
  regions: [],
  ellipses: [],
  stalls: [],
  lanterns: [],
};
world.inst = new Instancer(scene);
initParts(world, T);

const wards = buildWards();
for (const w of wards) {
  if (['晋昌坊', '安仁坊', '靖善坊'].includes(w.cn)) w.skipGeo = true; // great monasteries fill these
  else if (!w.south && world.rng.chance(0.1)) w.temple = true;
}

// painted ground plan (shared by terrain texture, minimap and big map)
const mapCanvas = document.createElement('canvas');
mapCanvas.width = mapCanvas.height = 4096;
paintCityMap(mapCanvas, wards);
const mapTex = new THREE.CanvasTexture(mapCanvas);
mapTex.colorSpace = THREE.SRGBColorSpace;
mapTex.anisotropy = 8;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(CITY.groundSize, CITY.groundSize),
  new THREE.MeshLambertMaterial({ map: mapTex }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// close-range dirt detail that follows the player (snapped so it never swims)
T.detail.repeat.set(64, 64);
const detail = new THREE.Mesh(
  new THREE.PlaneGeometry(512, 512),
  new THREE.MeshLambertMaterial({ map: T.detail, transparent: true, depthWrite: false, opacity: 0.5 }),
);
detail.rotation.x = -Math.PI / 2;
detail.position.y = 0.15;
detail.renderOrder = 1;
scene.add(detail);

/* --------------------------- build the city ------------------------ */

console.time('build Chang\'an');
buildOuterWalls(world);
buildImperialCity(world);
buildTaijiPalace(world);
buildDamingPalace(world);
buildXingqingPalace(world);
buildMonasteries(world);
buildQujiang(world);
buildMarkets(world);
buildWardsGeo(world, wards);
buildStreetTrees(world);
const stats = world.inst.build();
console.timeEnd('build Chang\'an');
console.log(`Chang'an: ${stats.instances} instances in ${stats.meshes} meshes, ` +
  `${world.colliders.length} colliders, ${world.regions.length} walk regions, ${world.stalls.length} stalls`);

// lantern glow points (visible at night)
const lanternGeo = new THREE.BufferGeometry();
lanternGeo.setAttribute('position', new THREE.Float32BufferAttribute(world.lanterns, 3));
const lanternPts = new THREE.Points(lanternGeo, new THREE.PointsMaterial({
  map: T.lantern, size: 5, sizeAttenuation: true, transparent: true,
  depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb060,
}));
lanternPts.visible = false;
lanternPts.frustumCulled = false;
scene.add(lanternPts);

/* ------------------------------ lights ----------------------------- */

const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x8a7350, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.castShadow = !LITE;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -190; sun.shadow.camera.right = 190;
sun.shadow.camera.top = 190; sun.shadow.camera.bottom = -190;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 1100;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.2;
scene.add(sun, sun.target);

// sky dome + sun sprite
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2; skyCanvas.height = 256;
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(7600, 24, 16),
  new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
);
scene.add(sky);
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: T.sun, transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, depthTest: false,
}));
sunSprite.scale.set(900, 900, 1);
scene.add(sunSprite);

scene.fog = new THREE.Fog(0xe0bf96, 900, 3600);

const PRESETS = [
  {
    label: '卯时 · dawn', dir: [0.88, 0.22, -0.18], sunCol: 0xffcf9e, sunI: 2.2,
    hemiSky: 0xd8e0ea, hemiGnd: 0x97825e, hemiI: 0.75, skyTop: '#94aecb', skyBot: '#f0cf9c',
    fog: 0xe2cba2, fogN: 800, fogF: 3400, night: false,
  },
  {
    label: '午时 · noon', dir: [0.08, 0.88, 0.45], sunCol: 0xfff4e0, sunI: 2.9,
    hemiSky: 0xcfe2f2, hemiGnd: 0x9c8a68, hemiI: 1.0, skyTop: '#79aede', skyBot: '#d9e2d4',
    fog: 0xd9ddc9, fogN: 1300, fogF: 5200, night: false,
  },
  {
    label: '酉时 · golden hour', dir: [-0.9, 0.18, 0.32], sunCol: 0xffaa5e, sunI: 2.5,
    hemiSky: 0xa9b4ce, hemiGnd: 0x8a6f4c, hemiI: 0.72, skyTop: '#5e74a6', skyBot: '#f2b878',
    fog: 0xe0bf96, fogN: 900, fogF: 3600, night: false,
  },
  {
    label: '子时 · midnight', dir: [0.3, 0.62, -0.45], sunCol: 0x8fa3cc, sunI: 0.35,
    hemiSky: 0x2a3a5e, hemiGnd: 0x141210, hemiI: 0.22, skyTop: '#0a1228', skyBot: '#1d2c4e',
    fog: 0x0d1524, fogN: 500, fogF: 2400, night: true,
  },
];
let presetI = 2;
function applyPreset(i) {
  const P = PRESETS[i];
  sun.color.set(P.sunCol); sun.intensity = P.sunI;
  hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGnd); hemi.intensity = P.hemiI;
  scene.fog.color.set(P.fog); scene.fog.near = P.fogN; scene.fog.far = P.fogF;
  const ctx = skyCanvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, P.skyTop); g.addColorStop(1, P.skyBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
  skyTex.needsUpdate = true;
  sunSprite.material.color.set(P.night ? 0xc8d8f0 : 0xffffff);
  sunSprite.scale.setScalar(P.night ? 420 : 900);
  lanternPts.visible = P.night;
  hud && hud.setClock(P.label);
}

/* --------------------------- player & crowd ------------------------ */

const player = new Player(world, camera, document.body);
const crowd = new Crowd(world, LITE ? 280 : 650);
let hud = new Hud(world, player, wards, mapCanvas, {
  cycleTime: () => { presetI = (presetI + 1) % PRESETS.length; applyPreset(presetI); },
});
applyPreset(presetI);
hud.toast('天宝二年，长安。 You stand inside the Mingde Gate. The Vermilion Bird Avenue runs 5 km north to the Imperial City. The markets lie halfway — press <b>M</b> for the map.', 12);

/* ----------------------------- intro lock -------------------------- */

const intro = document.getElementById('intro');
intro.addEventListener('click', () => renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  player.locked = locked;
  intro.style.display = locked ? 'none' : 'flex';
});

/* ------------------------------- loop ------------------------------ */

// console helper: changan.tp(x, z, yaw) — e.g. changan.tp(1250, -4400, Math.PI) for the Daming Palace
window.changan = {
  player, world,
  tp(x, z, yaw = Math.PI, pitch = 0) {
    player.pos.set(x, player.groundAt(x, z), z);
    player.yaw = yaw; player.pitch = pitch;
  },
  time(i) { presetI = i % PRESETS.length; applyPreset(presetI); },
};

const clock = new THREE.Clock();
const sunDir = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.08);

  player.update(dt);
  crowd.update(dt, player.pos.x, player.pos.z);

  // sun follows the player so the shadow box stays useful
  const P = PRESETS[presetI];
  sunDir.set(P.dir[0], P.dir[1], P.dir[2]).normalize();
  const sx = Math.round(player.pos.x / 10) * 10, sz = Math.round(player.pos.z / 10) * 10;
  sun.position.set(sx + sunDir.x * 500, sunDir.y * 500, sz + sunDir.z * 500);
  sun.target.position.set(sx, 0, sz);
  sky.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 7000);
  detail.position.set(Math.round(player.pos.x / 8) * 8, 0.15, Math.round(player.pos.z / 8) * 8);

  T.water.offset.x += dt * 0.012;
  T.water.offset.y += dt * 0.007;

  hud.update(dt, 1 / Math.max(dt, 1e-4));
  renderer.render(scene, camera);
}
frame();
