// HUD: location banner, historical toasts, coin purse & trading, minimap, big map.
import { CITY, locate, MAP_LABELS } from './layout.js';

const GOODS = [
  ['a bolt of Sogdian brocade', 9, 18], ['a jar of grape wine from Gaochang', 4, 9],
  ['Persian silverwork', 12, 26], ['a sack of Sichuan tea', 3, 8],
  ['jade from Khotan', 14, 30], ['a ream of mulberry paper', 2, 6],
  ['frankincense from Arabia', 8, 20], ['a Tang tri-colour camel figurine', 3, 10],
  ['cinnamon and cloves', 5, 12], ['a roll of plain silk (the real currency)', 6, 14],
];

export class Hud {
  constructor(world, player, wards, mapCanvas, callbacks) {
    this.world = world;
    this.player = player;
    this.wards = wards;
    this.mapCanvas = mapCanvas;
    this.cb = callbacks;
    this.coins = 100;
    this.seen = new Set();
    this.toastTimer = 0;
    this.tradeTimer = 0;
    this.locTimer = 0;
    this.lastLoc = null;
    this.fpsAcc = 0; this.fpsN = 0;

    this.el = {
      locCn: document.querySelector('#loc .cn'),
      locEn: document.querySelector('#loc .en'),
      coins: document.getElementById('coinsVal'),
      clock: document.getElementById('clock'),
      toast: document.getElementById('toast'),
      fps: document.getElementById('fps'),
      mini: document.getElementById('minimap').getContext('2d'),
      bigWrap: document.getElementById('bigmapWrap'),
      big: document.getElementById('bigmap'),
    };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggleBigMap();
      if (e.code === 'KeyT') this.cb.cycleTime();
      if (e.code === 'KeyF') this.el.fps.style.display = this.el.fps.style.display === 'block' ? 'none' : 'block';
      if (e.code === 'KeyE') this.tryTrade();
    });
  }

  toast(msg, secs = 6) {
    this.el.toast.innerHTML = msg;
    this.el.toast.style.opacity = 1;
    this.toastTimer = secs;
  }

  setClock(label) { this.el.clock.textContent = label; }

  tryTrade() {
    if (this.tradeTimer > 0) return;
    const p = this.player.pos;
    let best = null, bd = 36; // within 6 m
    for (const s of this.world.stalls) {
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) { this.toast('No stall within reach — the markets are in the 东市 and 西市.', 3); return; }
    const rng = this.world.rng;
    const g = GOODS[Math.floor(rng.f() * GOODS.length)];
    const amount = Math.round(rng.range(g[1], g[2]));
    if (rng.chance(0.55)) {
      this.coins += amount;
      this.toast(`Sold ${g[0]} for <b style="color:#ffd98a">+${amount} 缗</b>. The shopkeeper bows.`, 4);
    } else {
      this.coins -= amount;
      this.toast(`Bought ${g[0]} for <b style="color:#ff9a7a">−${amount} 缗</b>. It will fetch double in Luoyang.`, 4);
    }
    this.el.coins.textContent = this.coins;
    this.tradeTimer = 1.2;
  }

  toggleBigMap() {
    const w = this.el.bigWrap;
    const open = w.style.display !== 'flex';
    w.style.display = open ? 'flex' : 'none';
    if (open) this.drawBigMap();
  }

  drawBigMap() {
    const c = this.el.big;
    const size = Math.min(window.innerHeight - 70, window.innerWidth - 70, 860);
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const G = CITY.groundSize, S = this.mapCanvas.width;
    // crop: city + Daming margin
    const x0 = -5300, x1 = 5300, z0 = -7000, z1 = 4800;
    const sx = ((x0 + G / 2) / G) * S, sw = ((x1 - x0) / G) * S;
    const sz = ((z0 + G / 2) / G) * S, sh = ((z1 - z0) / G) * S;
    ctx.drawImage(this.mapCanvas, sx, sz, sw, sh, 0, 0, size, size);
    const px = (wx) => ((wx - x0) / (x1 - x0)) * size;
    const pz = (wz) => ((wz - z0) / (z1 - z0)) * size;
    ctx.font = `${Math.max(11, size / 52)}px "Songti SC","Noto Serif SC",serif`;
    ctx.textAlign = 'center';
    for (const L of MAP_LABELS) {
      ctx.fillStyle = 'rgba(20,10,4,0.85)';
      ctx.fillText(L.t, px(L.x) + 1, pz(L.z) + 1);
      ctx.fillStyle = '#f5e7be';
      ctx.fillText(L.t, px(L.x), pz(L.z));
    }
    // player
    const p = this.player.pos;
    ctx.fillStyle = '#ff4a3a';
    ctx.beginPath(); ctx.arc(px(p.x), pz(p.z), Math.max(4, size / 160), 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  drawMinimap() {
    const ctx = this.el.mini;
    const S = 400, win = 760; // metres shown across the minimap
    const G = CITY.groundSize, MS = this.mapCanvas.width;
    const p = this.player.pos;
    const sx = ((p.x - win / 2 + G / 2) / G) * MS;
    const sz = ((p.z - win / 2 + G / 2) / G) * MS;
    const sw = (win / G) * MS;
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(this.mapCanvas, sx, sz, sw, sw, 0, 0, S, S);
    // player arrow (yaw: 0 faces -z … screen up)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-this.player.yaw);
    ctx.fillStyle = '#e83a2a';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -14); ctx.lineTo(9, 10); ctx.lineTo(0, 4); ctx.lineTo(-9, 10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#f5e7be'; ctx.font = '26px serif'; ctx.textAlign = 'center';
    ctx.fillText('北', S / 2, 30);
  }

  update(dt, fps) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.style.opacity = 0;
    }
    if (this.tradeTimer > 0) this.tradeTimer -= dt;

    this.locTimer -= dt;
    if (this.locTimer <= 0) {
      this.locTimer = 0.4;
      const p = this.player.pos;
      const L = locate(p.x, p.z, this.wards);
      if (L !== this.lastLoc) {
        this.lastLoc = L;
        this.el.locCn.textContent = L.cn;
        this.el.locEn.textContent = L.en.toUpperCase();
        if (L.fact && !this.seen.has(L.cn)) {
          this.seen.add(L.cn);
          this.toast(L.fact, 8);
        }
      }
      if (this.el.bigWrap.style.display === 'flex') this.drawBigMap();
    }
    this.drawMinimap();

    this.fpsAcc += fps; this.fpsN++;
    if (this.fpsN >= 30) {
      this.el.fps.textContent = Math.round(this.fpsAcc / this.fpsN) + ' fps';
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }
}
