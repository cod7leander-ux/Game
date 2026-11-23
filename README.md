# Terra Dominion

An original, offline 3D grand-strategy / real-time strategy game: you take command of one nation on a living Earth while every other country is run by AI. Inspired by the strategic scale of classic world-map RTS games, with its own world, rules, art direction and interface.

**Status: Milestone 1 complete** — playable 3D Earth, nation selection with dossiers, an offline campaign loop (economy, research, production, diplomacy, AI), and a versioned local save system in English and Persian.

---

## Engine and runtime

**Three.js + React + TypeScript on Vite**, rendered with WebGL.

Why this stack:

- The target is a persistent, data-heavy world simulation rendered as a globe with continuous zoom down to battlefields. A browser-native engine gives instant distribution, offline execution (after the first load) and a rendering layer that can later be hosted as static assets anywhere.
- **Three.js** provides a thin, explicit WebGL layer: one merged country mesh, instanced units, custom shaders and full control over draw calls. That control is what keeps a 174-country planet at a handful of draw calls and lets the same camera rig span world → country → region → city → battlefield.
- **React** is used only for interface and screen composition; the simulation is plain TypeScript classes and never lives in component state. React never runs per-frame gameplay logic.
- **TypeScript** everywhere, with typed message keys, typed unit/tech data and a versioned save schema, because a long-lived game accumulates content faster than code.

The gameplay layer has no dependency on Three.js or React. It can be simulated headlessly (tests, AI tuning, future dedicated servers) while the renderer consumes snapshots.

---

## Project structure

```
src/
  core/           config (all tuning), math, seeded RNG, EventBus, Simulation clock
  data/           content catalogs: countries, cities, units, research, governments,
                  personalities, resources  (data only, no logic)
  gameplay/       the simulation — engine-agnostic
    World.ts        country registry, adjacency, seeded starting diplomacy
    Simulation.ts   deterministic day tick order
    country/        CountryState factory, modifiers, types
    economy/        income, resources, stability
    research/       tech progress and effects
    military/       formations, production queues, upkeep
    diplomacy/      relations, wars, alliances, trade (weekly tick)
    ai/             AI director + utility evaluators
    events.ts       typed simulation event union
  game/           campaign facade (GameSession), snapshots, nation preview
  render/         Three.js globe, camera rig, geometry builder, palette
  state/          zustand stores (app phase/session, persisted settings)
  i18n/           typed EN/FA catalogs, locale definitions, Intl formatters
  save/           versioned save schema, migrations, IndexedDB/localStorage
  ui/             screens, panels, dialogs, shared components, global CSS
scripts/          Natural Earth → slim country dataset converter
public/fonts/     Vazirmatn (Persian typography)
```

Rules of the codebase: gameplay never imports the renderer or React; screens never mutate simulation objects directly (they call `GameSession` actions); all user-visible text goes through `useI18n`; all tuning constants live in `core/config.ts` or data files, never inline in components.

---

## World map architecture

- **Data**: Natural Earth 1:110m admin-0 boundaries (public domain), converted by `scripts/build-country-data.mjs` into `src/data/countries.json` — 174 countries, 278 polygons with holes, English and Persian names, bounds and a label anchor. Regenerate with `npm run data:countries -- path/to/countries.geojson`.
- **Geometry**: all countries are merged into a single extruded mesh with per-vertex country index, biome tint and a wall ring for coastlines. Borders are one line mesh, the ocean is one sphere, the atmosphere one shell, cities one point cloud. Result: a handful of draw calls for the entire planet.
- **Zoom ladder**: one continuous orbital camera (focus lon/lat + altitude + heading + tilt). There is no controller swap; detail tiers drive shader detail, labels and future unit LOD. A long jump snaps, short hops glide.
- **Terrain relief**: a small shader injection adds continental relief and fine noise that fades in as the camera descends, so the same mesh reads as a globe at altitude and as terrain up close, without textures.
- **Detail tiers** in `CAMERA.detailTiers` define global / country / region / city thresholds. Battlefield rendering will be a sibling render layer selected by the same tier value.
- **Picking**: raycast against the merged surface plus the per-vertex `countryIndex` attribute — no per-country meshes, so hundreds of countries cost the same as one.
- **Scale plan**: region meshes and unit instancing will stream per visible tile; the country mesh stays resident because it is already cheap. AI and simulation are already spatial-partition-ready (adjacency graph, per-country state).

## Country architecture

`CountryState` (gameplay) is the authoritative runtime object: population, GDP, treasury, resource stockpiles, industry, stability, tax rate, government, research progress, military formations and queues, diplomacy relations, AI memory and strategic focus. The static `CountryDefinition` holds identity, geometry, names, flag colors and bounds. The AI personality, government and postures are data (`data/personalities.ts`, `data/governments.ts`) and only referenced by id.

Nation previews use the same factory as a live campaign with the fixed default seed (`GAME.defaultSeed`), so the dossier a player sees before starting is exactly the country they get.

## AI architecture

`AIDirector` is a scheduling and arbitration layer, not a script:

- Countries are evaluated on a staggered 1-in-7-day schedule, so a 174-country world costs about 25 evaluations per day instead of 174.
- Each evaluation scores a list of **utility evaluators** (`DEFAULT_EVALUATORS`): build army, research, economy, fortify, aggression, diplomacy. Adding behaviour means adding an evaluator or a posture weight, not editing a monolith.
- Postures (aggressive, defensive, expansionist, economic, diplomatic, technological, naval, air, balanced) reweight the same evaluators, which is how nations diverge without bespoke code.
- Every AI action goes through the same public systems the player uses (`ResearchSystem`, `MilitarySystem`, diplomacy), so rules cannot drift between player and AI.
- A fiscal guard stops AI nations from spending themselves into an unrecoverable deficit.

## Unit architecture

Units are pure data (`data/units.ts`): domain, tier, stats (attack, defence, range, speed, detection), costs, build time, upkeep, manpower, required techs, and a `visual` block (variant, silhouette, palette) that the future model pipeline reads. The combat/movement engine will consume the same definitions; adding a unit is a data entry plus an optional model reference. 34 units ship across ground, air, naval and support, including locked tiers that open through research.

## Economy, research, diplomacy

- **Economy**: money, energy, steel, oil, rare materials, electronics and food; sublinear GDP→tax revenue, government tax/upkeep modifiers, stability feedback, industry-driven resource production and oil demand from the army.
- **Research**: 21 technologies in 7 branches, data-driven effect list (production, income, research speed, stability, attack, defence, manpower, unit unlocks) applied through country modifiers.
- **Diplomacy**: relations in [-100, 100], wars, alliances, trade, weekly AI diplomacy. Player-facing actions are deliberately locked in Milestone 1; the systems and save data already support them.

## Localization

Typed catalogs (`src/i18n/locales/en.ts`, `fa.ts`) keyed by `MessageKey`, so a missing key is a compile error. Content (country, city, unit, tech, government, personality names/descriptions) is `LocalizedText { en, fa }` in the data files. `useI18n()` exposes `t`, and locale-aware `n`, `compact`, `signed`, `percent`, `decimal`, `timestamp` — every number and date goes through it so Persian digits, separators and the `٪` sign are consistent. Direction is applied at the document root, layouts use logical CSS properties, and Vazirmatn is bundled for Persian typography. Adding a language is a catalog plus a `LOCALES` entry.

## Save architecture

`SaveFile` is versioned (`CURRENT_SAVE_VERSION`, migration chain in `save/migrations.ts`). A save contains campaign metadata, the full world (every country's state, AI memory, queues, relations), clock, notifications and seed. Storage is IndexedDB with a localStorage fallback, six slots (`auto`, 1–5), plus JSON import/export. Saves are schema-validated on load; incompatible or corrupt files surface a localized error instead of breaking the app.

## Asset and reference-image pipeline

Gameplay is completely decoupled from visuals. A unit's `visual` descriptor is the seam: `{ variant, silhouette, palette }` today, a model id / GLB reference tomorrow. The planned pipeline:

1. Reference image provided for a unit, building, UI element or environment.
2. The silhouette, proportions, materials and design language are extracted into a model brief (not a generic substitute).
3. A GLB (with PBR materials) is produced and registered in the asset manifest under the unit's `visual.model` id.
4. The renderer instantiates it through the same instanced unit layer; gameplay data and combat stats are untouched.

Quality tiers control model LOD, material complexity and effects, so visual upgrades never require gameplay changes.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production bundle
npm run preview   # serve the production build
```

## Milestone roadmap

1. **Done** — foundation, 3D Earth, camera ladder, nation selection and dossiers, campaign shell, economy/research/military/diplomacy/AI simulation, save/load, EN + FA.
2. Country depth: deeper economy, trade routes, AI budgeting, events.
3. Military on the map: army stacks, movement, 3D battlefield layer, first fighter/tank/infantry/drone models and combat.
4. Advanced AI, territory capture, peace deals, alliances in play.
5. Production-quality assets, PBR materials, effects, audio, advanced UI, optimization pass.
6. Content expansion to hundreds of units and a deeper world simulation.

## Known limitations (Milestone 1)

- Player-issued wars, alliances, trade and army movement are intentionally not wired yet; the AI and data layers already support them.
- The world surface is a single merged mesh; region-level geometry and unit instancing arrive with Milestone 3.
- No audio yet.
- The cloud preview VM renders with a software rasteriser (SwiftShader); the game detects that and selects the low preset, but frame rate there is far below what a hardware GPU delivers.
