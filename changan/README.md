# 长安 · Chang'an, 743 CE — a walkable Tang-dynasty capital

A first-person, self-contained Three.js reconstruction of Tang Chang'an at the
height of Xuanzong's reign (天宝二年 / 743 CE). You play a Silk Road merchant
arrived at the eastern terminus of the road and walk the largest city on Earth
at true scale (the outer walls are ~9.7 × 8.7 km).

## Run it

No build step, no dependencies to install — Three.js r165 is vendored in
`vendor/`. You just need any static file server (modules require `http://`,
not `file://`):

```bash
cd changan
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or with Node: `npx serve changan` / `npx http-server changan`.

On your 9070 XT it will run at the renderer's full pixel ratio with soft
shadows; if you ever want it lighter, append `?lite` to the URL to drop the
crowd size and shadows.

## Controls

| | |
|---|---|
| **W A S D** / arrows | walk |
| **Shift** | run |
| **H** | mount / dismount a horse (much faster) |
| **Space** | jump |
| **E** | trade at the nearest market stall |
| **M** | full city map |
| **T** | cycle time of day (dawn / noon / golden hour / midnight) |
| **F** | toggle FPS counter |
| mouse | look (click the title screen to lock the pointer) |

## What's reconstructed

Layout follows the archaeological surveys of the Sui-Tang outer city, simplified
to a clean grid:

- **The 108-ward grid** with rammed-earth ward walls and gates, named after the
  historical 坊 (Pingkang, Chongren, Jinchang, Anren, …). Northern wards are
  dense compounds; southern rows are sparse farmland, as they actually were.
- **Zhuque Avenue** (朱雀大街) — the 150 m-wide, 5 km-long Vermilion Bird Avenue
  dividing Wannian and Chang'an counties, plus the full avenue grid.
- **The Imperial City** (皇城) with its ministry compounds and the Chengtian Gate.
- **Taiji Palace** (太极宫) — the founders' palace city, with Taiji Hall on its
  terrace, rear halls, the East Palace and Yeting quarters.
- **Daming Palace** (大明宫) on Dragon-Head Plain: **Hanyuan Hall** on its triple
  terrace reached by the **Dragon-Tail Way** (you climb it), the Xuanzheng and
  Zichen halls, the **Taiye Pool** with Penglai isle, and **Linde Hall**.
- **Xingqing Palace** (兴庆宫) with Dragon Pond — Xuanzong's residence.
- **East & West Markets** (东市 / 西市) — nine blocks each, shop rows, stalls you
  can trade at, caravan camels and ox-carts. The West Market is the Silk Road
  terminus.
- **The Giant & Small Wild Goose Pagodas** (大雁塔 / 小雁塔) and Daxingshan
  Monastery, with their courtyards.
- **Qujiang Pond & the Lotus Garden** (曲江 / 芙蓉园) — the city's pleasure lake.
- **Climbable city walls**: horse ramps beside every gate take you up onto the
  rammed-earth ramparts with their parapets, gate towers and corner towers.
- Street trees lining every avenue, ~650 NPCs walking the streets and markets,
  gate guards, lantern glow at night, and a moat with bridges.

A location banner names where you stand in Chinese and English, and the first
time you reach each landmark a short historical note appears.

## Code layout

| file | role |
|---|---|
| `index.html` | DOM, HUD, import map |
| `src/main.js` | renderer, sky/light presets, build sequence, game loop |
| `src/layout.js` | the historical city plan (wards, streets, gates, landmarks) + map painter |
| `src/parts.js` | instancing engine, Tang roof/building/pagoda geometry factories |
| `src/textures.js` | all canvas-generated textures (zero external assets) |
| `src/city.js` | outer walls & gates, wards, markets, street trees |
| `src/palaces.js` | Imperial City, Taiji / Daming / Xingqing palaces, monasteries, Qujiang |
| `src/npcs.js` | instanced street crowd + gate guards |
| `src/player.js` | first-person controller, collision, walkable terraces/ramps |
| `src/hud.js` | location banner, trading, minimap, full map |
| `src/rng.js` | seeded PRNG (the city is identical every visit) |

Everything is generated procedurally from the seed at load — there are no image
or model files to ship.
