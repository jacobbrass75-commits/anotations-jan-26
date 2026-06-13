// All textures are generated on <canvas> — the app needs zero external assets.
import * as THREE from 'three';
import { makeRng } from './rng.js';

function canvasTex(size, draw, { repeat = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  return t;
}

function noise(ctx, s, n, alpha, dark = true) {
  const rng = makeRng(42);
  for (let i = 0; i < n; i++) {
    const v = rng.int(0, 40);
    ctx.fillStyle = dark
      ? `rgba(${20 + v},${15 + v},${10 + v},${alpha})`
      : `rgba(255,250,240,${alpha})`;
    ctx.fillRect(rng.f() * s, rng.f() * s, rng.range(1, 3), rng.range(1, 3));
  }
}

export function buildTextures() {
  const T = {};

  // Grey "tongwa" roof tiles — columns of convex tiles running down the slope.
  const roofDraw = (base, line, hi) => (ctx, s) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
    const col = s / 16;
    for (let x = 0; x < 16; x++) {
      const cx = x * col;
      ctx.fillStyle = line; ctx.fillRect(cx, 0, 2, s);
      ctx.fillStyle = hi; ctx.fillRect(cx + col * 0.45, 0, col * 0.22, s);
      // tile row ends (semicircular eave tiles suggested by dashes)
      ctx.fillStyle = line;
      for (let y = 0; y < 8; y++) ctx.fillRect(cx + 2, y * (s / 8), col - 2, 1.6);
    }
    noise(ctx, s, 900, 0.05);
  };
  T.roof = canvasTex(256, roofDraw('#63666c', '#46494f', '#75787e'));
  T.roofDark = canvasTex(256, roofDraw('#41454e', '#2d3138', '#525762'));

  // Whitewashed plaster with grime.
  T.plaster = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#e3dccb'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 1400, 0.05);
    const g = ctx.createLinearGradient(0, s * 0.7, 0, s);
    g.addColorStop(0, 'rgba(90,75,55,0)'); g.addColorStop(1, 'rgba(90,75,55,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });

  // Timber facade: one structural bay = vermilion columns + lattice window.
  T.timber = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#8d3a26'; ctx.fillRect(0, 0, s, s);          // frame
    ctx.fillStyle = '#6e2c1c'; ctx.fillRect(0, 0, 22, s); ctx.fillRect(s - 22, 0, 22, s); // columns
    ctx.fillStyle = '#7a3120'; ctx.fillRect(0, 0, s, 26);          // beam
    // lattice window
    ctx.fillStyle = '#caa66a'; ctx.fillRect(34, 44, s - 68, s - 92);
    ctx.strokeStyle = '#4a2618'; ctx.lineWidth = 4;
    for (let i = 0; i <= 6; i++) {
      const x = 34 + (s - 68) * (i / 6);
      ctx.beginPath(); ctx.moveTo(x, 44); ctx.lineTo(x, s - 48); ctx.stroke();
      const y = 44 + (s - 92) * (i / 6);
      ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(s - 34, y); ctx.stroke();
    }
    ctx.fillStyle = '#5e2517'; ctx.fillRect(0, s - 20, s, 20);     // plinth shadow
    noise(ctx, s, 500, 0.06);
  });

  // Double leaf door with gold studs.
  T.door = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#7c2f1e'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#5e2113'; ctx.fillRect(s / 2 - 3, 0, 6, s);
    ctx.fillStyle = '#caa23c';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      ctx.beginPath();
      ctx.arc(28 + c * 26, 36 + r * 42, 4.5, 0, 7); ctx.fill();
      ctx.beginPath();
      ctx.arc(s - 28 - c * 26, 36 + r * 42, 4.5, 0, 7); ctx.fill();
    }
    noise(ctx, s, 400, 0.07);
  });

  // Dougong bracket band under the eaves.
  T.dougong = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#74281a'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 4; i++) {
      const x = i * (s / 4) + s / 8;
      ctx.fillStyle = '#a8543a';
      ctx.fillRect(x - 22, 10, 44, 16);    // top arm
      ctx.fillRect(x - 14, 30, 28, 14);
      ctx.fillRect(x - 7, 48, 14, 14);     // block
      ctx.fillStyle = '#e0d6c0';
      ctx.fillRect(x - 30, 4, 8, s - 8); // white plaster gaps suggestion
    }
    ctx.fillStyle = '#52180e'; ctx.fillRect(0, 0, s, 6); ctx.fillRect(0, s - 8, s, 8);
  });

  // Rammed earth (hangtu) — horizontal compaction strata.
  T.earth = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#b09a72'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 14) {
      ctx.fillStyle = y % 28 ? 'rgba(120,100,65,0.5)' : 'rgba(95,78,50,0.45)';
      ctx.fillRect(0, y, s, 3);
      ctx.fillStyle = 'rgba(205,185,140,0.3)'; ctx.fillRect(0, y + 3, s, 2);
    }
    noise(ctx, s, 2200, 0.06);
  });

  // Grey Tang brick (pagodas, platforms).
  T.brick = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#9b8f7c'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#7c7264';
    const bh = s / 10;
    for (let r = 0; r < 10; r++) {
      ctx.fillRect(0, r * bh, s, 2.5);
      const off = (r % 2) * (s / 8);
      for (let cdx = 0; cdx < 8; cdx++) ctx.fillRect(((cdx * s) / 8 + off) % s, r * bh, 2.5, bh);
    }
    noise(ctx, s, 1500, 0.05);
  });

  // Pale stone for palace platforms.
  T.stone = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#cfc6b4'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(150,140,120,0.55)';
    for (let r = 0; r < 4; r++) {
      ctx.fillRect(0, (r * s) / 4, s, 2.5);
      const off = (r % 2) * (s / 6);
      for (let c = 0; c < 4; c++) ctx.fillRect(((c * s) / 3 + off) % s, (r * s) / 4, 2.5, s / 4);
    }
    noise(ctx, s, 900, 0.04);
  });

  // Striped market awning (greyscale → tinted per stall via instance colour).
  T.awning = canvasTex(128, (ctx, s) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#9a9a9a';
      ctx.fillRect((i * s) / 8, 0, s / 8, s);
    }
  });

  // Water.
  T.water = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#3f6f7d'; ctx.fillRect(0, 0, s, s);
    const rng = makeRng(7);
    for (let i = 0; i < 240; i++) {
      ctx.strokeStyle = `rgba(${170 + rng.int(0, 60)},${200 + rng.int(0, 40)},210,${rng.range(0.04, 0.13)})`;
      ctx.lineWidth = rng.range(0.7, 2);
      const y = rng.f() * s, x = rng.f() * s, w = rng.range(8, 50);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w / 2, y + rng.range(-3, 3), x + w, y); ctx.stroke();
    }
  });

  // Ground close-up detail (alpha speckle that follows the player).
  T.detail = canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const rng = makeRng(99);
    for (let i = 0; i < 2600; i++) {
      const a = rng.range(0.03, 0.12);
      ctx.fillStyle = rng.chance(0.5) ? `rgba(60,45,28,${a})` : `rgba(235,220,180,${a})`;
      ctx.fillRect(rng.f() * s, rng.f() * s, rng.range(1, 3.6), rng.range(1, 3.6));
    }
  }, { repeat: true });

  // Lantern glow sprite (for night Points).
  {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,230,170,1)');
    g.addColorStop(0.35, 'rgba(255,170,80,0.55)');
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    T.lantern = new THREE.CanvasTexture(c);
  }
  // Sun/moon disc sprite.
  {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.25, 'rgba(255,240,200,0.9)');
    g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    T.sun = new THREE.CanvasTexture(c);
  }

  return T;
}
