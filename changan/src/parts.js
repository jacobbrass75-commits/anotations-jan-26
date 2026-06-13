// Geometry factories, the instancing registry, and Tang-architecture placement helpers.
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Instancer: every repeated part goes into per-sector InstancedMeshes */
/* ------------------------------------------------------------------ */

const SECTOR = 3400; // metres per culling sector

export class Instancer {
  constructor(scene) {
    this.scene = scene;
    this.bins = new Map();
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
  }
  def(key, geom, mat, { shadow = true, colored = false, sectors = true, receive = true } = {}) {
    geom.computeBoundingSphere();
    this.bins.set(key, { geom, mat, shadow, colored, sectors, receive, items: [] });
  }
  push(key, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, color = null, rx = 0, rz = 0) {
    const bin = this.bins.get(key);
    if (!bin) throw new Error('unknown part: ' + key);
    bin.items.push({ x, y, z, ry, rx, rz, sx, sy, sz, color });
  }
  build() {
    let meshes = 0, instances = 0;
    for (const [key, bin] of this.bins) {
      if (!bin.items.length) continue;
      // bucket items by sector for frustum culling
      const buckets = new Map();
      for (const it of bin.items) {
        const k = bin.sectors
          ? `${Math.floor(it.x / SECTOR)}|${Math.floor(it.z / SECTOR)}` : '0';
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(it);
      }
      for (const items of buckets.values()) {
        const mesh = new THREE.InstancedMesh(bin.geom, bin.mat, items.length);
        const bb = new THREE.Box3();
        let maxS = 1;
        items.forEach((it, i) => {
          this._p.set(it.x, it.y, it.z);
          this._e.set(it.rx, it.ry, it.rz);
          this._q.setFromEuler(this._e);
          this._s.set(it.sx, it.sy, it.sz);
          this._m.compose(this._p, this._q, this._s);
          mesh.setMatrixAt(i, this._m);
          if (bin.colored) mesh.setColorAt(i, it.color || WHITE);
          bb.expandByPoint(this._p);
          maxS = Math.max(maxS, it.sx, it.sy, it.sz);
        });
        const sphere = new THREE.Sphere();
        bb.getBoundingSphere(sphere);
        sphere.radius += bin.geom.boundingSphere.radius * maxS;
        mesh.boundingSphere = sphere;
        mesh.castShadow = bin.shadow;
        mesh.receiveShadow = bin.receive;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.scene.add(mesh);
        meshes++; instances += items.length;
      }
      bin.items.length = 0;
    }
    return { meshes, instances };
  }
}
const WHITE = new THREE.Color(1, 1, 1);

/* --------------------------- geometry ----------------------------- */

// Unit box whose origin sits at the bottom centre — scaled per instance.
export function unitBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

// Concave Tang roof shell with upturned eave corners.
// w,d: building footprint. h: roof rise. ridge: ridge length as fraction of w
// (≈0 → hip/pyramid, ≈1 → gable). over: eave overhang. up: corner lift.
export function roofGeo({ w, d, h, ridge = 0.14, over = 1.1, up = 0.5, M = 6, N = 5, thick = 0.4 }) {
  const hw = w / 2 + over, hd = d / 2 + over;
  const rh = Math.max(0.02, (w / 2) * ridge);
  const P = 4 * M;
  const pos = [], uv = [], idx = [];
  const slope = Math.hypot(hd, h);

  const ringPoint = (t, k) => {
    const y = h * Math.pow(t, 1.55);
    const hx = hw + (rh - hw) * t;
    const hz = hd * (1 - t) + 0.001;
    const s = Math.floor(k / M), f = (k % M) / M;
    let x, z;
    if (s === 0) { x = -hx + 2 * hx * f; z = hz; }
    else if (s === 1) { x = hx; z = hz - 2 * hz * f; }
    else if (s === 2) { x = hx - 2 * hx * f; z = -hz; }
    else { x = -hx; z = -hz + 2 * hz * f; }
    const lift = up * Math.pow(Math.abs(x / hx) * Math.abs(z / hz), 5) * (1 - t);
    return [x, y + lift, z];
  };

  // top shell rings
  for (let j = 0; j <= N; j++) {
    const t = j / N;
    for (let k = 0; k < P; k++) {
      const p = ringPoint(t, k);
      pos.push(p[0], p[1], p[2]);
      uv.push((k / P) * Math.round((hw + hd) / 1.4) * 2, t * Math.max(1, Math.round(slope / 1.8)));
    }
  }
  for (let j = 0; j < N; j++) for (let k = 0; k < P; k++) {
    const a = j * P + k, b = j * P + ((k + 1) % P);
    const c = (j + 1) * P + ((k + 1) % P), e = (j + 1) * P + k;
    idx.push(a, b, c, a, c, e);
  }
  // eave fascia band (drop the bottom ring down by `thick`)
  const B = (N + 1) * P;
  for (let k = 0; k < P; k++) {
    const p = ringPoint(0, k);
    pos.push(p[0], p[1] - thick, p[2]);
    uv.push((k / P) * Math.round((hw + hd) / 1.4) * 2, -0.25);
  }
  for (let k = 0; k < P; k++) {
    const a = k, b = B + k, c = B + ((k + 1) % P), e = (k + 1) % P;
    idx.push(a, b, c, a, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Merge simple geometries (used for props: trees, people, camels, carts).
export function mergeGeoms(list) {
  const geoms = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let vtx = 0;
  for (const g of geoms) vtx += g.attributes.position.count;
  const pos = new Float32Array(vtx * 3), nor = new Float32Array(vtx * 3), uv = new Float32Array(vtx * 2);
  let o = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

const box = (w, h, d, x = 0, y = 0, z = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
};
const sphere = (r, x, y, z, sy = 1) => {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.scale(1, sy, 1); g.translate(x, y, z);
  return g;
};

export function treeTrunkGeo() {
  const g = new THREE.CylinderGeometry(0.16, 0.34, 1, 5);
  g.translate(0, 0.5, 0);
  return g;
}
export function treeCanopyGeo(seed = 3) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const j = 0.82 + 0.36 * Math.abs(Math.sin(i * 12.9898 + seed) * 43758.5453 % 1);
    p.setXYZ(i, p.getX(i) * j, p.getY(i) * j * 0.78, p.getZ(i) * j);
  }
  g.computeVertexNormals();
  return g;
}
export function personRobeGeo() {
  const robe = new THREE.CylinderGeometry(0.17, 0.34, 1.42, 6);
  robe.translate(0, 0.71, 0);
  const hat = box(0.21, 0.13, 0.24, 0, 1.8, 0);
  return mergeGeoms([robe, hat]);
}
export function personHeadGeo() {
  return sphere(0.145, 0, 1.6, 0);
}
export function camelGeo() {
  return mergeGeoms([
    box(2.5, 1.05, 0.9, 0, 1.55, 0),
    sphere(0.45, -0.55, 2.15, 0, 0.8), sphere(0.45, 0.5, 2.15, 0, 0.8),
    box(0.34, 1.15, 0.34, 1.18, 2.15, 0, -0.45),
    box(0.6, 0.3, 0.3, 1.62, 2.72, 0),
    box(0.17, 1.1, 0.17, -0.95, 0.55, 0.3), box(0.17, 1.1, 0.17, -0.95, 0.55, -0.3),
    box(0.17, 1.1, 0.17, 0.9, 0.55, 0.3), box(0.17, 1.1, 0.17, 0.9, 0.55, -0.3),
  ]);
}
export function cartGeo() {
  const wheel = new THREE.CylinderGeometry(0.72, 0.72, 0.12, 10);
  wheel.rotateX(Math.PI / 2);
  const w1 = wheel.clone(); w1.translate(0, 0.72, 0.78);
  const w2 = wheel.clone(); w2.translate(0, 0.72, -0.78);
  return mergeGeoms([
    box(2.3, 0.14, 1.35, -0.1, 1.05, 0),
    box(2.3, 0.5, 0.1, -0.1, 1.35, 0.66), box(2.3, 0.5, 0.1, -0.1, 1.35, -0.66),
    box(0.1, 0.5, 1.3, -1.2, 1.35, 0),
    box(1.9, 0.09, 0.09, 1.6, 1.0, 0.45), box(1.9, 0.09, 0.09, 1.6, 1.0, -0.45),
    w1, w2,
  ]);
}
export function oxGeo() {
  return mergeGeoms([
    box(1.6, 0.95, 0.8, 0, 1.0, 0),
    box(0.5, 0.45, 0.42, 0.95, 1.25, 0),
    box(0.14, 0.62, 0.14, -0.6, 0.35, 0.25), box(0.14, 0.62, 0.14, -0.6, 0.35, -0.25),
    box(0.14, 0.62, 0.14, 0.55, 0.35, 0.25), box(0.14, 0.62, 0.14, 0.55, 0.35, -0.25),
  ]);
}
export function stallWoodGeo() {
  return mergeGeoms([
    box(0.1, 2.3, 0.1, -1.15, 1.15, -0.75), box(0.1, 2.3, 0.1, 1.15, 1.15, -0.75),
    box(0.1, 2.0, 0.1, -1.15, 1.0, 0.8), box(0.1, 2.0, 0.1, 1.15, 1.0, 0.8),
    box(2.5, 0.85, 1.15, 0, 0.46, 0.1),
  ]);
}

/* ----------------------- materials + part defs --------------------- */

export function initParts(world, T) {
  const inst = world.inst;
  const L = (p) => new THREE.MeshLambertMaterial(p);

  const mats = world.mats = {
    roof: L({ map: T.roof, side: THREE.DoubleSide }),
    roofDark: L({ map: T.roofDark, side: THREE.DoubleSide }),
    ridge: L({ color: 0x33363c }),
    plaster: L({ map: T.plaster }),
    timber: L({ map: T.timber }),
    door: L({ map: T.door }),
    dougong: L({ map: T.dougong }),
    wood: L({ color: 0x86311f }),
    woodDark: L({ color: 0x52382a }),
    earth: L({ map: T.earth }),
    brick: L({ map: T.brick }),
    stone: L({ map: T.stone }),
    gold: L({ color: 0xc9a23f, emissive: 0x553f10 }),
    canopy: L({ color: 0xffffff }),
    trunk: L({ color: 0x6b4a33 }),
    robe: L({ color: 0xffffff }),
    skin: L({ color: 0xd9b08c }),
    awning: L({ map: T.awning }),
    goods: L({ color: 0xffffff }),
    camel: L({ color: 0xb9986a }),
    ox: L({ color: 0x584738 }),
    cart: L({ color: 0x7a5c3d }),
    water: new THREE.MeshLambertMaterial({ map: T.water, transparent: true, opacity: 0.92 }),
  };

  // generic stretched boxes per material
  for (const k of ['plaster', 'earth', 'brick', 'stone', 'wood', 'woodDark', 'ridge', 'gold', 'door', 'dougong'])
    inst.def('bx_' + k, unitBox(), mats[k]);
  inst.def('bx_timber', unitBox(), mats.timber);

  // roof variants — quantised so tile UVs stay crisp
  const roofDefs = {
    houseS: { w: 9, d: 5.5, h: 2.5, ridge: 0.85, over: 0.8, up: 0.25, M: 4, N: 4 },
    houseM: { w: 12, d: 7, h: 3.1, ridge: 0.8, over: 0.95, up: 0.3, M: 4, N: 4 },
    houseL: { w: 16, d: 9, h: 3.9, ridge: 0.62, over: 1.1, up: 0.45, M: 5, N: 4 },
    shop: { w: 24, d: 6.5, h: 2.9, ridge: 0.9, over: 0.9, up: 0.25, M: 5, N: 4 },
    hallM: { w: 15, d: 9, h: 4.2, ridge: 0.5, over: 1.3, up: 0.6 },
    hallL: { w: 21, d: 12, h: 5.2, ridge: 0.45, over: 1.5, up: 0.75 },
    hallXL: { w: 30, d: 16, h: 6.6, ridge: 0.34, over: 1.8, up: 0.95 },
    hallXXL: { w: 58, d: 28, h: 10.5, ridge: 0.3, over: 2.6, up: 1.5, M: 8, N: 6 },
    gate: { w: 26, d: 14, h: 5.8, ridge: 0.4, over: 1.7, up: 0.9 },
    pav: { w: 8, d: 8, h: 3.4, ridge: 0.02, over: 1.2, up: 0.7 },
    tower: { w: 12, d: 12, h: 4.4, ridge: 0.05, over: 1.5, up: 0.85 },
    tier: { w: 10, d: 10, h: 1.7, ridge: 0.03, over: 1.3, up: 0.55, M: 4, N: 3 },
    corr: { w: 12, d: 4.4, h: 1.9, ridge: 0.92, over: 0.7, up: 0.2, M: 3, N: 3 },
  };
  world.roofDefs = roofDefs;
  for (const [k, def] of Object.entries(roofDefs)) {
    inst.def('roof_' + k, roofGeo(def), mats.roof);
    inst.def('roofd_' + k, roofGeo(def), mats.roofDark);
  }

  // props
  inst.def('treeTrunk', treeTrunkGeo(), mats.trunk);
  inst.def('treeCanopy', treeCanopyGeo(), mats.canopy, { colored: true });
  inst.def('robe', personRobeGeo(), mats.robe, { colored: true, shadow: false });
  inst.def('head', personHeadGeo(), mats.skin, { shadow: false });
  inst.def('camel', camelGeo(), mats.camel);
  inst.def('cart', cartGeo(), mats.cart);
  inst.def('ox', oxGeo(), mats.ox);
  inst.def('stall', stallWoodGeo(), mats.cart);
  inst.def('awning', box(2.9, 0.07, 2.1, 0, 0, 0.15), mats.awning, { colored: true });
  inst.def('goods', box(0.55, 0.5, 0.55, 0, 0.25, 0), mats.goods, { colored: true, shadow: false });
}

/* --------------------- composite placements ----------------------- */

const rot = (dx, dz, ry) => [dx * Math.cos(ry) + dz * Math.sin(ry), -dx * Math.sin(ry) + dz * Math.cos(ry)];

export function addCollider(world, cx, cz, w, d, top, ry = 0) {
  if (ry % Math.PI !== 0 && Math.abs(ry % (Math.PI / 2)) > 0.01) {
    // rotated arbitrary — approximate by bounding square
    const r = Math.max(w, d) / 2;
    world.colliders.push({ x0: cx - r, x1: cx + r, z0: cz - r, z1: cz + r, top });
    return;
  }
  const swap = Math.abs(Math.round(ry / (Math.PI / 2))) % 2 === 1;
  const hw = (swap ? d : w) / 2, hd = (swap ? w : d) / 2;
  world.colliders.push({ x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd, top });
}

// A complete timber-frame building. type selects body+roof size.
const BLD = {
  houseS: { w: 9, d: 5.5, bh: 2.6, plat: 0.35, roof: 'houseS' },
  houseM: { w: 12, d: 7, bh: 3.0, plat: 0.45, roof: 'houseM' },
  houseL: { w: 16, d: 9, bh: 3.4, plat: 0.6, roof: 'houseL' },
  shop: { w: 24, d: 6.5, bh: 2.9, plat: 0.25, roof: 'shop' },
  hallM: { w: 15, d: 9, bh: 3.8, plat: 0.8, roof: 'hallM' },
  hallL: { w: 21, d: 12, bh: 4.6, plat: 1.1, roof: 'hallL' },
  hallXL: { w: 30, d: 16, bh: 5.6, plat: 1.4, roof: 'hallXL' },
  hallXXL: { w: 58, d: 28, bh: 8.4, plat: 2.2, roof: 'hallXXL' },
};
export const BUILDINGS = BLD;

export function placeBuilding(world, type, x, z, ry = 0, opts = {}) {
  const inst = world.inst;
  const B = BLD[type];
  const plat = opts.platH != null ? opts.platH : B.plat;
  const baseY = opts.baseY || 0;
  const dark = opts.dark;
  const platMat = opts.platMat || (type.startsWith('hall') ? 'stone' : 'brick');
  const hall = type.startsWith('hall') || type === 'shop';

  // platform
  if (plat > 0.05) {
    inst.push('bx_' + platMat, x, baseY, z, ry, B.w + 2.2, plat, B.d + 2.2);
  }
  const y0 = baseY + plat;
  // body: plaster mass + timber facade band on the front
  inst.push('bx_plaster', x, y0, z, ry, B.w, B.bh, B.d);
  const [fx, fz] = rot(0, B.d / 2 + 0.06, ry);
  inst.push('bx_timber', x + fx, y0, z + fz, ry, B.w * 0.985, B.bh * 0.96, 0.12);
  if (opts.door !== false) {
    const dw = Math.min(3, B.w * 0.2);
    const [dx2, dz2] = rot(0, B.d / 2 + 0.14, ry);
    inst.push('bx_door', x + dx2, y0, z + dz2, ry, dw, Math.min(2.8, B.bh * 0.8), 0.08);
  }
  // dougong band under the eaves for halls
  if (hall && type !== 'shop') {
    inst.push('bx_dougong', x, y0 + B.bh - 0.85, z, ry, B.w + 0.7, 0.85, B.d + 0.7);
  }
  let roofBase = y0 + B.bh;
  // double-eave: skirt roof + clerestory body + main roof
  if (opts.tiers === 2) {
    inst.push((dark ? 'roofd_' : 'roof_') + B.roof, x, roofBase, z, ry, 1.04, 0.55, 1.04);
    inst.push('bx_plaster', x, roofBase + 0.4, z, ry, B.w * 0.72, B.bh * 0.42, B.d * 0.72);
    inst.push('bx_dougong', x, roofBase + 0.4 + B.bh * 0.42 - 0.7, z, ry, B.w * 0.72 + 0.6, 0.7, B.d * 0.72 + 0.6);
    roofBase = roofBase + 0.4 + B.bh * 0.42;
    inst.push((dark ? 'roofd_' : 'roof_') + B.roof, x, roofBase, z, ry, 0.78, 0.9, 0.78);
  } else {
    inst.push((dark ? 'roofd_' : 'roof_') + B.roof, x, roofBase, z, ry, 1, 1, 1);
  }
  // ridge beam + chiwei (owl-tail) finials on halls
  const def = world.roofDefs[B.roof];
  const rl = Math.max(1.2, def.w * def.ridge * (opts.tiers === 2 ? 0.78 : 1));
  const rTop = roofBase + def.h * (opts.tiers === 2 ? 0.9 : 1);
  const [rx0, rz0] = [x, z];
  inst.push('bx_ridge', rx0, rTop - 0.15, rz0, ry, rl + 0.8, 0.55, 0.75);
  if (opts.chiwei) {
    const [c1x, c1z] = rot(rl / 2 + 0.3, 0, ry);
    const [c2x, c2z] = rot(-rl / 2 - 0.3, 0, ry);
    inst.push('bx_ridge', rx0 + c1x, rTop + 0.3, rz0 + c1z, ry, 0.5, 1.5, 0.9);
    inst.push('bx_ridge', rx0 + c2x, rTop + 0.3, rz0 + c2z, ry, 0.5, 1.5, 0.9);
  }
  if (opts.collider !== false) addCollider(world, x, z, B.w + 2.2, B.d + 2.2, y0 + B.bh, ry);
  return { w: B.w, d: B.d, top: roofBase };
}

// Perimeter wall with optional centred gaps per side. side keys: n,s,e,w
export function placeWallRect(world, x0, z0, x1, z1, h, t, mat, { gaps = {}, collide = true, baseY = 0 } = {}) {
  const inst = world.inst;
  const seg = (cx, cz, len, horiz) => {
    if (len < 0.4) return;
    inst.push('bx_' + mat, cx, baseY, cz, 0, horiz ? len : t, h, horiz ? t : len);
    if (collide) world.colliders.push(horiz
      ? { x0: cx - len / 2, x1: cx + len / 2, z0: cz - t / 2, z1: cz + t / 2, top: baseY + h }
      : { x0: cx - t / 2, x1: cx + t / 2, z0: cz - len / 2, z1: cz + len / 2, top: baseY + h });
  };
  const side = (horiz, fixed, a0, a1, gap) => {
    if (!gap) {
      const c = (a0 + a1) / 2, len = a1 - a0;
      horiz ? seg(c, fixed, len, true) : seg(fixed, c, len, false);
      return;
    }
    const mid = (a0 + a1) / 2;
    const l0 = a0, l1 = mid - gap / 2, r0 = mid + gap / 2, r1 = a1;
    if (horiz) { seg((l0 + l1) / 2, fixed, l1 - l0, true); seg((r0 + r1) / 2, fixed, r1 - r0, true); }
    else { seg(fixed, (l0 + l1) / 2, l1 - l0, false); seg(fixed, (r0 + r1) / 2, r1 - r0, false); }
    // little roof over the gateway
    const gx = horiz ? mid : fixed, gz = horiz ? fixed : mid;
    inst.push('roof_houseS', gx, baseY + h + 0.15, gz, horiz ? 0 : Math.PI / 2, (gap + 3) / 9, 0.55, 0.45);
  };
  side(true, z0, x0, x1, gaps.n);
  side(true, z1, x0, x1, gaps.s);
  side(false, x0, z0, z1, gaps.w);
  side(false, x1, z0, z1, gaps.e);
}

// Square open pavilion: corner columns + pyramid roof.
export function placePavilion(world, x, z, { size = 8, h = 3.4, baseY = 0, dark = false, twoStory = false } = {}) {
  const inst = world.inst;
  const s = size / 8;
  inst.push('bx_stone', x, baseY, z, 0, size + 1.4, 0.5, size + 1.4);
  const half = size / 2 - 0.4;
  for (const [cx, cz] of [[-half, -half], [half, -half], [-half, half], [half, half]])
    inst.push('bx_wood', x + cx, baseY + 0.5, z + cz, 0, 0.45, h, 0.45);
  let y = baseY + 0.5 + h;
  if (twoStory) {
    inst.push((dark ? 'roofd_' : 'roof_') + 'pav', x, y, z, 0, s * 1.05, 0.55, s * 1.05);
    inst.push('bx_timber', x, y + 0.7, z, 0, size * 0.7, h * 0.7, size * 0.7);
    y += 0.7 + h * 0.7;
    inst.push((dark ? 'roofd_' : 'roof_') + 'pav', x, y, z, 0, s * 0.8, 0.9, s * 0.8);
    inst.push('bx_gold', x, y + 3.4 * 0.9 * s * 0.8 - 0.2, z, 0, 0.5, 1.4, 0.5);
  } else {
    inst.push((dark ? 'roofd_' : 'roof_') + 'pav', x, y, z, 0, s, 1, s);
    inst.push('bx_gold', x, y + 3.4 * s - 0.15, z, 0, 0.4, 1.1, 0.4);
  }
  addCollider(world, x, z, 2, 2, baseY + 2); // just the centre, can walk under eaves
}

// Multi-storey pagoda (square brick tower with stacked eaves).
export function placePagoda(world, x, z, { tiers = 7, base = 24, height = 60, mat = 'brick' } = {}) {
  const inst = world.inst;
  inst.push('bx_stone', x, 0, z, 0, base + 10, 1.6, base + 10);
  world.regions.push({ x0: x - (base + 10) / 2, x1: x + (base + 10) / 2, z0: z - (base + 10) / 2, z1: z + (base + 10) / 2, h0: 1.6, h1: 1.6 });
  // entry steps
  world.regions.push({ x0: x - 3, x1: x + 3, z0: z + (base + 10) / 2, z1: z + (base + 10) / 2 + 7, h0: 1.6, h1: 0, axis: 'z' });
  inst.push('bx_stone', x, 0.01, z + (base + 10) / 2 + 3.5, 0, 6, 0.85, 7);
  let y = 1.6;
  const tierH = (height - 1.6) / tiers;
  for (let i = 0; i < tiers; i++) {
    const f = Math.pow(0.885, i);
    const w = base * f;
    inst.push('bx_' + mat, x, y, z, 0, w, tierH * 0.78, w);
    // arched door hint on south face
    inst.push('bx_ridge', x, y + tierH * 0.16, z + w / 2 + 0.05, 0, 1.8 * f + 0.6, 2.6 * f + 0.5, 0.12);
    inst.push('roofd_tier', x, y + tierH * 0.78, z, 0, (w + 2.5) / 12.6, 0.85, (w + 2.5) / 12.6);
    y += tierH * 0.78 + tierH * 0.22;
  }
  inst.push('bx_gold', x, y - 0.4, z, 0, 1.0, 6, 1.0);
  addCollider(world, x, z, base, base, height);
}
