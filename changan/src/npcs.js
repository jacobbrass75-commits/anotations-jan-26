// Street crowds: instanced robed figures walking the avenues and markets.
import * as THREE from 'three';
import { personRobeGeo, personHeadGeo } from './parts.js';
import { STREETS_V, STREETS_H, E_MARKET, W_MARKET, GATES, CITY } from './layout.js';

const ROBES = [
  0xd8cdb4, 0xc4b394, 0xa08a64, 0x8a7a5c, 0x746048,        // hemp & ramie commoners
  0x5a6e4e, 0x4e5e72, 0x6e4a3a, 0x9a4a38, 0x3e4e42,        // dyed cloth
  0xb04838, 0x7a3a8a, 0x3a6a8a, 0xc0903a, 0xb87898,        // silks, the occasional official
];

export class Crowd {
  constructor(world, count = 650) {
    this.world = world;
    this.count = count;
    const rng = world.rng;

    // walkable rectangles with spawn weights
    const rects = [];
    const add = (x0, x1, z0, z1, weight, horiz) => {
      if (x1 - x0 < 8 || z1 - z0 < 8) return;
      rects.push({ x0, x1, z0, z1, horiz, weight });
    };
    for (const s of STREETS_V)
      add(s.x - s.w / 2 + 4, s.x + s.w / 2 - 4, s.z0 + 10, s.z1 - 30, s.zhuque ? 7 : 2, false);
    for (const s of STREETS_H) {
      if (s.splitPalace) {
        add(-CITY.hw + 40, -1495, s.z - s.w / 2 + 4, s.z + s.w / 2 - 4, 1, true);
        add(1495, CITY.hw - 40, s.z - s.w / 2 + 4, s.z + s.w / 2 - 4, 1, true);
      } else add(-CITY.hw + 40, CITY.hw - 40, s.z - s.w / 2 + 4, s.z + s.w / 2 - 4, 1.5, true);
    }
    for (const M of [E_MARKET, W_MARKET]) {
      const W = M.x1 - M.x0, D = M.z1 - M.z0;
      for (const fx of [1 / 3, 2 / 3]) add(M.x0 + fx * W - 6, M.x0 + fx * W + 6, M.z0 + 12, M.z1 - 12, 9, false);
      for (const fz of [1 / 3, 2 / 3]) add(M.x0 + 12, M.x1 - 12, M.z0 + fz * D - 6, M.z0 + fz * D + 6, 9, true);
    }
    const totalW = rects.reduce((a, r) => a + r.weight, 0);

    this.npc = [];
    for (let i = 0; i < count; i++) {
      let pick = rng.f() * totalW, rect = rects[0];
      for (const r of rects) { pick -= r.weight; if (pick <= 0) { rect = r; break; } }
      this.npc.push({
        rect,
        x: rng.range(rect.x0, rect.x1),
        z: rng.range(rect.z0, rect.z1),
        dir: rng.chance(0.5) ? 1 : -1,
        speed: rng.range(0.8, 1.7),
        phase: rng.f() * 10,
        scale: rng.range(0.9, 1.08),
      });
    }

    this.robes = new THREE.InstancedMesh(personRobeGeo(), world.mats.robe, count);
    this.heads = new THREE.InstancedMesh(personHeadGeo(), world.mats.skin, count);
    this.robes.frustumCulled = this.heads.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++)
      this.robes.setColorAt(i, c.set(ROBES[Math.floor(rng.f() * ROBES.length)]));
    this.robes.instanceColor.needsUpdate = true;
    this.dummy = new THREE.Object3D();
    this.t = 0;
    for (let i = 0; i < count; i++) this.pose(i, true);
    world.scene.add(this.robes, this.heads);

    this.addGuards(world);
  }

  addGuards(world) {
    // static guard pairs flanking every city gate (pushed into the static bins)
    for (const g of GATES) {
      const horiz = g.side === 's' || g.side === 'n';
      const fixed = g.side === 's' ? CITY.hd - 14 : g.side === 'n' ? -CITY.hd + 14
        : g.side === 'e' ? CITY.hw - 14 : -CITY.hw + 14;
      const span = g.n * 6.5 + (g.n + 1) * 4;
      for (const d of [-1, 1]) {
        const a = g.at + d * (span / 2 + 1.5);
        const x = horiz ? a : fixed, z = horiz ? fixed : a;
        world.inst.push('robe', x, 0, z, 0, 1, 1.05, 1, new THREE.Color(0x7a2a20));
        world.inst.push('head', x, 0, z, 0, 1, 1.05, 1);
      }
    }
  }

  pose(i, force) {
    const n = this.npc[i];
    const bob = Math.abs(Math.sin(this.t * 4 * n.speed + n.phase)) * 0.07;
    this.dummy.position.set(n.x, bob, n.z);
    this.dummy.rotation.set(0, n.rect.horiz ? (n.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (n.dir > 0 ? Math.PI : 0), 0);
    this.dummy.scale.setScalar(n.scale);
    this.dummy.updateMatrix();
    this.robes.setMatrixAt(i, this.dummy.matrix);
    this.heads.setMatrixAt(i, this.dummy.matrix);
  }

  update(dt, px, pz) {
    this.t += dt;
    const R2 = 420 * 420;
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const n = this.npc[i];
      const dx = n.x - px, dz = n.z - pz;
      if (dx * dx + dz * dz > R2) continue;
      const drift = Math.sin(this.t * 0.4 + n.phase) * 0.18 * dt;
      if (n.rect.horiz) {
        n.x += n.dir * n.speed * dt;
        n.z = Math.min(n.rect.z1, Math.max(n.rect.z0, n.z + drift));
        if (n.x > n.rect.x1) { n.x = n.rect.x1; n.dir = -1; }
        if (n.x < n.rect.x0) { n.x = n.rect.x0; n.dir = 1; }
      } else {
        n.z += n.dir * n.speed * dt;
        n.x = Math.min(n.rect.x1, Math.max(n.rect.x0, n.x + drift));
        if (n.z > n.rect.z1) { n.z = n.rect.z1; n.dir = -1; }
        if (n.z < n.rect.z0) { n.z = n.rect.z0; n.dir = 1; }
      }
      this.pose(i);
      dirty = true;
    }
    if (dirty) {
      this.robes.instanceMatrix.needsUpdate = true;
      this.heads.instanceMatrix.needsUpdate = true;
    }
  }
}
