// First-person merchant: pointer-lock look, walking/running/horseback,
// AABB collision via a spatial hash, walkable height regions (walls, terraces, ramps).
import * as THREE from 'three';

const CELL = 64;
const EYE_WALK = 1.7, EYE_HORSE = 2.45;
const RADIUS = 0.45;
const STEP_UP = 0.75;     // max ledge the player can step onto
const GRAV = 18;

export class Player {
  constructor(world, camera, dom) {
    this.world = world;
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 4240);   // just inside Mingde Gate
    this.vy = 0;
    this.yaw = 0;                                // face north (-z)
    this.pitch = 0;
    this.keys = {};
    this.horse = false;
    this.grounded = true;
    this.locked = false;

    // spatial hash for box colliders
    this.hash = new Map();
    world.colliders.forEach((c, i) => {
      const cx0 = Math.floor(c.x0 / CELL), cx1 = Math.floor(c.x1 / CELL);
      const cz0 = Math.floor(c.z0 / CELL), cz1 = Math.floor(c.z1 / CELL);
      for (let X = cx0; X <= cx1; X++) for (let Z = cz0; Z <= cz1; Z++) {
        const k = X * 100003 + Z;
        if (!this.hash.has(k)) this.hash.set(k, []);
        this.hash.get(k).push(c);
      }
    });

    dom.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch -= e.movementY * 0.0023;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  groundAt(x, z) {
    let h = 0;
    for (const r of this.world.regions) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      let rh;
      if (r.axis === 'x') rh = r.h0 + ((x - r.x0) / (r.x1 - r.x0)) * (r.h1 - r.h0);
      else if (r.axis === 'z') rh = r.h0 + ((z - r.z0) / (r.z1 - r.z0)) * (r.h1 - r.h0);
      else rh = r.h0;
      if (rh > h) h = rh;
    }
    return h;
  }

  collide(x, z, feetY) {
    // returns corrected [x, z]
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let X = cx - 1; X <= cx + 1; X++) for (let Z = cz - 1; Z <= cz + 1; Z++) {
      const list = this.hash.get(X * 100003 + Z);
      if (!list) continue;
      for (const c of list) {
        if (feetY > c.top - 0.25) continue;          // walking above it
        const nx = Math.max(c.x0, Math.min(x, c.x1));
        const nz = Math.max(c.z0, Math.min(z, c.z1));
        const dx = x - nx, dz = z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          x = nx + (dx / d) * RADIUS;
          z = nz + (dz / d) * RADIUS;
        } else {
          // centre inside the box: push out along the shallowest axis
          const pushL = x - c.x0 + RADIUS, pushR = c.x1 - x + RADIUS;
          const pushU = z - c.z0 + RADIUS, pushD = c.z1 - z + RADIUS;
          const m = Math.min(pushL, pushR, pushU, pushD);
          if (m === pushL) x = c.x0 - RADIUS;
          else if (m === pushR) x = c.x1 + RADIUS;
          else if (m === pushU) z = c.z0 - RADIUS;
          else z = c.z1 + RADIUS;
        }
      }
    }
    // lakes
    for (const e of this.world.ellipses) {
      const ex = (x - e.cx) / e.rx, ez = (z - e.cz) / e.rz;
      const d2 = ex * ex + ez * ez;
      if (d2 < 1 && feetY < 1.2) {
        const d = Math.sqrt(d2) || 1e-6;
        x = e.cx + (ex / d) * e.rx;
        z = e.cz + (ez / d) * e.rz;
      }
    }
    return [x, z];
  }

  update(dt) {
    const k = this.locked ? this.keys : {};
    if (this._h !== !!k.KeyH) { if (k.KeyH) this.horse = !this.horse; this._h = !!k.KeyH; }

    const run = k.ShiftLeft || k.ShiftRight;
    const speed = this.horse ? (run ? 38 : 16) : run ? 11 : 4.6;
    let mx = 0, mz = 0;
    if (k.KeyW || k.ArrowUp) mz -= 1;
    if (k.KeyS || k.ArrowDown) mz += 1;
    if (k.KeyA || k.ArrowLeft) mx -= 1;
    if (k.KeyD || k.ArrowRight) mx += 1;
    const len = Math.hypot(mx, mz);
    let vx = 0, vz = 0;
    if (len > 0) {
      mx /= len; mz /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      vx = (mx * cos + mz * sin) * speed;
      vz = (-mx * sin + mz * cos) * speed;
    }

    const feet = this.pos.y;
    let nx = this.pos.x + vx * dt;
    let nz = this.pos.z + vz * dt;

    // refuse ledges that are too tall (terraces are entered via ramps)
    const gNew = this.groundAt(nx, nz);
    if (gNew - feet > STEP_UP) {
      // try sliding along each axis separately
      if (this.groundAt(nx, this.pos.z) - feet <= STEP_UP) nz = this.pos.z;
      else if (this.groundAt(this.pos.x, nz) - feet <= STEP_UP) nx = this.pos.x;
      else { nx = this.pos.x; nz = this.pos.z; }
    }
    [nx, nz] = this.collide(nx, nz, feet);
    this.pos.x = nx; this.pos.z = nz;

    // vertical
    const ground = this.groundAt(this.pos.x, this.pos.z);
    if (k.Space && this.grounded) { this.vy = 5.4; this.grounded = false; }
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground; this.vy = 0; this.grounded = true;
    } else if (this.pos.y - ground < 0.02) {
      this.grounded = true;
    } else if (ground < feet - 0.05 && this.grounded && this.vy <= 0) {
      // walked off an edge — start falling, but snap small steps down
      if (feet - ground < STEP_UP) { this.pos.y = ground; this.vy = 0; }
      else this.grounded = false;
    }

    // camera
    const eye = this.horse ? EYE_HORSE : EYE_WALK;
    const bobAmt = this.grounded && len > 0 ? Math.sin(performance.now() * 0.011 * (run ? 1.5 : 1)) * (this.horse ? 0.07 : 0.035) : 0;
    this.camera.position.set(this.pos.x, this.pos.y + eye + bobAmt, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
