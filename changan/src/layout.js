// The historical plan of Chang'an under Xuanzong (data after the archaeological
// surveys of the Sui Daxing / Tang Chang'an outer city, simplified to a clean grid).
// World units = metres. +x = east, +z = south, origin = centre of the outer city.

export const CITY = {
  hw: 4860,   // half width  (real outer wall: 9721 m east-west)
  hd: 4326,   // half depth  (real outer wall: 8652 m north-south)
  wallH: 7.5,
  wallT: 11,
  groundSize: 15000,
};

// ward column x-ranges, east side; west side mirrors negative.
export const COLS_E = [[75, 635], [695, 1395], [1455, 2455], [2530, 3630], [3690, 4835]];

// ward row z-ranges (1..13 north to south)
export const ROWS = [
  [-4301, -3620], [-3578, -2897], [-2677, -2070], [-2028, -1421], [-1379, -772],
  [-652, -78], [-36, 538], [580, 1154], [1229, 1803], [1845, 2419],
  [2494, 3068], [3110, 3684], [3726, 4301],
];

export const PALACE = { x0: -1485, x1: 1485, z0: -4301, z1: -2897 };   // Taiji Gong (Palace City)
export const IMPCITY = { x0: -1485, x1: 1485, z0: -2677, z1: -772 };   // Huangcheng (Imperial City)
export const DAMING = { sx0: 400, sx1: 2100, nz: -6620, nx0: 760, nx1: 1860, sz: -4326, gateX: 1250 };
export const E_MARKET = { x0: 1455, x1: 2455, z0: -1379, z1: -78 };
export const W_MARKET = { x0: -2455, x1: -1455, z0: -1379, z1: -78 };
export const XINGQING = { x0: 2530, x1: 3630, z0: -652, z1: -78 };
export const QUJIANG = { x0: 3690, x1: 4835, z0: 3110, z1: 4301, lake: { cx: 4180, cz: 3690, rx: 470, rz: 500 } };
export const TAIYE = { cx: 1300, cz: -6080, rx: 400, rz: 220 };
export const LONGCHI = { cx: 2940, cz: -300, rx: 210, rz: 120 };

// avenues. v: {x, w, z0, z1}   h: {z, w} (split around palace block when needed)
export const STREETS_V = [
  { x: 0, w: 150, z0: -772, z1: 4326, zhuque: true },
  { x: 665, w: 60, z0: -652, z1: 4301 }, { x: -665, w: 60, z0: -652, z1: 4301 },
  { x: 1425, w: 60, z0: -2787, z1: 4301 }, { x: -1425, w: 60, z0: -2787, z1: 4301 },
  { x: 2492.5, w: 75, z0: -4326, z1: 4326 }, { x: -2492.5, w: 75, z0: -4326, z1: 4326 },
  { x: 3660, w: 60, z0: -4301, z1: 4301 }, { x: -3660, w: 60, z0: -4301, z1: 4301 },
];
export const STREETS_H = [
  { z: -3599, w: 42, splitPalace: true },
  { z: -2787, w: 220, splitPalace: false },  // the great horizontal street between Palace & Imperial City
  { z: -2049, w: 42, splitPalace: true },
  { z: -1400, w: 42, splitPalace: true },
  { z: -712, w: 120, splitPalace: false },   // avenue past the Imperial City's south face
  { z: -57, w: 42 }, { z: 559, w: 42 },
  { z: 1191.5, w: 75 }, { z: 1824, w: 42 },
  { z: 2456.5, w: 75 }, { z: 3089, w: 42 }, { z: 3705, w: 42 },
];

// city gates: side, position along the wall, passages, name
export const GATES = [
  { side: 's', at: 0, n: 5, cn: '明德门', en: 'Mingde Gate' },
  { side: 's', at: -2492.5, n: 3, cn: '安化门', en: 'Anhua Gate' },
  { side: 's', at: 2492.5, n: 3, cn: '启夏门', en: 'Qixia Gate' },
  { side: 'e', at: -2787, n: 3, cn: '通化门', en: 'Tonghua Gate' },
  { side: 'e', at: -712, n: 3, cn: '春明门', en: 'Chunming Gate' },
  { side: 'e', at: 2456.5, n: 3, cn: '延兴门', en: 'Yanxing Gate' },
  { side: 'w', at: -2787, n: 3, cn: '开远门', en: 'Kaiyuan Gate' },
  { side: 'w', at: -712, n: 3, cn: '金光门', en: 'Jinguang Gate' },
  { side: 'w', at: 2456.5, n: 3, cn: '延平门', en: 'Yanping Gate' },
  { side: 'n', at: -2492.5, n: 3, cn: '光化门', en: 'Guanghua Gate' },
  { side: 'n', at: -700, n: 3, cn: '芳林门', en: 'Fanglin Gate' },
  { side: 'n', at: 1250, n: 5, cn: '丹凤门', en: 'Danfeng Gate' }, // into the Daming Palace

];

/* ----------------------------- wards ------------------------------ */

// pinned famous wards: key `${side}${col}_${row}` (col 1..5 from the axis, row 1..13)
const PINNED = {
  'e1_6': ['务本', 'Wuben'], 'e1_11': ['靖善', 'Jingshan'],
  'e2_6': ['平康', 'Pingkang'], 'e2_7': ['宣阳', 'Xuanyang'], 'e2_8': ['亲仁', 'Qinren'],
  'e3_3': ['胜业', 'Shengye'], 'e3_4': ['崇仁', 'Chongren'],
  'e3_9': ['晋昌', 'Jinchang'], 'e3_10': ['修业', 'Xiuye'],
  'e4_5': ['永嘉', 'Yongjia'], 'e4_7': ['安邑', 'Anyi'],
  'e5_5': ['靖恭', 'Jinggong'], 'e5_6': ['新昌', 'Xinchang'],
  'w1_7': ['开化', 'Kaihua'], 'w1_8': ['安仁', 'Anren'],
  'w2_6': ['光德', 'Guangde'], 'w2_7': ['延寿', 'Yanshou'],
  'w3_4': ['醴泉', 'Liquan'], 'w4_3': ['义宁', 'Yining'],
  'w4_2': ['修德', 'Xiude'], 'w5_3': ['居德', 'Jude'],
};

const POOL = [
  ['永兴', 'Yongxing'], ['崇德', 'Chongde'], ['长寿', 'Changshou'], ['嘉会', 'Jiahui'],
  ['延福', 'Yanfu'], ['怀贞', 'Huaizhen'], ['崇贤', 'Chongxian'], ['延康', 'Yankang'],
  ['光福', 'Guangfu'], ['兰陵', 'Lanling'], ['丰乐', 'Fengle'], ['安业', 'Anye'],
  ['崇业', 'Chongye'], ['永和', 'Yonghe'], ['常安', "Chang'an"], ['和平', 'Heping'],
  ['永平', 'Yongping'], ['宣义', 'Xuanyi'], ['永安', "Yong'an"], ['敦义', 'Dunyi'],
  ['大通', 'Datong'], ['昌明', 'Changming'], ['丰安', "Feng'an"], ['定安', "Ding'an"],
  ['永达', 'Yongda'], ['安善', 'Anshan'], ['通轨', 'Tonggui'], ['敦行', 'Dunxing'],
  ['大业', 'Daye'], ['昌乐', 'Changle'], ['靖安', "Jing'an"], ['永乐', 'Yongle'],
  ['长兴', 'Changxing'], ['崇义', 'Chongyi'], ['兴化', 'Xinghua'], ['丰邑', 'Fengyi'],
  ['待贤', 'Daixian'], ['群贤', 'Qunxian'], ['怀德', 'Huaide'], ['崇化', 'Chonghua'],
  ['永宁', 'Yongning'], ['宣平', 'Xuanping'], ['升平', 'Shengping'], ['修行', 'Xiuxing'],
  ['立政', 'Lizheng'], ['敦化', 'Dunhua'], ['修政', 'Xiuzheng'], ['升道', 'Shengdao'],
  ['广德', 'Guangde'], ['通济', 'Tongji'], ['曲池', 'Quchi'], ['道政', 'Daozheng'],
  ['常乐', 'Changle'], ['入苑', 'Ruyuan'], ['来庭', 'Laiting'], ['永昌', 'Yongchang'],
  ['大宁', 'Daning'], ['兴宁', 'Xingning'], ['安兴', 'Anxing'], ['长乐', 'Changle'],
  ['翊善', 'Yishan'], ['光宅', 'Guangzhai'], ['永崇', 'Yongchong'], ['昭国', 'Zhaoguo'],
  ['开明', 'Kaiming'], ['通善', 'Tongshan'], ['兴道', 'Xingdao'], ['布政', 'Buzheng'],
  ['辅兴', 'Fuxing'], ['颁政', 'Banzheng'], ['金城', 'Jincheng'], ['安定', "Anding"],
  ['休祥', 'Xiuxiang'], ['普宁', 'Puning'], ['善和', 'Shanhe'], ['通化', 'Tonghua'],
  ['丰财', 'Fengcai'], ['宣城', 'Xuancheng'], ['陶化', 'Taohua'], ['安乐', 'Anle'],
  ['延祚', 'Yanzuo'], ['修真', 'Xiuzhen'], ['安福', 'Anfu'], ['崇明', 'Chongming'],
];

export function buildWards() {
  const wards = [];
  let poolI = 0;
  const used = new Set(Object.values(PINNED).map((p) => p[0]));
  const nextName = () => {
    while (poolI < POOL.length && used.has(POOL[poolI][0])) poolI++;
    if (poolI < POOL.length) { used.add(POOL[poolI][0]); return POOL[poolI++]; }
    return ['里', 'Ward'];
  };
  for (const side of ['e', 'w']) {
    for (let c = 1; c <= 5; c++) {
      const [cx0, cx1] = COLS_E[c - 1];
      const x0 = side === 'e' ? cx0 : -cx1;
      const x1 = side === 'e' ? cx1 : -cx0;
      const rowStart = c <= 2 ? 6 : 1;   // central columns exist only south of the Imperial City
      for (let r = rowStart; r <= 13; r++) {
        // skip cells consumed by markets / Xingqing / Qujiang
        if (c === 3 && (r === 5 || r === 6)) continue;
        if (side === 'e' && c === 4 && r === 6) continue;
        if (side === 'e' && c === 5 && (r === 12 || r === 13)) continue;
        const [z0, z1] = ROWS[r - 1];
        const name = PINNED[`${side}${c}_${r}`] || nextName();
        wards.push({
          x0, x1, z0, z1, col: c, row: r, side,
          cn: name[0] + '坊', en: name[1] + ' Ward',
          south: r >= 11,                       // sparsely settled farmland rows
          rich: (side === 'e' && c <= 3 && r <= 8) || (side === 'w' && c <= 2 && r <= 8),
        });
      }
    }
  }
  return wards;
}

/* --------------------------- landmarks ----------------------------- */
// rect regions checked before wards for the HUD; fact shown once on first visit.

export const LANDMARKS = [
  { x0: -42, x1: 42, z0: 4250, z1: 4420, cn: '明德门', en: 'Mingde Gate', fact: 'The main south gate: five passages — the centre one reserved for the Emperor alone. All traffic from the south enters here.' },
  { x0: -75, x1: 75, z0: -772, z1: 4250, cn: '朱雀大街', en: 'Zhuque Avenue', fact: 'The Vermilion Bird Avenue: 150 m wide and 5 km long, dividing the capital into Wannian county (east) and Chang\'an county (west).' },
  { x0: E_MARKET.x0, x1: E_MARKET.x1, z0: E_MARKET.z0, z1: E_MARKET.z1, cn: '东市', en: 'East Market', fact: 'The East Market: 220 trades in luxury goods for the aristocratic quarters nearby. Markets open at noon to the beat of 300 drums and close at dusk.' },
  { x0: W_MARKET.x0, x1: W_MARKET.x1, z0: W_MARKET.z0, z1: W_MARKET.z1, cn: '西市', en: 'West Market', fact: 'The West Market — terminus of the Silk Road. Sogdian, Persian and Uighur merchants trade silk, jewels, horses, wine and spices here. Your kind of place.' },
  { x0: IMPCITY.x0, x1: IMPCITY.x1, z0: IMPCITY.z0, z1: IMPCITY.z1, cn: '皇城', en: 'Imperial City', fact: 'The Imperial City holds the Three Departments and Six Ministries — the bureaucracy that governs 50 million subjects.' },
  { x0: PALACE.x0, x1: PALACE.x1, z0: PALACE.z0, z1: PALACE.z1, cn: '太极宫', en: 'Taiji Palace', fact: 'The Palace City of the dynasty\'s founders. Since Gaozong the court prefers the loftier Daming Palace to the north-east.' },
  { x0: DAMING.sx0, x1: DAMING.sx1, z0: DAMING.nz, z1: DAMING.sz, cn: '大明宫', en: 'Daming Palace', fact: 'The Daming Palace on Dragon-Head Plain — 3.2 km², four and a half times the Forbidden City of later ages. Hanyuan Hall rises ahead on its triple terrace.' },
  { x0: 1250 - 130, x1: 1250 + 130, z0: -5150, z1: -4880, cn: '含元殿', en: 'Hanyuan Hall', fact: 'Hanyuan Hall, where ten thousand officials gather for the great audiences. The Dragon-Tail Way climbs 15 m from the court below.' },
  { x0: 560, x1: 840, z0: -6150, z1: -5850, cn: '麟德殿', en: 'Linde Hall', fact: 'The Linde Hall — a triple hall where the Emperor feasts a thousand guests and receives embassies from Japan, Silla and Persia.' },
  { x0: TAIYE.cx - TAIYE.rx, x1: TAIYE.cx + TAIYE.rx, z0: TAIYE.cz - TAIYE.rz, z1: TAIYE.cz + TAIYE.rz, cn: '太液池', en: 'Taiye Pool', fact: 'The Pool of Great Liquid, with Penglai — isle of the immortals — at its centre.' },
  { x0: XINGQING.x0, x1: XINGQING.x1, z0: XINGQING.z0, z1: XINGQING.z1, cn: '兴庆宫', en: 'Xingqing Palace', fact: 'Xingqing Palace, Xuanzong\'s residence — converted from his princely mansion. Here Li Bai was summoned, drunk, to write verses for Yang Guifei among the peonies.' },
  { x0: 1955 - 120, x1: 1955 + 120, z0: 1516 - 120, z1: 1516 + 120, cn: '大慈恩寺 · 大雁塔', en: 'Giant Wild Goose Pagoda', fact: 'The Great Wild Goose Pagoda at Ci\'en Monastery, built for the sutras Xuanzang carried back from India. New jinshi graduates inscribe their names here.' },
  { x0: -355 - 90, x1: -355 + 90, z0: 867 - 90, z1: 867 + 90, cn: '荐福寺 · 小雁塔', en: 'Small Wild Goose Pagoda', fact: 'The Small Wild Goose Pagoda of Jianfu Monastery, its fifteen dense eaves rising over Anren Ward.' },
  { x0: 355 - 110, x1: 355 + 110, z0: 2781 - 110, z1: 2781 + 110, cn: '大兴善寺', en: 'Daxingshan Monastery', fact: 'Daxingshan Monastery, oldest in the capital, where Indian masters translate the esoteric sutras.' },
  { x0: QUJIANG.x0, x1: QUJIANG.x1, z0: QUJIANG.z0, z1: QUJIANG.z1, cn: '曲江 · 芙蓉园', en: 'Qujiang & Lotus Garden', fact: 'The Serpentine — pleasure lake of the capital. On festival days the whole city picnics here; new graduates feast at the Apricot Garden.' },
  { x0: -42, x1: 42, z0: -2960, z1: -2780, cn: '承天门', en: 'Chengtian Gate', fact: 'The Gate of Receiving Heaven, where the Emperor reviews the New Year audience of the whole court.' },
];

export function locate(x, z, wards) {
  for (const L of LANDMARKS) if (x >= L.x0 && x <= L.x1 && z >= L.z0 && z <= L.z1) return L;
  for (const w of wards) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1) return w;
  if (Math.abs(x) > CITY.hw + 12 || Math.abs(z) > CITY.hd + 12)
    return { cn: '城外', en: 'Outside the walls' };
  return { cn: '大街', en: 'Avenue' };
}

/* ------------------------ painted ground plan ----------------------- */

export function paintCityMap(canvas, wards) {
  const S = canvas.width;
  const G = CITY.groundSize;
  const ctx = canvas.getContext('2d');
  const px = (wx) => ((wx + G / 2) / G) * S;
  const pz = (wz) => ((wz + G / 2) / G) * S;
  const rect = (x0, z0, x1, z1, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(px(x0), pz(z0), px(x1) - px(x0), pz(z1) - pz(z0));
  };

  // countryside: patchwork fields
  ctx.fillStyle = '#8f9159'; ctx.fillRect(0, 0, S, S);
  let h = 2166;
  const rnd = () => (h = (h * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const w = 30 + rnd() * 120, d = 30 + rnd() * 120;
    const x = rnd() * S, y = rnd() * S;
    const g = 110 + Math.floor(rnd() * 60);
    ctx.fillStyle = `rgba(${g + 20},${g + 10},${Math.floor(g * 0.55)},0.5)`;
    ctx.fillRect(x, y, w * S / G * 8, d * S / G * 8);
  }
  // roads radiating from the gates
  ctx.strokeStyle = '#b7a578'; ctx.lineWidth = Math.max(2, 30 * S / G);
  for (const g of GATES) {
    ctx.beginPath();
    if (g.side === 's') { ctx.moveTo(px(g.at), pz(CITY.hd)); ctx.lineTo(px(g.at * 2.2), S); }
    if (g.side === 'n') { ctx.moveTo(px(g.at), pz(-CITY.hd)); ctx.lineTo(px(g.at * 2.2), 0); }
    if (g.side === 'e') { ctx.moveTo(px(CITY.hw), pz(g.at)); ctx.lineTo(S, pz(g.at * 1.6)); }
    if (g.side === 'w') { ctx.moveTo(px(-CITY.hw), pz(g.at)); ctx.lineTo(0, pz(g.at * 1.6)); }
    ctx.stroke();
  }

  // moat
  const m0 = 18, m1 = 42;
  rect(-CITY.hw - m1, -CITY.hd - m1, CITY.hw + m1, CITY.hd + m1, '#55767f');
  rect(-CITY.hw - m0, -CITY.hd - m0, CITY.hw + m0, CITY.hd + m0, '#8f9159');

  // city interior base
  rect(-CITY.hw, -CITY.hd, CITY.hw, CITY.hd, '#b5a078');

  // wards
  for (const w of wards) {
    const v = (w.col * 13 + w.row * 7) % 14 - 7;
    rect(w.x0, w.z0, w.x1, w.z1, `rgb(${168 + v},${146 + v},${106 + v})`);
    if (w.south) { // farmland stripes
      ctx.fillStyle = 'rgba(120,130,70,0.5)';
      for (let x = w.x0 + 18; x < w.x1 - 10; x += 36)
        ctx.fillRect(px(x), pz(w.z0 + 12), Math.max(1, 16 * S / G), pz(w.z1 - 12) - pz(w.z0 + 12));
    } else { // internal cross lanes
      const lx = (w.x0 + w.x1) / 2, lz = (w.z0 + w.z1) / 2;
      rect(lx - 6, w.z0, lx + 6, w.z1, '#c3b28a');
      rect(w.x0, lz - 6, w.x1, lz + 6, '#c3b28a');
    }
  }

  // streets
  ctx.fillStyle = '#cdbb92';
  for (const s of STREETS_V) rect(s.x - s.w / 2, s.z0, s.x + s.w / 2, s.z1, '#cdbb92');
  for (const s of STREETS_H) {
    if (s.splitPalace) {
      rect(-CITY.hw, s.z - s.w / 2, -1485, s.z + s.w / 2, '#cdbb92');
      rect(1485, s.z - s.w / 2, CITY.hw, s.z + s.w / 2, '#cdbb92');
    } else rect(-CITY.hw, s.z - s.w / 2, CITY.hw, s.z + s.w / 2, '#cdbb92');
  }
  // Zhuque imperial carriageway
  rect(-9, -772, 9, 4326, '#d8c49a');

  // palace precincts
  rect(PALACE.x0, PALACE.z0, PALACE.x1, PALACE.z1, '#c8b793');
  rect(IMPCITY.x0, IMPCITY.z0, IMPCITY.x1, IMPCITY.z1, '#c2b18d');
  rect(0 - 40, IMPCITY.z0, 40, IMPCITY.z1, '#d2c098'); // Chengtian street
  // Daming (trapezoid approximated)
  ctx.fillStyle = '#c8b793';
  ctx.beginPath();
  ctx.moveTo(px(DAMING.sx0), pz(DAMING.sz)); ctx.lineTo(px(DAMING.sx1), pz(DAMING.sz));
  ctx.lineTo(px(DAMING.nx1), pz(DAMING.nz)); ctx.lineTo(px(DAMING.nx0), pz(DAMING.nz));
  ctx.closePath(); ctx.fill();

  // markets
  rect(E_MARKET.x0, E_MARKET.z0, E_MARKET.x1, E_MARKET.z1, '#a89a88');
  rect(W_MARKET.x0, W_MARKET.z0, W_MARKET.x1, W_MARKET.z1, '#a89a88');
  for (const M of [E_MARKET, W_MARKET]) {
    ctx.fillStyle = '#c0b298';
    const cx = (M.x0 + M.x1) / 2, cz = (M.z0 + M.z1) / 2, t1 = (M.x1 - M.x0) / 6, t2 = (M.z1 - M.z0) / 6;
    rect(cx - t1 - 8, M.z0, cx - t1 + 8, M.z1, '#c0b298'); rect(cx + t1 - 8, M.z0, cx + t1 + 8, M.z1, '#c0b298');
    rect(M.x0, cz - t2 - 8, M.x1, cz - t2 + 8, '#c0b298'); rect(M.x0, cz + t2 - 8, M.x1, cz + t2 + 8, '#c0b298');
  }
  // Xingqing
  rect(XINGQING.x0, XINGQING.z0, XINGQING.x1, XINGQING.z1, '#bfae8a');

  // water
  const ell = (e, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(px(e.cx), pz(e.cz), (e.rx / G) * S, (e.rz / G) * S, 0, 0, 7);
    ctx.fill();
  };
  rect(QUJIANG.x0, QUJIANG.z0, QUJIANG.x1, QUJIANG.z1, '#9aa06d');
  ell(QUJIANG.lake, '#4a7c8c'); ell(TAIYE, '#4a7c8c'); ell(LONGCHI, '#4a7c8c');

  // walls drawn dark
  ctx.strokeStyle = '#6b5a3c'; ctx.lineWidth = Math.max(2, 22 * S / G);
  ctx.strokeRect(px(-CITY.hw), pz(-CITY.hd), px(CITY.hw) - px(-CITY.hw), pz(CITY.hd) - pz(-CITY.hd));
  ctx.strokeRect(px(PALACE.x0), pz(PALACE.z0), px(PALACE.x1) - px(PALACE.x0), pz(PALACE.z1) - pz(PALACE.z0));
  ctx.strokeRect(px(IMPCITY.x0), pz(IMPCITY.z0), px(IMPCITY.x1) - px(IMPCITY.x0), pz(IMPCITY.z1) - pz(IMPCITY.z0));
  ctx.beginPath();
  ctx.moveTo(px(DAMING.sx0), pz(DAMING.sz)); ctx.lineTo(px(DAMING.nx0), pz(DAMING.nz));
  ctx.lineTo(px(DAMING.nx1), pz(DAMING.nz)); ctx.lineTo(px(DAMING.sx1), pz(DAMING.sz));
  ctx.stroke();

  return { px, pz };
}

// labels for the big map (M key)
export const MAP_LABELS = [
  { x: 0, z: -3600, t: '太极宫' }, { x: 0, z: -1700, t: '皇城' },
  { x: 1250, z: -5500, t: '大明宫' }, { x: 700, z: -6000, t: '麟德殿' },
  { x: 1250, z: -5000, t: '含元殿' },
  { x: 1955, z: -730, t: '东市' }, { x: -1955, z: -730, t: '西市' },
  { x: 3080, z: -365, t: '兴庆宫' },
  { x: 0, z: 1800, t: '朱雀大街' },
  { x: 1955, z: 1516, t: '大雁塔' }, { x: -355, z: 867, t: '小雁塔' },
  { x: 4180, z: 3690, t: '曲江' },
  { x: 0, z: 4326, t: '明德门' }, { x: -2492, z: 4326, t: '安化门' }, { x: 2492, z: 4326, t: '启夏门' },
  { x: 4860, z: -712, t: '春明门' }, { x: -4860, z: -712, t: '金光门' },
  { x: 4860, z: -2787, t: '通化门' }, { x: -4860, z: -2787, t: '开远门' },
];
