// The Imperial City, Taiji Palace, Daming Palace, Xingqing Palace,
// the great monasteries with their pagodas, and the Qujiang pleasure garden.
import * as THREE from 'three';
import {
  PALACE, IMPCITY, DAMING, XINGQING, QUJIANG, TAIYE, LONGCHI,
} from './layout.js';
import { placeBuilding, placeWallRect, placePavilion, placePagoda, addCollider } from './parts.js';
import { placeTree } from './city.js';

/* ----------------------------- helpers ----------------------------- */

function wallGaps(world, horiz, fixed, lo, hi, h, t, mat, gaps) {
  let cur = lo;
  for (const g of [...gaps].sort((a, b) => a.at - b.at).concat([null])) {
    const end = g ? g.at - g.w / 2 : hi;
    if (end - cur > 0.5) {
      const c = (cur + end) / 2, len = end - cur;
      world.inst.push('bx_' + mat, horiz ? c : fixed, 0, horiz ? fixed : c, 0,
        horiz ? len : t, h, horiz ? t : len);
      world.colliders.push(horiz
        ? { x0: cur, x1: end, z0: fixed - t / 2, z1: fixed + t / 2, top: h }
        : { x0: fixed - t / 2, x1: fixed + t / 2, z0: cur, z1: end, top: h });
    }
    if (g) cur = g.at + g.w / 2;
  }
}

// Monumental gate: brick piers with passages, walkable platform, hall on top.
function pierGate(world, x, z, horiz, { n = 3, baseH = 7, depth = 16, hall = 'hallL', dark = true } = {}) {
  const inst = world.inst;
  const at = horiz ? x : z, fixed = horiz ? z : x;
  const pw = 6.5, pier = 4;
  const span = n * pw + (n + 1) * pier;
  const gw = span + 14;
  const pushAA = (key, c, f, y, len, t, h) =>
    inst.push('bx_' + key, horiz ? c : f, y, horiz ? f : c, 0, horiz ? len : t, h, horiz ? t : len);
  const colAA = (c0, c1, t, top) => world.colliders.push(horiz
    ? { x0: c0, x1: c1, z0: fixed - t / 2, z1: fixed + t / 2, top }
    : { x0: fixed - t / 2, x1: fixed + t / 2, z0: c0, z1: c1, top });
  pushAA('brick', at - (span / 2 + 3.5), fixed, 0, 7, depth, baseH);
  pushAA('brick', at + (span / 2 + 3.5), fixed, 0, 7, depth, baseH);
  colAA(at - gw / 2, at - span / 2, depth, baseH);
  colAA(at + span / 2, at + gw / 2, depth, baseH);
  let a = at - span / 2;
  for (let i = 0; i <= n; i++) {
    pushAA('brick', a + pier / 2, fixed, 0, pier, depth, 5.4);
    colAA(a - 0.2, a + pier + 0.2, depth, 5.4);
    a += pier + pw;
  }
  pushAA('brick', at, fixed, 5.4, span, depth, baseH - 5.4);
  world.regions.push(horiz
    ? { x0: at - gw / 2, x1: at + gw / 2, z0: fixed - depth / 2, z1: fixed + depth / 2, h0: baseH, h1: baseH }
    : { x0: fixed - depth / 2, x1: fixed + depth / 2, z0: at - gw / 2, z1: at + gw / 2, h0: baseH, h1: baseH });
  placeBuilding(world, hall, x, z, horiz ? 0 : Math.PI / 2,
    { baseY: baseH, platH: 0.4, tiers: 2, chiwei: true, dark, door: false });
  world.lanterns.push(x - (horiz ? span / 2 + 2 : 0), 4, z - (horiz ? 0 : span / 2 + 2));
  world.lanterns.push(x + (horiz ? span / 2 + 2 : 0), 4, z + (horiz ? 0 : span / 2 + 2));
}

// Walkable terrace block + matching height region.
function terrace(world, cx, cz, w, d, top, mat = 'stone') {
  world.inst.push('bx_' + mat, cx, 0, cz, 0, w, top, d);
  world.regions.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h0: top, h1: top });
}

// Stepped ramp + height region. axis 'z': hLo at zLo end.
function ramp(world, axis, lo, hi, fixed, w, hAtLo, hAtHi, mat = 'stone') {
  const r = axis === 'x'
    ? { x0: lo, x1: hi, z0: fixed - w / 2, z1: fixed + w / 2, h0: hAtLo, h1: hAtHi, axis: 'x' }
    : { x0: fixed - w / 2, x1: fixed + w / 2, z0: lo, z1: hi, h0: hAtLo, h1: hAtHi, axis: 'z' };
  world.regions.push(r);
  const steps = Math.max(3, Math.round(Math.abs(hAtHi - hAtLo) / 1.1));
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps;
    const c = lo + f * (hi - lo);
    const h = hAtLo + f * (hAtHi - hAtLo);
    if (h > 0.25)
      world.inst.push('bx_' + mat, axis === 'x' ? c : fixed, 0, axis === 'x' ? fixed : c, 0,
        axis === 'x' ? (hi - lo) / steps + 0.3 : w, h, axis === 'x' ? w : (hi - lo) / steps + 0.3);
  }
}

function lake(world, cx, cz, rx, rz) {
  const g = new THREE.CircleGeometry(1, 48);
  const mesh = new THREE.Mesh(g, world.mats.water);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(rx, rz, 1);
  mesh.position.set(cx, 0.32, cz);
  mesh.receiveShadow = true;
  world.scene.add(mesh);
  world.ellipses.push({ cx, cz, rx: rx - 2, rz: rz - 2 });
}

/* -------------------------- Imperial City -------------------------- */

export function buildImperialCity(world) {
  const { x0, x1, z0, z1 } = IMPCITY;
  // walls — south face has Zhuque Gate centre + Han'guang/Anshang gates
  wallGaps(world, true, z1, x0, x1, 6.5, 5, 'earth', [{ at: 0, w: 60 }, { at: -740, w: 14 }, { at: 740, w: 14 }]);
  wallGaps(world, true, z0, x0, x1, 6.5, 5, 'earth', [{ at: 0, w: 60 }, { at: -900, w: 14 }, { at: 900, w: 14 }]);
  wallGaps(world, false, x0, z0, z1, 6.5, 5, 'earth', [{ at: -1700, w: 14 }]);
  wallGaps(world, false, x1, z0, z1, 6.5, 5, 'earth', [{ at: -1700, w: 14 }]);
  pierGate(world, 0, z1, true, { n: 3, hall: 'hallL' });          // Zhuque Gate

  // ministry compounds in four columns flanking the Chengtian Gate street
  const colsX = [[-1440, -720], [-660, -80], [80, 660], [720, 1440]];
  for (const [cx0, cx1] of colsX) {
    for (let r = 0; r < 6; r++) {
      const cz0 = z0 + 35 + r * 305, cz1 = cz0 + 265;
      if (cz1 > z1 - 30) continue;
      const cx = (cx0 + cx1) / 2, cz = (cz0 + cz1) / 2;
      placeWallRect(world, cx0 + 12, cz0, cx1 - 12, cz1, 3.4, 0.7, 'plaster', { gaps: { s: 7 } });
      placeBuilding(world, 'hallL', cx, cz - 55, 0, { chiwei: true });
      placeBuilding(world, 'houseM', cx - 90, cz + 30, Math.PI / 2, { door: false });
      placeBuilding(world, 'houseM', cx + 90, cz + 30, -Math.PI / 2, { door: false });
      placeBuilding(world, 'houseM', cx, cz + 80, Math.PI, { door: false });
      if (world.rng.chance(0.6)) placeTree(world, cx + 40, cz + 60, 1.1);
    }
  }
}

/* -------------------------- Taiji Palace --------------------------- */

export function buildTaijiPalace(world) {
  const { x0, x1, z0, z1 } = PALACE;
  wallGaps(world, true, z1, x0, x1, 9, 6, 'earth', [{ at: 0, w: 58 }]);
  wallGaps(world, false, x0, z0, z1, 9, 6, 'earth', []);
  wallGaps(world, false, x1, z0, z1, 9, 6, 'earth', []);
  pierGate(world, 0, z1, true, { n: 3, baseH: 8, hall: 'hallXL' }); // Chengtian Gate

  // internal division walls: Yeting (west) | Taiji | East Palace
  wallGaps(world, false, -900, z0, z1, 6, 3, 'earth', [{ at: -3500, w: 10 }]);
  wallGaps(world, false, 900, z0, z1, 6, 3, 'earth', [{ at: -3500, w: 10 }]);

  // Taiji Hall on its terrace
  terrace(world, 0, -3300, 110, 60, 2.6);
  ramp(world, 'z', -3268, -3252, 0, 18, 2.6, 0);
  placeBuilding(world, 'hallXXL', 0, -3310, 0, { baseY: 2.6, platH: 0.5, tiers: 2, chiwei: true, dark: true });
  placeBuilding(world, 'hallM', -240, -3300, 0, { chiwei: true, dark: true });
  placeBuilding(world, 'hallM', 240, -3300, 0, { chiwei: true, dark: true });
  // courtyard gallery
  placeWallRect(world, -330, -3520, 330, -3120, 3, 0.8, 'plaster', { gaps: { s: 20, n: 14 } });

  // rear halls: Liangyi, Ganlu + garden
  placeBuilding(world, 'hallXL', 0, -3720, 0, { tiers: 2, chiwei: true, dark: true, platH: 1.6 });
  placeBuilding(world, 'hallL', 0, -3990, 0, { chiwei: true, dark: true });
  for (let i = 0; i < 28; i++)
    placeTree(world, world.rng.range(-700, 700), world.rng.range(-4240, -4060), world.rng.range(0.9, 1.4));

  // East Palace (crown prince) & Yeting quarters
  placeBuilding(world, 'hallL', 1190, -3450, 0, { chiwei: true, dark: true });
  placeBuilding(world, 'hallM', 1190, -3750, 0, { dark: true });
  placeBuilding(world, 'hallM', -1190, -3350, 0, { dark: true });
  placeBuilding(world, 'houseL', -1190, -3650, 0, {});
  placeBuilding(world, 'houseL', -1190, -3900, 0, {});
}

/* -------------------------- Daming Palace -------------------------- */

export function buildDamingPalace(world) {
  const inst = world.inst, rng = world.rng;
  const ax = DAMING.gateX; // 1250 — the great axis

  // slanted west / east walls + north wall (visual: rotated boxes; colliders: chained AABBs)
  const slant = (xS, xN) => {
    const dz = DAMING.nz - DAMING.sz, dx = xN - xS;
    const len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
    const segs = 3, n = 46;
    for (let i = 0; i < segs; i++) {
      const f = (i + 0.5) / segs;
      inst.push('bx_earth', xS + dx * f, 0, DAMING.sz + dz * f, -ang - Math.PI, len / segs + 2, 8, 5.5);
    }
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const cx = xS + dx * f, cz = DAMING.sz + dz * f;
      world.colliders.push({ x0: cx - 4, x1: cx + 4, z0: cz - len / n / 2 - 1, z1: cz + len / n / 2 + 1, top: 8 });
    }
  };
  slant(DAMING.sx0, DAMING.nx0);
  slant(DAMING.sx1, DAMING.nx1);
  wallGaps(world, true, DAMING.nz, DAMING.nx0, DAMING.nx1, 8, 5.5, 'earth', [{ at: (DAMING.nx0 + DAMING.nx1) / 2, w: 40 }]);
  pierGate(world, (DAMING.nx0 + DAMING.nx1) / 2, DAMING.nz, true, { n: 3, hall: 'hallL' }); // Xuanwu Gate

  // ----- Hanyuan Hall on the triple terrace, with the Dragon-Tail Way -----
  terrace(world, ax, -5020, 116, 62, 5);
  terrace(world, ax, -5032, 92, 44, 9);
  terrace(world, ax, -5040, 70, 32, 12);
  ramp(world, 'z', -5010, -4996, ax, 12, 9, 5);    // T1 → T2
  ramp(world, 'z', -5024, -5012, ax, 10, 12, 9);   // T2 → T3
  ramp(world, 'z', -4989, -4865, ax - 22, 26, 5, 0); // Dragon-Tail Way, west lane
  ramp(world, 'z', -4989, -4865, ax + 22, 26, 5, 0); // east lane
  placeBuilding(world, 'hallXXL', ax, -5045, 0, { baseY: 12, platH: 1.8, tiers: 2, chiwei: true, dark: true, door: true });

  // flanking pavilion towers: Xiangluan (E) & Qifeng (W), linked by galleries
  for (const dir of [-1, 1]) {
    const px = ax + dir * 185;
    inst.push('bx_brick', px, 0, -4945, 0, 20, 10, 20);
    addCollider(world, px, -4945, 20, 20, 10);
    placePavilion(world, px, -4945, { size: 11, h: 3.8, baseY: 10, dark: true, twoStory: true });
    // gallery toward the terrace
    const gx0 = dir > 0 ? ax + 60 : px + 10, gx1 = dir > 0 ? px - 10 : ax - 60;
    for (let x = gx0 + 6; x < gx1 - 5; x += 12) {
      inst.push('bx_plaster', x, 0, -4945, 0, 12.2, 2.6, 1.4);
      inst.push('roof_corr', x, 2.6, -4945, 0, 1, 1, 1);
    }
    world.colliders.push({ x0: gx0, x1: gx1, z0: -4945.9, z1: -4944.1, top: 2.6 });
  }

  // great audience court between Danfeng Gate and Hanyuan
  for (let z = -4480; z > -4900; z -= 70) {
    world.lanterns.push(ax - 38, 3.5, z); world.lanterns.push(ax + 38, 3.5, z);
  }

  // ----- Xuanzheng & Zichen halls -----
  placeWallRect(world, ax - 220, -5600, ax + 220, -5380, 4, 1, 'earth', { gaps: { s: 24, n: 14 } });
  placeBuilding(world, 'hallXL', ax, -5520, 0, { platH: 1.8, tiers: 2, chiwei: true, dark: true });
  placeBuilding(world, 'hallM', ax - 150, -5500, 0, { dark: true });
  placeBuilding(world, 'hallM', ax + 150, -5500, 0, { dark: true });
  placeBuilding(world, 'hallL', ax, -5790, 0, { platH: 1.4, tiers: 2, chiwei: true, dark: true });

  // ----- Taiye Pool with Penglai isle -----
  lake(world, TAIYE.cx, TAIYE.cz, TAIYE.rx, TAIYE.rz);
  terrace(world, 1380, -6080, 36, 28, 1.3, 'stone');
  placePavilion(world, 1380, -6084, { size: 8, h: 3.2, baseY: 1.3, dark: true });
  // bridge to the south shore
  inst.push('bx_stone', 1380, 0.05, -5945, 0, 4.5, 0.9, 175);
  world.regions.push({ x0: 1377.7, x1: 1382.3, z0: -6066, z1: -5857, h0: 0.95, h1: 0.95 });
  for (let i = 0; i < 70; i++) {
    const a = rng.f() * Math.PI * 2, rr = rng.range(1.06, 1.35);
    placeTree(world, TAIYE.cx + Math.cos(a) * TAIYE.rx * rr, TAIYE.cz + Math.sin(a) * TAIYE.rz * rr, rng.range(0.9, 1.3), true);
  }

  // ----- Linde Hall (triple hall, banquets & embassies) -----
  terrace(world, 700, -6000, 70, 110, 2.4);
  ramp(world, 'z', -5944, -5930, 700, 16, 2.4, 0);
  placeBuilding(world, 'hallXL', 700, -5975, 0, { baseY: 2.4, platH: 0.3, chiwei: true, dark: true });
  placeBuilding(world, 'hallXL', 700, -6005, 0, { baseY: 2.4, platH: 0.3, tiers: 2, chiwei: true, dark: true });
  placeBuilding(world, 'hallL', 700, -6033, 0, { baseY: 2.4, platH: 0.3, chiwei: true, dark: true });

  // palace gardens
  for (let i = 0; i < 60; i++)
    placeTree(world, rng.range(550, 1950), rng.range(-6560, -5600), rng.range(0.9, 1.35));
}

/* -------------------------- Xingqing Palace ------------------------ */

export function buildXingqingPalace(world) {
  const { x0, x1, z0, z1 } = XINGQING;
  placeWallRect(world, x0 + 3, z0 + 3, x1 - 3, z1 - 3, 5.5, 3, 'earth', { gaps: { w: 14, s: 14, n: 14 } });
  placeBuilding(world, 'hallXL', 3080, -480, 0, { tiers: 2, chiwei: true, dark: true, platH: 1.6 });
  placeBuilding(world, 'hallM', 3340, -350, 0, { dark: true });
  // Hall for Cultivating Government (two storeys, at the SW corner over the street)
  placeBuilding(world, 'hallL', 2640, -180, Math.PI, { tiers: 2, chiwei: true, dark: true });
  lake(world, LONGCHI.cx, LONGCHI.cz, LONGCHI.rx, LONGCHI.rz);   // Dragon Pond
  placePavilion(world, 2940, -460, { size: 8, h: 3.4, dark: true }); // Aloeswood Pavilion
  for (let i = 0; i < 26; i++) {
    const a = world.rng.f() * Math.PI * 2;
    placeTree(world, LONGCHI.cx + Math.cos(a) * LONGCHI.rx * world.rng.range(1.1, 1.5),
      LONGCHI.cz + Math.sin(a) * LONGCHI.rz * world.rng.range(1.15, 1.7), 1.1, true);
  }
}

/* ----------------------- monasteries & pagodas --------------------- */

export function buildMonasteries(world) {
  // Ci'en Monastery + Giant Wild Goose Pagoda (Jinchang Ward)
  {
    const cx = 1955, cz = 1516;
    placeWallRect(world, cx - 130, cz - 140, cx + 130, cz + 140, 3, 0.8, 'plaster', { gaps: { s: 8 } });
    placeBuilding(world, 'hallXL', cx, cz - 75, 0, { chiwei: true, tiers: 2 });
    placeBuilding(world, 'hallM', cx - 80, cz - 20, Math.PI / 2, { door: false });
    placeBuilding(world, 'hallM', cx + 80, cz - 20, -Math.PI / 2, { door: false });
    placePagoda(world, cx, cz + 55, { tiers: 7, base: 25, height: 62 });
    for (let i = 0; i < 12; i++)
      placeTree(world, cx + world.rng.range(-115, 115), cz + world.rng.range(95, 130), world.rng.range(1, 1.4));
    world.lanterns.push(cx - 10, 3, cz + 20, cx + 10, 3, cz + 20);
  }
  // Jianfu Monastery + Small Wild Goose Pagoda (Anren Ward)
  {
    const cx = -355, cz = 867;
    placeWallRect(world, cx - 90, cz - 100, cx + 90, cz + 100, 3, 0.7, 'plaster', { gaps: { s: 7 } });
    placeBuilding(world, 'hallL', cx, cz - 45, 0, { chiwei: true });
    placePagoda(world, cx, cz + 35, { tiers: 11, base: 13, height: 44 });
    for (let i = 0; i < 8; i++)
      placeTree(world, cx + world.rng.range(-80, 80), cz + world.rng.range(70, 92), world.rng.range(0.9, 1.3));
  }
  // Daxingshan Monastery (Jingshan Ward) — oldest in the capital
  {
    const cx = 355, cz = 2781;
    placeWallRect(world, cx - 200, cz - 210, cx + 200, cz + 210, 3.2, 0.8, 'plaster', { gaps: { s: 9, n: 7 } });
    placeBuilding(world, 'hallXL', cx, cz - 110, 0, { chiwei: true, tiers: 2 });
    placeBuilding(world, 'hallL', cx, cz + 10, 0, { chiwei: true });
    placeBuilding(world, 'hallM', cx - 120, cz - 40, Math.PI / 2, { door: false });
    placeBuilding(world, 'hallM', cx + 120, cz - 40, -Math.PI / 2, { door: false });
    for (let i = 0; i < 20; i++)
      placeTree(world, cx + world.rng.range(-180, 180), cz + world.rng.range(90, 195), world.rng.range(1, 1.5));
    world.lanterns.push(cx, 3, cz - 60);
  }
}

/* ------------------------ Qujiang & Lotus Garden -------------------- */

export function buildQujiang(world) {
  const rng = world.rng;
  const { x0, x1, z0, z1 } = QUJIANG;
  placeWallRect(world, x0 + 3, z0 + 3, x1 - 3, z1 - 3, 3.5, 1, 'earth', { gaps: { n: 12, w: 12 } });
  const L = QUJIANG.lake;
  lake(world, L.cx, L.cz, L.rx, L.rz);
  // Ziyun Tower on the north shore
  placeBuilding(world, 'hallL', 4040, 3215, 0, { platH: 3, tiers: 2, chiwei: true, dark: true });
  // lakeside pavilions
  for (const [a, rr] of [[2.6, 1.18], [3.4, 1.22], [4.4, 1.2]]) {
    placePavilion(world, L.cx + Math.cos(a) * L.rx * rr, L.cz + Math.sin(a) * L.rz * rr, { size: 7, h: 3.2 });
  }
  for (let i = 0; i < 90; i++) {
    const a = rng.f() * Math.PI * 2, rr = rng.range(1.08, 1.6);
    const x = L.cx + Math.cos(a) * L.rx * rr, z = L.cz + Math.sin(a) * L.rz * rr;
    if (x > x0 + 12 && x < x1 - 12 && z > z0 + 12 && z < z1 - 12)
      placeTree(world, x, z, rng.range(0.95, 1.45), rng.chance(0.6));
  }
}
