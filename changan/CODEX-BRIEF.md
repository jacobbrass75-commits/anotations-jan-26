# CODEX BRIEF — Turn Chang'an into a true, max-fidelity simulation

> Hand-off from the previous agent (Fable). This document is the spec. The
> short **Kickoff Command** at the very bottom is what you paste into Codex;
> everything above it is reference that Codex should read from the repo before
> and during the work.

---

## 0. TL;DR for the human

1. Make sure the starting code (the `changan/` folder) exists in the repo you
   want Codex to work in. It currently lives on branch
   `claude/changan-tang-dynasty-city-421qmc` in `jacobbrass75-commits/anotations-jan-26`.
   Copy that folder into **`jacobbrass75-commits/videogame`** (or point Codex at
   wherever it lives).
2. Paste the **Kickoff Command** (bottom of this file) into Codex.
3. Codex reads the rest of this file from the repo and works phase by phase,
   committing after each phase.

---

## 1. Mission

Transform the existing **walkable diorama** of Tang-dynasty Chang'an (743 CE)
into a **living simulation at maximum visual fidelity** that the player
experiences first-person as a Silk Road merchant. "Max fidelity" and "true
simulation" are defined concretely in §4 — do not interpret them loosely.

The thing must still **run in a browser, fully offline, with no external asset
downloads**, and target a high-end GPU (AMD Radeon RX 9070 XT) at 1440p–4K,
60+ fps. You have enormous GPU headroom; spend it on fidelity, not on bloat.

---

## 2. Repository & setup

- **Work in repository:** `jacobbrass75-commits/videogame` (confirm with the
  human if different).
- **Starting point:** the `changan/` folder authored by the previous agent.
  If it is not already in this repo, fetch it from branch
  `claude/changan-tang-dynasty-city-421qmc` of `jacobbrass75-commits/anotations-jan-26`
  and copy the `changan/` directory in verbatim as your foundation.
- **Branch:** create `codex/changan-simulation` and develop there. Commit after
  every phase with a clear message. Do not force-push. Open a PR only when the
  human asks.
- **Run locally:** `cd changan && python3 -m http.server 8000`, open
  `http://localhost:8000/`. It is a static ES-module app with an import map;
  Three.js r165 is vendored in `changan/vendor/`. There is no build step today
  (see §5 for whether you may add one).

---

## 3. Current state — what Fable already built (do NOT rewrite from scratch)

A self-contained Three.js app. ~2,400 lines, 11 modules, zero external assets
(every texture is generated on a `<canvas>` from a seeded PRNG; the whole city
is deterministic). Smoke-tested headless: ~62k instances in ~260 draw calls,
builds in ~160 ms, no console errors.

**What exists and is CORRECT (keep and build on):**
- True-scale plan (~9.7 × 8.7 km): the 108-ward grid, the 5 km / 150 m-wide
  Zhuque Avenue + full avenue grid, the Imperial City, Taiji / Daming / Xingqing
  palaces (Hanyuan Hall on a triple terrace with a climbable Dragon-Tail Way,
  Taiye Pool, Linde Hall, Dragon Pond), East & West markets, the Giant & Small
  Wild Goose Pagodas, Daxingshan Monastery, Qujiang pond, climbable city walls
  with gate/corner towers, moat + bridges, street trees, ~650 instanced walking
  NPCs, gate guards, a day/night preset cycle, a location banner with historical
  notes, a minimap, and a full city map (M).
- A solid **first-person controller** with AABB collision via a spatial hash and
  walkable height-regions (walls, terraces, ramps), horse mode, jump.
- An **instancing engine** (`Instancer` in `parts.js`) that buckets repeated
  geometry into per-sector `InstancedMesh`es with frustum-cull spheres.

**What is THIN and is your job to deepen (honest limitations):**
- Buildings are parametric boxes + roof shells — correct silhouette, schematic
  up close. No interiors; gates/pagoda bases are solid.
- "Trading" is flavor only: press E near a stall → random buy/sell, coins tick.
  No inventory, no economy, no persistence.
- NPCs walk fixed street segments and bounce at the ends — no pathfinding, no
  schedules, no reaction to the player.
- Time of day is a 4-preset toggle (T), not a continuous clock. No curfew, no
  ward-gate closing, no drums/bells.
- Materials are flat `MeshLambertMaterial` with canvas albedo only — no
  normal/roughness maps, no PBR, no ambient occlusion, no postprocessing.
- No audio.

**Module map (extend these; don't duplicate):**

| file | role |
|---|---|
| `src/main.js` | renderer, sky/light presets, build sequence, game loop |
| `src/layout.js` | historical city plan (wards, streets, gates, landmarks) + map painter |
| `src/parts.js` | instancing engine, Tang roof/building/pagoda geometry factories |
| `src/textures.js` | all canvas-generated textures |
| `src/city.js` | outer walls & gates, wards, markets, street trees |
| `src/palaces.js` | Imperial City, palaces, monasteries, Qujiang |
| `src/npcs.js` | instanced street crowd + gate guards |
| `src/player.js` | first-person controller, collision, walkable regions |
| `src/hud.js` | location banner, trading, minimap, full map |
| `src/rng.js` | seeded PRNG (deterministic city) |

There is a `window.changan` debug API (`tp(x,z,yaw,pitch)`, `time(i)`, `player`,
`world`) — use it for headless verification.

---

## 4. Definition of Done — what "true simulation" and "max fidelity" mean

Build toward ALL of these. Each is expanded into a phase in §7.

### Simulation pillars
1. **Continuous time & the curfew system.** A real clock over the 12 *shichen*
   (時辰). Dawn bell (晨鐘) and dusk drum (暮鼓) — 400 beats — open and close the
   city. **Ward gates physically close at dusk**; the avenues empty; the Jinwu
   guard (金吾衛) patrols; being caught on a main avenue after curfew has a
   consequence. Markets open at noon by drum and close before dusk by gong.
2. **A real merchant economy.** Inventory with weight/volume, a price model that
   varies by **good × market × supply/demand × distance from source** (silk,
   Khotan jade, Persian silver, Samarkand brocade, tea, spices, horses,
   porcelain, paper, wine). Buy low / sell high, haggling, capital growth,
   ledger, persistence via `localStorage`. Silk bolts as a secondary currency,
   as historically.
3. **Living NPCs with schedules.** Agents have homes, occupations, and daily
   routines tied to the clock (shopkeepers open/close stalls, commuters flow to
   markets midday and home by dusk, monks at temples, the courtesan quarter of
   Pingkang ward at night, guards on patrol routes). Crowds thin at night.
   Cheap, instanced, LOD'd — hundreds visible, thousands simulated coarsely.
4. **Interaction & interiors.** Enter at least: a market shop, a Sogdian
   wineshop (with whirl-dancer), a Buddhist temple hall, and one gate passage you
   can walk through. Talk-to / trade-with prompts. A quest or two (deliver goods,
   make a target profit, attend the Qujiang banquet).
5. **Vehicles & water.** Ride horses (exists), drive an ox-cart, and ideally
   small boats on the canals/Qujiang. Model at least one of the historical
   canals feeding the city.

### Fidelity pillars
6. **PBR materials.** Move to `MeshStandardMaterial`; generate
   normal + roughness + (where apt) metalness + AO maps procedurally on canvas to
   match each albedo (grey *tongwa* tile, vermilion timber, rammed earth, brick,
   stone, gold finials, water). Palace roofs may use **glazed green/black tile**
   (research §8) distinct from grey civic tile.
7. **Real architecture detail.** Proper **dougong** bracket-set geometry under
   eaves, polychrome beam painting on palace halls, *chiwei* owl-tail ridge
   finials and ridge-beast files, lattice windows and panelled doors as geometry,
   stone balustrades on terraces, the Dragon-Tail Way as a true ramped causeway.
   Add LOD so detail only renders near the camera.
8. **Lighting & atmosphere.** A continuous sun/moon arc driven by the clock,
   cascaded or large-frustum shadows that track the player, soft AO
   (SSAO/GTAO via postprocessing), bloom on lanterns at night, volumetric-ish
   dusk haze, and weather variety (clear / overcast / light rain / loess dust).
   Hundreds of warm lantern lights at night without tanking perf (instanced
   emissive + a few real lights near the player).
9. **Audio.** Positional Web Audio: market murmur, the dawn bell and dusk drum,
   footsteps (stone vs earth vs wood), horse hooves, temple chimes, water, wind.
   All synthesized or tiny vendored CC0 clips — must work offline.
10. **Performance.** Maintain 60+ fps at 1440p on a 9070 XT with all of the
    above. Use `BatchedMesh` (available in r165) and/or instanced LOD, frustum
    culling per sector, and a `?lite` query flag that degrades gracefully.

---

## 5. Non-negotiable constraints

- **Offline-first.** No runtime network fetches. No CDN. Assets are either
  procedurally generated or vendored into the repo with their license. If you
  vendor any model/texture/audio, it MUST be CC0/public-domain and the license
  committed next to it.
- **Determinism preserved.** The city geometry is seeded; keep it reproducible.
  Simulation state (economy, NPC schedules) may be stochastic at runtime but
  should seed from the same source so a fresh load is repeatable.
- **No regressions.** The app must always load and be walkable after every
  phase. Never leave `main` (your branch) in a broken state across a commit.
- **Build step:** the parent repo uses Vite. You MAY add a dedicated Vite build
  for the `changan/` app **only if** the output remains a static site that still
  runs offline, and you keep the no-build `index.html` entry working OR document
  the new run command in the README. Prefer staying zero-build unless a phase
  genuinely needs bundling. If you switch to npm-installed `three`, pin r165+.
- **ES modules**, import map or bundler — no globals soup.
- Keep everything under the **`changan/`** folder.

---

## 6. How to work

### Use subagents / research passes
For each phase, FIRST gather facts, THEN build. If your harness supports
subagents, spawn them in parallel; if not, run these as discrete research passes
and write findings to `changan/docs/research/<topic>.md` before coding.

- **History research subagents** — accuracy is the point of this project. Use the
  prompt library in §8. Always capture: concrete numbers (dimensions, counts,
  times), citations/sources, and a "how to model it" note.
- **Technical research subagents** — confirm current Three.js r165 APIs before
  using them (BatchedMesh, LOD, the postprocessing `EffectComposer`/`N8AO`/SSAO
  options compatible with r165, Web Audio positional setup). Don't code against
  half-remembered APIs.
- **Reviewer subagents** — after each phase, run a perf reviewer (draw calls,
  frame time, memory) and a code-quality reviewer over the diff.

### Verify every phase headlessly (the previous agent did this)
There is no GPU in CI, but software rendering works. Use Playwright +
`@sparticuz/chromium` with flags:
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`.
Load the page, wait for build, then drive `window.changan.tp(...)` /
`window.changan.time(...)` to teleport to landmarks and screenshot. Assert zero
console errors and check the build-stats log line. Commit a reusable
`changan/tools/shoot.mjs` so this is repeatable.

### Commit discipline
One phase per commit (or a few focused commits per phase). Message format:
`changan: <phase> — <what changed>`. Update `changan/README.md` and
`changan/docs/` as you go.

---

## 7. Phased roadmap

Do them roughly in order; 0–4 unlock the "simulation," 5–8 the "fidelity."
Each phase = research → implement → headless-verify → commit.

**Phase 0 — Foundation & safety net.**
Copy code in, create the branch, add `changan/tools/shoot.mjs` headless harness,
add a tiny ECS-ish update bus / `SimClock` module so later systems hang off one
clock. Acceptance: app loads, harness screenshots 6 landmarks, 0 errors.

**Phase 1 — Continuous time, bells, drums, curfew, ward gates.**
Replace the 4-preset toggle with a continuous clock (configurable speed; default
~1 day ≈ 20 min). Sun/moon position from the clock. Implement dawn bell / dusk
drum events; ward gates animate shut at dusk and open at dawn (add gate-leaf
geometry + a collider that toggles); markets open/close on schedule; Jinwu
patrols + a curfew consequence on avenues at night. HUD shows the *shichen*.
Research: §8 "curfew & timekeeping," "markets." Acceptance: time advances,
gates visibly close and block passage at night, drums/bells fire.

**Phase 2 — Merchant economy & inventory.**
Inventory model (items, weight, qty), price model (good × market × supply/demand
× distance), buy/sell/haggle UI, capital + ledger, `localStorage` persistence,
silk-as-currency. Wire E-to-trade into the real model. Research: §8 "trade goods
& prices," "guild/hangzhi system." Acceptance: can buy in West Market, carry,
sell elsewhere at a different price; balance persists across reload.

**Phase 3 — NPC schedules & crowd AI.**
Give agents home + job + routine tied to `SimClock`; LOD the crowd (full mesh
near, billboard far, statistical far-far). Shopkeepers man/abandon stalls by
hour; commuter flows; Pingkang nightlife; monks; patrols. Research: §8 "daily
life & social classes," "Pingkang ward." Acceptance: market busy at noon, streets
empty after curfew, framerate holds with more agents.

**Phase 4 — Interiors, dialogue & quests.**
Enterable shop, Sogdian wineshop (whirl-dancer), temple hall, one walkable gate
passage. Interaction prompts, simple dialogue, 2–3 merchant quests. Research:
§8 "wineshops & entertainment," "religions & foreign temples." Acceptance: can
enter ≥3 interiors, accept and complete a quest.

**Phase 5 — PBR material overhaul.**
Swap to `MeshStandardMaterial`; generate normal/roughness/AO per material;
glazed palace tile vs grey civic tile; tonemapping/exposure pass. Research: §8
"roof tiles & color," tech "r165 standard material + canvas normal maps."
Acceptance: side-by-side screenshots show depth/specular; draw calls unchanged.

**Phase 6 — Architectural detail + LOD.**
Real dougong sets, polychrome palace beams, chiwei/ridge-beasts, lattice
windows/doors as geometry, terrace balustrades, refined Dragon-Tail Way. Add
`THREE.LOD` (or instanced LOD) so detail only near camera. Research: §8 "Tang
timber architecture & dougong," "Hanyuan Hall dimensions." Acceptance: close-up
of a palace hall reads as carpentered, not boxy; fps maintained via LOD.

**Phase 7 — Lighting, atmosphere, weather, postprocessing.**
Continuous sun/moon, player-tracked large/cascaded shadows, SSAO/GTAO, bloom on
night lanterns (instanced emissive + few real lights), dusk haze, weather states
(clear/overcast/rain/dust) on a cycle. Research tech: r165-compatible
postprocessing. Acceptance: golden-hour, midnight-with-lanterns, and rainy
screenshots all look distinct and run 60+ fps.

**Phase 8 — Audio, polish, persistence, final perf pass.**
Positional Web Audio (market, bell/drum, footsteps by surface, hooves, water,
wind); options menu (time speed, `?lite`, volume, render scale); save/load;
`BatchedMesh`/instancing perf sweep; update README + docs. Acceptance: full
day/night loop with sound, save and resume, documented perf budget met.

---

## 8. Research subagent prompt library (copy-paste)

Each prompt should end with: *"Return concrete numbers, primary/secondary
sources, and a short 'how to model this in a Three.js low-to-mid-poly scene'
note. Write the result to `changan/docs/research/<topic>.md`."*

- **Curfew & timekeeping:** "Detail the Tang-dynasty day/night and curfew system
  in Chang'an c. 743 CE: the 12 shichen, the night watches (更), the dawn bell
  and dusk drum (晨鐘暮鼓, ~400 beats), when and how the ward gates and city gates
  opened/closed, the Jinwu Guard's enforcement and penalties for breaking curfew,
  and exceptions (officials, weddings, festivals)."
- **Markets:** "Detail the East and West Markets of Tang Chang'an: opening hours
  and the drum/gong signals, layout (the 井 cross-streets and blocks), the market
  director's office, the *hangzhi* (行) guild rows, price regulation, and which
  goods clustered where. The West Market as Silk Road terminus and foreign
  trade."
- **Trade goods & prices:** "List the principal commodities traded in Tang
  Chang'an (silk types, Khotan jade, Persian/Sogdian silver, Samarkand brocade,
  tea, spices, frankincense, horses, porcelain, paper, grape wine) with their
  origins, relative values, and the use of silk bolts and copper cash strings
  (緡/貫) as currency. Approximate price ratios if known."
- **Daily life & social classes:** "Describe daily routines and dress of Tang
  Chang'an social classes (officials by rank colour, merchants, artisans,
  farmers, monks/nuns, foreign residents, entertainers) to drive NPC schedules
  and appearance variety."
- **Pingkang ward:** "Detail Pingkang ward (平康坊), the entertainment/courtesan
  quarter near the East Market: its character, nightlife, and how it differed
  from ordinary residential wards."
- **Wineshops & entertainment:** "Describe Tang Chang'an wineshops, especially
  the Western (Sogdian/Persian) taverns with foreign serving-girls and the
  'whirl' dances (胡旋舞), music, and Li Bai's associations, for an enterable
  interior scene."
- **Religions & foreign temples:** "List the religious institutions in Tang
  Chang'an: major Buddhist and Daoist monasteries, and the foreign temples —
  Nestorian Christian (大秦寺), Zoroastrian (祆祠), Manichaean — their locations
  and appearance."
- **Tang timber architecture & dougong:** "Explain Tang-dynasty timber
  architecture for 3D modeling: the dougong (斗拱) bracket-set anatomy and
  proportions, column/beam framing, hip and hip-gable roof forms, eave curvature,
  rooftile types and colours (grey tongwa vs glazed green/black for palaces),
  chiwei (鴟尾) and ridge ornaments, and the vermilion-column/white-wall/grey-tile
  colour scheme. Use Foguang Temple Hall and Nanchan Temple as surviving
  references."
- **Hanyuan & Linde Hall dimensions:** "Give the archaeologically reconstructed
  dimensions and form of Hanyuan Hall (含元殿) and its triple terrace and
  Dragon-Tail Way (龍尾道), the flanking Xiangluan/Qifeng towers and galleries,
  and Linde Hall (麟德殿)'s triple-hall plan, in metres."
- **Canals & water:** "Describe the water-supply canals of Tang Chang'an (the
  Yong'an, Qingming, Longshou canals etc.), where they entered and ran, and the
  Qujiang/Furong garden water system — for modeling waterways and small boats."

Technical research prompts (verify before coding):
- "Confirm the Three.js r165 API for `BatchedMesh`, `LOD`, and the recommended
  postprocessing stack (EffectComposer, SSAO/GTAO/N8AO, UnrealBloom) compatible
  with r165, plus positional audio via `THREE.PositionalAudio`/`AudioListener`."

---

## 9. Final acceptance (the "finish" gate)

The project is done when, in a single offline session in the browser:
- A continuous day passes with sun/moon arc; dawn bell and dusk drum fire; ward
  gates close and curfew empties the avenues; markets open at noon and close by
  dusk.
- The player can buy goods in the West Market, carry inventory, sell at a
  different price elsewhere, haggle, watch capital change, and reload to find it
  persisted.
- NPCs follow daily schedules; the noon market is crowded and the post-curfew
  street is bare; Pingkang ward is lively at night.
- The player can enter at least three interiors and complete at least one quest.
- Palace halls show real dougong/polychrome/chiwei detail under PBR lighting with
  AO, bloom-lit lanterns at night, and at least one weather state besides clear.
- Positional audio plays; an options menu and save/load work.
- It holds **60+ fps at 1440p on a Radeon RX 9070 XT**, degrades via `?lite`,
  and the headless harness reports **zero console errors** across all landmark
  screenshots.
- `changan/README.md` and `changan/docs/` document how to run, the controls, the
  systems, and the perf budget.

---

## 10. KICKOFF COMMAND (paste this into Codex)

```
You are continuing a project, not starting one. Work in the repository
jacobbrass75-commits/videogame on a new branch codex/changan-simulation.

The foundation is the changan/ folder (a walkable Three.js diorama of Tang
Chang'an, 743 CE, authored by a previous agent). If changan/ is not already in
this repo, copy it from the changan/ folder of branch
claude/changan-tang-dynasty-city-421qmc in jacobbrass75-commits/anotations-jan-26.

Read changan/CODEX-BRIEF.md in full before writing any code. It is the spec.
Your mission: turn this diorama into a TRUE, MAX-FIDELITY, FIRST-PERSON
SIMULATION of Chang'an that runs in the browser fully offline and targets an
AMD Radeon RX 9070 XT at 1440p, 60+ fps — per the Definition of Done in §4 and
the phased roadmap in §7 of that brief.

Rules:
- Extend the existing code; do not rewrite from scratch.
- Offline-first: no runtime network, no CDNs; assets are procedurally generated
  or vendored CC0 with license. Keep the city deterministic/seeded.
- Never leave the app broken across a commit; one phase per commit, message
  "changan: <phase> — <summary>". Do not open a PR until I ask.
- For every phase: FIRST run research subagents (history + Three.js r165 API
  checks) using the prompt library in §8 and write findings to
  changan/docs/research/, THEN implement, THEN verify headlessly with
  Playwright + @sparticuz/chromium (swiftshader flags) driving the window.changan
  debug API to screenshot landmarks and assert zero console errors, THEN commit.
  After each phase run a perf-reviewer and code-reviewer subagent over the diff.
- Use parallel subagents wherever the work is independent.

Start with Phase 0, then proceed through Phase 8. Report progress after each
phase. Stop and ask me only for destructive actions or genuine scope changes;
otherwise keep going until the §9 final acceptance gate is met.
```
