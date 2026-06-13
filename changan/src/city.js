// Outer walls, gates, the 100+ residential wards, the two great markets, street trees.
import * as THREE from 'three';
import { CITY, GATES, STREETS_V, STREETS_H, E_MARKET, W_MARKET, DAMING } from './layout.js';
import { placeBuilding, placeWallRect, placePavilion, addCollider } from './parts.js';

const C = (h, s, l) => new THREE.Color().setHSL(h, s, l);

export function placeTree(world, x, z, scale = 1, willow = false) {
  const inst = world.inst, rng = world.rng;
  const th = rng.range(2.1, 3.1) * scale;
  const cr = rng.range(2.0, 3.2) * scale;
  inst.push('treeTrunk', x, 0, z, rng.f() * 6.3, 1, th, 1);
  inst.push('treeCanopy', x, th + cr * 0.55, z, rng.f() * 6.3, cr, cr * (willow ? 1.15 : 1), cr,
    willow ? C(0.26, 0.32, rng.range(0.3, 0.4)) : C(rng.range(0.22, 0.3), rng.range(0.3, 0.45), rng.range(0.3, 0.42)));
}

/* --------------------------- outer walls --------------------------- */

export function buildOuterWalls(world) {
  const inst = world.inst;
  const { hw, hd, wallH, wallT } = CITY;

  const sides = {
    s: { horiz: true, fixed: hd - wallT / 2, lo: -hw, hi: hw, out: +1 },
    n: { horiz: true, fixed: -hd + wallT / 2, lo: -hw, hi: hw, out: -1 },
    e: { horiz: false, fixed: hw - wallT / 2, lo: -hd, hi: hd, out: +1 },
    w: { horiz: false, fixed: -hw + wallT / 2, lo: -hd, hi: hd, out: -1 },
  };
  const pushAA = (key, c, fixed, y, len, t, h, horiz) =>
    inst.push('bx_' + key, horiz ? c : fixed, y, horiz ? fixed : c, 0, horiz ? len : t, h, horiz ? t : len);

  for (const [sideKey, S] of Object.entries(sides)) {
    const gates = GATES.filter((g) => g.side === sideKey).sort((a, b) => a.at - b.at);
    // wall segments between gates
    let cursor = S.lo;
    const ghw = (g) => (g.n === 5 ? 42 : 27);
    for (const g of gates.concat([null])) {
      const end = g ? g.at - ghw(g) : S.hi;
      const len = end - cursor;
      if (len > 1) {
        const c = (cursor + end) / 2;
        pushAA('earth', c, S.fixed, 0, len, wallT, wallH, S.horiz);
        // parapets
        const po = S.fixed + S.out * (wallT / 2 - 0.35);
        const pi = S.fixed - S.out * (wallT / 2 - 0.3);
        pushAA('earth', c, po, wallH, len, 0.7, 1.9, S.horiz);
        pushAA('earth', c, pi, wallH, len, 0.6, 0.6, S.horiz);
        // colliders: wall body + parapets (parapets stop you walking off the top)
        const colAA = (fx, t, top) => world.colliders.push(S.horiz
          ? { x0: cursor, x1: end, z0: fx - t / 2, z1: fx + t / 2, top }
          : { x0: fx - t / 2, x1: fx + t / 2, z0: cursor, z1: end, top });
        colAA(S.fixed, wallT, wallH);
        colAA(po, 0.7, wallH + 1.9);
        colAA(pi, 0.6, wallH + 0.6);
      }
      if (g) {
        buildGate(world, S, g, ghw(g));
        cursor = g.at + ghw(g);
      }
    }
    // skip walkable strip where Daming Palace straddles the north wall
    world.regions.push(S.horiz
      ? { x0: S.lo, x1: S.hi, z0: S.fixed - wallT / 2, z1: S.fixed + wallT / 2, h0: wallH, h1: wallH }
      : { x0: S.fixed - wallT / 2, x1: S.fixed + wallT / 2, z0: S.lo, z1: S.hi, h0: wallH, h1: wallH });

    // bastions (mamian) every ~280 m
    for (let a = S.lo + 240; a < S.hi - 240; a += 280) {
      if (gates.some((g) => Math.abs(a - g.at) < 110)) continue;
      if (sideKey === 'n' && a > DAMING.sx0 - 40 && a < DAMING.sx1 + 40) continue;
      const f = S.fixed + S.out * (wallT / 2 + 3);
      pushAA('earth', a, f, 0, 15, 8, wallH + 0.8, S.horiz);
    }
  }

  // corner towers
  for (const [cx, cz] of [[hw - 10, hd - 10], [-hw + 10, hd - 10], [hw - 10, -hd + 10], [-hw + 10, -hd + 10]]) {
    inst.push('bx_earth', cx, 0, cz, 0, 24, wallH + 2, 24);
    placePavilion(world, cx, cz, { size: 11, h: 3.6, baseY: wallH + 2, dark: true, twoStory: true });
    addCollider(world, cx, cz, 24, 24, wallH + 2);
  }
}

function buildGate(world, S, g, ghw) {
  const inst = world.inst;
  const { wallH, wallT } = CITY;
  const horiz = S.horiz;
  const at = g.at, fixed = S.fixed;
  const depth = wallT + 9;
  const gw = ghw * 2;

  const pushAA = (key, c, f, y, len, t, h) =>
    inst.push('bx_' + key, horiz ? c : f, y, horiz ? f : c, 0, horiz ? len : t, h, horiz ? t : len);
  const colAA = (c0, c1, f, t, top) => world.colliders.push(horiz
    ? { x0: c0, x1: c1, z0: f - t / 2, z1: f + t / 2, top }
    : { x0: f - t / 2, x1: f + t / 2, z0: c0, z1: c1, top });

  // piers + passages
  const pw = 6.5, pier = 4;
  const span = g.n * pw + (g.n + 1) * pier;
  let a = at - span / 2;
  pushAA('brick', at - (span / 2 + (gw - span) / 4), fixed, 0, (gw - span) / 2, depth, wallH); // side blocks
  pushAA('brick', at + (span / 2 + (gw - span) / 4), fixed, 0, (gw - span) / 2, depth, wallH);
  colAA(at - gw / 2, at - span / 2, fixed, depth, wallH);
  colAA(at + span / 2, at + gw / 2, fixed, depth, wallH);
  for (let i = 0; i <= g.n; i++) {
    pushAA('brick', a + pier / 2, fixed, 0, pier, depth, 5.6);
    colAA(a - 0.2, a + pier + 0.2, fixed, depth, 5.6);
    a += pier + pw;
  }
  pushAA('brick', at, fixed, 5.6, span, depth, wallH - 5.6);  // lintel over all passages
  world.regions.push(horiz
    ? { x0: at - gw / 2, x1: at + gw / 2, z0: fixed - depth / 2, z1: fixed + depth / 2, h0: wallH, h1: wallH }
    : { x0: fixed - depth / 2, x1: fixed + depth / 2, z0: at - gw / 2, z1: at + gw / 2, h0: wallH, h1: wallH });

  // gatehouse on top
  const ry = horiz ? 0 : Math.PI / 2;
  placeBuilding(world, g.n === 5 ? 'hallXL' : 'hallL', horiz ? at : fixed, horiz ? fixed : at, ry,
    { baseY: wallH, platH: 0.4, tiers: 2, chiwei: true, dark: true, door: false });

  // horse ramps (madao) on the inner face, both sides of the gate
  const rampL = 46, rampW = 7.5;
  const rin = fixed - S.out * (wallT / 2 + rampW / 2 - 1);
  for (const dir of [-1, 1]) {
    const a0 = at + dir * ghw, a1 = at + dir * (ghw + rampL);
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    world.regions.push(horiz
      ? { x0: lo, x1: hi, z0: rin - rampW / 2, z1: rin + rampW / 2, h0: dir > 0 ? wallH : 0, h1: dir > 0 ? 0 : wallH, axis: 'x' }
      : { x0: rin - rampW / 2, x1: rin + rampW / 2, z0: lo, z1: hi, h0: dir > 0 ? wallH : 0, h1: dir > 0 ? 0 : wallH, axis: 'z' });
    // stepped visual
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const f = (i + 0.5) / steps;
      const c = at + dir * (ghw + f * rampL);
      const h = wallH * (1 - f);
      if (h > 0.3) pushAA('brick', c, rin, 0, rampL / steps + 0.3, rampW, h);
    }
  }

  // bridge over the moat
  const bf = fixed + S.out * (wallT / 2 + 22);
  pushAA('stone', at, bf, 0, gw * 0.7, 46, 0.5);

  // lanterns flanking the gate
  for (const dir of [-1, 1]) {
    const lx = horiz ? at + dir * (span / 2 + 2) : fixed - S.out * (wallT / 2 + 2);
    const lz = horiz ? fixed - S.out * (wallT / 2 + 2) : at + dir * (span / 2 + 2);
    world.lanterns.push(lx, 4, lz);
  }
}

/* ------------------------------ wards ------------------------------ */

export function buildWardsGeo(world, wards) {
  const rng = world.rng;
  for (const w of wards) {
    if (w.skipGeo) continue;
    const wx = (w.x0 + w.x1) / 2, wz = (w.z0 + w.z1) / 2;
    // ward wall with a gate at the centre of each side
    placeWallRect(world, w.x0 + 2, w.z0 + 2, w.x1 - 2, w.z1 - 2, 3, 0.8, 'earth',
      { gaps: { n: 8, s: 8, e: 8, w: 8 } });

    if (w.south) { // farmland: a few farmhouses among the fields
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const x = rng.range(w.x0 + 40, w.x1 - 40), z = rng.range(w.z0 + 40, w.z1 - 40);
        placeBuilding(world, 'houseS', x, z, rng.int(0, 3) * Math.PI / 2, { platH: 0.2 });
        if (rng.chance(0.8)) placeTree(world, x + rng.range(-15, 15), z + rng.range(-15, 15));
      }
      for (let i = 0; i < 5; i++)
        placeTree(world, rng.range(w.x0 + 20, w.x1 - 20), rng.range(w.z0 + 20, w.z1 - 20));
      continue;
    }

    // four quadrants around the internal cross lanes
    const laneHw = 8;
    const quads = [
      [w.x0 + 8, wx - laneHw, w.z0 + 8, wz - laneHw], [wx + laneHw, w.x1 - 8, w.z0 + 8, wz - laneHw],
      [w.x0 + 8, wx - laneHw, wz + laneHw, w.z1 - 8], [wx + laneHw, w.x1 - 8, wz + laneHw, w.z1 - 8],
    ];
    let templeDone = false;
    for (const [qx0, qx1, qz0, qz1] of quads) {
      // small Buddhist/Daoist temple in some wards
      if (!templeDone && w.temple && qx1 - qx0 > 90 && qz1 - qz0 > 90) {
        buildSmallTemple(world, (qx0 + qx1) / 2, (qz0 + qz1) / 2);
        templeDone = true;
        continue;
      }
      const cw = 30, cd = 27; // compound cell
      const nx = Math.max(1, Math.floor((qx1 - qx0) / cw));
      const nz = Math.max(1, Math.floor((qz1 - qz0) / cd));
      const target = Math.min(nx * nz, w.rich ? 8 : 6);
      const cells = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) cells.push([i, j]);
      // sample without replacement
      for (let k = 0; k < target && cells.length; k++) {
        const [i, j] = cells.splice(rng.int(0, cells.length - 1), 1)[0];
        const cx = qx0 + (i + 0.5) * ((qx1 - qx0) / nx) + rng.range(-2, 2);
        const cz = qz0 + (j + 0.5) * ((qz1 - qz0) / nz) + rng.range(-2, 2);
        buildCompound(world, cx, cz, w.rich && rng.chance(0.45));
      }
    }
  }
}

function buildCompound(world, cx, cz, rich) {
  const rng = world.rng;
  const w = rich ? 27 : 23, d = rich ? 24 : 20;
  placeWallRect(world, cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 2.2, 0.45, 'plaster',
    { gaps: { s: 3.6 } });
  // main house on the north side, door facing south
  placeBuilding(world, rich ? 'houseL' : 'houseM', cx, cz - d / 2 + (rich ? 6.5 : 5.5), 0, {});
  if (rng.chance(rich ? 0.9 : 0.55)) // west wing
    placeBuilding(world, 'houseS', cx - w / 2 + 4.2, cz + d * 0.16, Math.PI / 2, { door: false });
  if (rich && rng.chance(0.6))       // east wing
    placeBuilding(world, 'houseS', cx + w / 2 - 4.2, cz + d * 0.16, -Math.PI / 2, { door: false });
  if (rng.chance(0.6))
    placeTree(world, cx + rng.range(2, w / 2 - 3), cz + rng.range(1, d / 2 - 3), rng.range(0.7, 1.05));
}

function buildSmallTemple(world, cx, cz) {
  placeWallRect(world, cx - 55, cz - 50, cx + 55, cz + 50, 2.8, 0.6, 'plaster', { gaps: { s: 6 } });
  placeBuilding(world, 'hallM', cx, cz - 18, 0, { chiwei: true, door: true });
  placeBuilding(world, 'houseM', cx - 32, cz + 8, Math.PI / 2, { door: false });
  placeBuilding(world, 'houseM', cx + 32, cz + 8, -Math.PI / 2, { door: false });
  if (world.rng.chance(0.5))
    world.inst.push('bx_brick', cx + 20, 0, cz + 30, 0, 6, 14, 6), // simple stupa-tower
      world.inst.push('roofd_tier', cx + 20, 14, cz + 30, 0, 0.7, 0.7, 0.7);
  placeTree(world, cx - 18, cz + 28, 1.15);
  placeTree(world, cx + 8, cz + 32, 1.0);
  world.lanterns.push(cx, 3, cz - 8);
}

/* ----------------------------- markets ----------------------------- */

export function buildMarkets(world) {
  for (const M of [E_MARKET, W_MARKET]) buildMarket(world, M, M === W_MARKET);
}

function buildMarket(world, M, west) {
  const inst = world.inst, rng = world.rng;
  const x0 = M.x0 + 4, x1 = M.x1 - 4, z0 = M.z0 + 4, z1 = M.z1 - 4;
  const W = x1 - x0, D = z1 - z0;
  placeWallRect(world, x0, z0, x1, z1, 4.2, 1.4, 'earth', { gaps: { n: 12, s: 12, e: 12, w: 12 } });

  // two cross streets each way → nine blocks
  const sx = [x0 + W / 3, x0 + (2 * W) / 3];
  const sz = [z0 + D / 3, z0 + (2 * D) / 3];
  const stHw = 8;

  // shops around the edge of each block, facing the internal streets
  const blocks = [];
  for (let bi = 0; bi < 3; bi++) for (let bj = 0; bj < 3; bj++) {
    const bx0 = (bi === 0 ? x0 + 6 : sx[bi - 1] + stHw), bx1 = (bi === 2 ? x1 - 6 : sx[bi] - stHw);
    const bz0 = (bj === 0 ? z0 + 6 : sz[bj - 1] + stHw), bz1 = (bj === 2 ? z1 - 6 : sz[bj] - stHw);
    blocks.push([bx0, bx1, bz0, bz1, bi, bj]);
  }
  for (const [bx0, bx1, bz0, bz1, bi, bj] of blocks) {
    if (bi === 1 && bj === 1) { // market administration + flag tower
      placeWallRect(world, bx0 + 30, bz0 + 30, bx1 - 30, bz1 - 30, 3, 0.7, 'plaster', { gaps: { s: 6 } });
      placeBuilding(world, 'hallL', (bx0 + bx1) / 2, (bz0 + bz1) / 2 - 20, 0, { chiwei: true });
      placePavilion(world, (bx0 + bx1) / 2, (bz0 + bz1) / 2 + 45, { size: 9, h: 4, twoStory: true });
      continue;
    }
    const along = (a0, a1, fz, ry, horiz) => {
      for (let a = a0 + 14; a < a1 - 14; a += rng.range(26, 31)) {
        const x = horiz ? a : fz, z = horiz ? fz : a;
        placeBuilding(world, 'shop', x, z, ry, { door: false });
      }
    };
    along(bx0, bx1, bz0 + 5, Math.PI, true);   // north edge faces north street
    along(bx0, bx1, bz1 - 5, 0, true);
    along(bz0, bz1, bx0 + 5, -Math.PI / 2, false);
    along(bz0, bz1, bx1 - 5, Math.PI / 2, false);
    // storehouses inside
    for (let i = 0; i < 3; i++)
      if (rng.chance(0.7))
        placeBuilding(world, 'houseM', rng.range(bx0 + 30, bx1 - 30), rng.range(bz0 + 30, bz1 - 30),
          rng.int(0, 3) * Math.PI / 2, { door: false });
  }

  // stalls along the internal streets
  const stallColors = [0xc04a3a, 0x3a7a5a, 0xb08830, 0x4a5a9a, 0xa05a80, 0xddccaa];
  const goodsColors = [0xc8b070, 0x8a4a30, 0xd0d0c0, 0x607a40, 0x9a3030, 0xc0a0d0];
  const addStall = (x, z, ry) => {
    inst.push('stall', x, 0, z, ry);
    inst.push('awning', x, 2.15, z, ry, 1, 1, 1, new THREE.Color(rng.pick(stallColors)), -0.16, 0);
    for (let gI = 0; gI < rng.int(1, 3); gI++) {
      const [ox, oz] = [rng.range(-0.8, 0.8), rng.range(-0.25, 0.25)];
      inst.push('goods', x + ox * Math.cos(ry) + oz * Math.sin(ry), 0.9, z - ox * Math.sin(ry) + oz * Math.cos(ry),
        rng.f(), rng.range(0.7, 1.3), rng.range(0.6, 1.4), rng.range(0.7, 1.3), new THREE.Color(rng.pick(goodsColors)));
    }
    world.stalls.push({ x, z });
    if (rng.chance(0.5)) world.lanterns.push(x, 2.6, z);
  };
  for (const vx of sx) {
    for (let z = z0 + 26; z < z1 - 26; z += 17)
      if (rng.chance(0.62)) addStall(vx + (rng.chance(0.5) ? stHw - 2.4 : -(stHw - 2.4)), z, rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
  }
  for (const hz of sz) {
    for (let x = x0 + 26; x < x1 - 26; x += 17)
      if (rng.chance(0.62)) addStall(x, hz + (rng.chance(0.5) ? stHw - 2.4 : -(stHw - 2.4)), rng.chance(0.5) ? 0 : Math.PI);
  }

  // caravan animals & carts
  const plazaX = x0 + W / 6, plazaZ = z0 + D / 6;
  if (west) for (let i = 0; i < 9; i++)
    inst.push('camel', plazaX + rng.range(-30, 30), 0, plazaZ + rng.range(-30, 30), rng.f() * 6.3);
  for (let i = 0; i < 6; i++) {
    const cx2 = rng.range(x0 + 40, x1 - 40), cz2 = rng.range(z0 + D * 0.6, z1 - 30);
    const ry = rng.f() * 6.3;
    inst.push('cart', cx2, 0, cz2, ry);
    if (rng.chance(0.6)) inst.push('ox', cx2 + 2.6 * Math.cos(ry), 0, cz2 - 2.6 * Math.sin(ry), ry);
  }
}

/* --------------------------- street trees --------------------------- */

export function buildStreetTrees(world) {
  const rng = world.rng;
  const hCross = STREETS_H.map((s) => [s.z, s.w]);
  const vCross = STREETS_V.map((s) => [s.x, s.w]);
  const nearAny = (v, list) => list.some(([c, w]) => Math.abs(v - c) < w / 2 + 9);

  for (const s of STREETS_V) {
    const offs = [-(s.w / 2 - 7), s.w / 2 - 7];
    if (s.zhuque) offs.push(-34, 34);
    for (const off of offs) {
      for (let z = s.z0 + 16; z < s.z1 - 16; z += 26) {
        if (nearAny(z, hCross)) continue;
        if (rng.chance(0.08)) continue;
        placeTree(world, s.x + off + rng.range(-1.5, 1.5), z + rng.range(-4, 4), rng.range(0.9, 1.25));
      }
    }
  }
  for (const s of STREETS_H) {
    const spans = s.splitPalace
      ? [[-CITY.hw + 30, -1490], [1490, CITY.hw - 30]]
      : [[-CITY.hw + 30, CITY.hw - 30]];
    for (const [a0, a1] of spans) {
      for (const off of [-(s.w / 2 - 7), s.w / 2 - 7]) {
        for (let x = a0 + 16; x < a1 - 16; x += 28) {
          if (nearAny(x, vCross)) continue;
          if (rng.chance(0.1)) continue;
          placeTree(world, x + rng.range(-4, 4), s.z + off + rng.range(-1.5, 1.5), rng.range(0.9, 1.2));
        }
      }
    }
  }
}
