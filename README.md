# Terra Dominion

An original, offline 3D grand-strategy / real-time strategy game: you take command of one nation on a living Earth while every other country is run by AI. Inspired by the strategic scale of classic world-map RTS games, with its own world, rules, art direction and interface.

**Status: Milestone 3 complete** — the Milestone 2 campaign now sits on a scalable tactical military foundation: data-driven unit definitions and weapons, individual 3D units on the globe, ground and air movement, line/column/wedge formations, detection and targeting, real-time damage and destruction, placeholder projectiles, a battlefield mode layered over the strategic battle resolution, tactical selection and command UI, and save schema v3 — all in English and Persian.

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
  data/           content catalogs: countries, cities, units, tactical profiles,
                  weapons, research, governments, personalities, resources
                  (data only, no logic)
  gameplay/       the simulation — engine-agnostic
    World.ts        country registry, adjacency, seeded starting diplomacy
    Simulation.ts   deterministic day tick order
    country/        CountryState factory, modifiers, types
    economy/        income, resources, stability
    research/       tech progress and effects
    military/       armies, strategic movement, battles, production, upkeep
    tactical/       battlefield engine: units, formations, targeting, weapons,
                    projectiles, spatial grid, tactical AI, strategic bridge
    diplomacy/      relations, wars, alliances, trade (weekly tick)
    ai/             AI director + utility evaluators
    events.ts       typed simulation event union
  game/           campaign facade (GameSession), snapshots, nation preview
  render/         Three.js globe, camera rig, geometry builder, army markers, palette
    units/          instanced 3D unit layer + procedural placeholder geometry
    assets/         asset manifest/resolver (placeholder now, GLB models later)
  state/          zustand stores (app phase/session, persisted settings)
  i18n/           typed EN/FA catalogs, locale definitions, Intl formatters
  save/           versioned save schema, migrations, IndexedDB/localStorage
  ui/             screens, panels, dialogs, shared components, global CSS
scripts/          Natural Earth converter, headless simulation smoke test
.github/          CI: typecheck, production build, smoke test
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

Units are pure data (`data/units.ts`): domain, tier, stats (attack, defence, range, speed, detection), costs, build time, upkeep, manpower, required techs, and a `visual` block (variant, silhouette, palette). 34 units ship across ground, air, naval and support, including locked tiers that open through research.

The tactical layer adds two more data catalogs and **no per-unit code**:

- **`data/tacticalProfiles.ts`** — how a unit behaves on a battlefield: movement layer (ground/air), cruise altitude, footprint, tactical speed, turn rate, sensor range, standoff, formation spacing and the weapon ids it carries. Profiles are derived from the strategic definition by role and overridden only where the battlefield needs it (the six placeholder units have explicit overrides).
- **`data/weapons.ts`** — weapon definitions: damage, range, accuracy, cooldown, projectile speed/kind, target layers, armour penetration, splash radius, ammunition and burst. One resolver drives every weapon, so machine guns, cannons, artillery, rockets, air-to-air/air-to-ground missiles, SAMs and cruise missiles share the same code path.

Adding a unit therefore means: a strategic entry, an optional tactical profile, and an asset id. Combat, AI, economy, country logic and saves do not change.

The Milestone 3 placeholder roster — rifle infantry, main battle tank, towed artillery, air-superiority fighter, attack helicopter and recon drone — is fully functional. Their visuals are deliberately crude procedural silhouettes; see the asset pipeline below.

## Tactical military layer

`src/gameplay/tactical` is a separate, engine-agnostic real-time layer beneath the strategic map:

- **Tactical units** are spawned from an army's composition. A token represents a share of formations (weight), so a 40-formation army is represented by at most 12 tokens instead of 40 objects — the same pattern that will scale to thousands of units.
- **Movement** is positional, not country-to-country: units drive toward waypoints or targets, rotate at a data-driven turn rate, slow while turning, stop on arrival, hold, resume, and stay inside the battlefield footprint. Air units cruise at altitude (fighters ~2 400 m, helicopters ~230 m, drones ~1 400 m) and use their own speeds and turn rates; ground units stay on the surface.
- **Formations** (`formations.ts`) generate line, column and wedge slots in a local frame; a formation can wheel by rotating its slots, and each side's anchors are re-laid without rebuilding the layout. Adding formation types is one generator function.
- **Detection and targeting** use a uniform spatial hash rebuilt per step, so each unit queries a few nearby cells rather than the whole battle. Acquisition filters by sensor range *and* by whether the unit carries a weapon that can engage the target's layer — fighters cannot shoot infantry, and infantry cannot shoot aircraft. Targets are re-evaluated on an interval and dropped when destroyed or out of range.
- **Combat** runs on a fixed 100 ms step: weapon cooldowns, accuracy rolls, armour mitigation with penetration, burst fire, projectile flight (ballistic, rocket or homing missile), splash damage with falloff, health, kills and destruction. Different archetypes behave differently purely through their data.
- **AI command** (`TacticalCommander`) controls every non-player side using the same public orders as the player: advance the formation, hold, withdraw when badly damaged, and focus fire. It is intentionally small — the foundation for a deeper battlefield AI rather than a scripted opponent.
- **Determinism and scale**: seeded RNG, fixed steps, reused buffers, bounded token/projectile counts and instanced rendering. No per-unit allocations in the hot loop and no per-unit render objects.

## Battlefields, camera and the strategic link

The strategic layer stays authoritative. `ArmySystem` still resolves each engagement with `resolveBattle`, but now publishes both sides' **pre-battle rosters** with the `battleResolved` event. `BattlefieldManager` opens a 3D battlefield when the player is involved (AI-only wars stay abstract so a world war does not spawn hundreds of scenes), and the tactical battle is advanced in real time while the campaign clock is running.

Casualties are reconciled, not contradicted: the strategic result supplies the winner and the formations lost, and the tactical battle enforces that quota if its own combat has not already destroyed those tokens. The player can watch and command the engagement, but the campaign outcome is the one the simulation recorded.

The camera remains one continuous rig (no controller swap): global → country (`frameCountry`) → army (`frameArmy`) → battlefield (`enterBattlefield`), with pan, rotate, zoom and a return to the strategic view. Entering a battle simply flies the same orbit camera to region altitude over the battlefield anchor.

Selection works in 3D: unit tokens are raycast through the instanced layer, selected units get a ring plus a highlighted tint, and the tactical HUD shows name, category, faction, health, strength, movement state, current target, kills and weapon status — every string localised in English and Persian. Orders are formation (line/column/wedge), advance, hold, withdraw, attack nearest and hold position.

## Performance model

The tactical layer is built for the eventual thousands-of-units target without over-engineering today:

- **Instancing**: one `InstancedMesh` per archetype draws every unit; projectiles are a single instanced mesh; army markers and country geometry stay batched.
- **Spatial partitioning**: a uniform grid answers detection and splash queries from nearby cells only.
- **Fixed-step, batched updates**: one pass per battle step over the unit array, no per-unit timers or scenes.
- **Bounded work**: at most 12 tokens per side, 3 active player battlefields, one spatial rebuild per step, distance-based target intervals.
- **Level of detail ready**: tokens are already projections; a future LOD stage can swap archetype geometry or cull by camera altitude without touching gameplay.

## Armies, battles and occupation

Armies are the operational layer, kept in `CountryState.military.armies` and serialised with the save:

- Each army holds unit stacks (`composition`), stands in a country (`locationId`) and may be marching. `military.formations`, manpower and the strength index are always **derived** from armies by `syncMilitaryTotals`, so upkeep, AI scoring and the interface cannot disagree with the map.
- **Movement** is ordered per army to an adjacent country and takes `distance / 260 km per day` (2–45 days). Neutral soil is closed: an army may enter its own country, an ally's, land it already occupies, or an enemy's. Marches advance in the daily tick, so a save mid-march restores exactly.
- **Battles** resolve on arrival with `resolveBattle`: effective power is the same `armyPower` formula used by the AI and UI, both sides are perturbed deterministically, and casualties are removed per stack. Defeated attackers withdraw to their origin; defeated defenders fall back to their homeland or are destroyed.
- **Occupation**: an army that reaches an undefended enemy country without a defending army or ally present occupies it (`occupierId`). Occupation transfers 40% of the country's daily revenue to the occupier, suppresses its stability and halts its production. A sovereign army re-entering its own land liberates it, and peace returns all occupied territory.
- **AI army command** lives in `AIDirector.commandArmies`: idle armies are matched against the weakest reachable enemy when they hold a 1.2× power advantage, and occupied nations still try to free their homeland. The AI also declares war on much weaker neighbours when its posture is aggressive and sues for peace when badly outmatched.
- **Rendering**: `ArmyMarkers` draws every player and enemy army as an instanced 3D spike planted on the surface at the country anchor, tinted by allegiance, scaled with camera altitude and offset so multiple armies in one country remain readable.

## Strategic depth (Milestone 4)

**Provinces and terrain.** Every country owns 2–5 generated regions (`data/regions.ts`) with a stable id, anchor, population share, industry share, infrastructure, resource richness, airport/port/coastal flags and strategic value. Runtime state lives separately in `CountryState.regions` (`gameplay/regions/types.ts`), so real GIS polygons can later replace the generated anchors through `geometryRef` without touching saves, AI or the economy. Terrain (`data/terrain.ts`) is pure data — plains, hills, mountains, forest, desert, urban, coastal, water — with march, defence, supply, air, detection and industry modifiers plus yields. `terrainProfile()` is the single weighted country-level view used by movement, supply and battle resolution; no separate combat system was introduced.

**Economy and resources.** The daily tick produces steel, aluminium, oil, energy, electronics, food and rare materials region by region from terrain, richness, infrastructure, damage, unrest and industry, then aggregates nationally. Consumption covers army fuel, population food, construction upkeep and corruption; every stockpile and the treasury are capped. `economy.resourceFlow` records the net daily change per resource for the interface and future trade. Stockpiles are finite; population growth follows food and stability, and regional populations scale with it.

**Budget and production.** `economy.allocation` splits industrial capacity between the army, construction and research (normalised to 1). Unit production still uses the existing `MilitarySystem` queue and unit catalogue. Civilian construction is `ProductionSystem` plus eight data-driven projects in `data/production.ts` (roads, rail, power, ports, air bases, depots, industrial zones, fortifications); projects consume money/steel/oil/electronics and industry-days, require technologies and infrastructure levels, and permanently raise a region's infrastructure, supply capacity, industrial bonus or resource output.

**Research.** The tree grew to 29 technologies across 15 branches (adding infantry, artillery, helicopters, drones, missiles, air defence, reconnaissance and advanced weapons). Effects still flow through `recomputeModifiers`; the effect vocabulary gained supply, detection and resource efficiency, and research throughput scales with the research budget share.

**Diplomacy.** `Relation` now carries non-aggression, military access, embargo, sanctions, trust and threat alongside war, alliance and trade. Every transition is normalised in `DiplomacySystem`: war clears pacts, alliances supersede non-aggression, sanctions block trade, breaking a pact destroys trust, and influence is spent on agreements. Contradictory states are prevented in one place and tested. Military access opens neutral territory to movement; trade partners add income; embargoes cut it.

**AI.** The scheduled director (a seventh of nations per day) now adjusts the budget, starts construction, maintains a bounded objective list, selects research from personality-specific branches, forms pacts/alliances and embargoes rivals. `gameplay/objectives/` holds typed objectives (defend capital, capture capital/region, secure resources, prepare invasion, recover territory) with priority, target, owner, status and creation day. Army command follows objective priority first, keeps a home guard on defensive postures and refuses attacks it cannot win. No per-frame AI work was added.

**Logistics and stability.** `LogisticsSystem` gives every army a 0..1 supply value driven by territory, source (home/allied/access), distance, infrastructure, terrain, occupation and logistics technology. Below 45% supply, readiness falls; sustained unsupply causes attrition and can destroy formations. `StabilitySystem` owns war exhaustion, unrest and national stability, fed by shortages, debt, occupation, war and government baseline; stability feeds income, production, research and AI posture. Supply also slows marches and weakens combat power.

## Localization

Typed catalogs (`src/i18n/locales/en.ts`, `fa.ts`) keyed by `MessageKey`, so a missing key is a compile error. Content (country, city, unit, tech, government, personality names/descriptions) is `LocalizedText { en, fa }` in the data files. `useI18n()` exposes `t`, and locale-aware `n`, `compact`, `signed`, `percent`, `decimal`, `timestamp` — every number and date goes through it so Persian digits, separators and the `٪` sign are consistent. Direction is applied at the document root, layouts use logical CSS properties, and Vazirmatn is bundled for Persian typography. Adding a language is a catalog plus a `LOCALES` entry.

## Save architecture

`SaveFile` is versioned (`CURRENT_SAVE_VERSION = 4`, migration chain in `save/migrations.ts`). A save contains campaign metadata, the full world (every country's state, provinces, economy allocation and resource flow, production queues, objectives, armies and marches with supply, occupation, AI memory, queues, relations incl. trust/threat/pacts), clock, notifications, seed and any active **battlefields** — including tactical unit positions, altitude, heading, health, formation, targets, cooldowns, casualties and team assignment.

Migrations keep old campaigns loading:

- **v1 → v2** gives every country a field army built from its old aggregate formations and an explicit `occupierId`.
- **v2 → v3** gives every army a default formation and adds the battlefield list.
- **v3 → v4** regenerates deterministic provinces for every country, adds aluminium, budget allocation, resource flow, production/objectives, war exhaustion/unrest, army supply fields and the expanded agreement set with neutral defaults — no saved army, relation or territory is dropped.

Storage is IndexedDB with a localStorage fallback, six slots (`auto`, 1–5), plus JSON import/export. Saves are schema-validated on load; incompatible or corrupt files surface a localized error instead of breaking the app.

## Asset and reference-image pipeline

Gameplay is completely decoupled from visuals. Every tactical profile carries an `assetId` (`unit.<id>.v1`), and `render/assets/unitAssets.ts` resolves it to a `UnitAsset`: archetype, model id/URL, material id, scale, VFX id and audio id. Until real models exist, an unregistered asset resolves to a procedural placeholder silhouette — the game never depends on a specific placeholder model.

Replacing a placeholder is therefore a registration, not a refactor:

```ts
registerUnitAsset({
  assetId: 'unit.air_fighter.v1',
  archetype: 'aircraft',
  modelId: 'fighter-v2',
  modelUrl: '/models/fighter-v2.glb',
  materialId: 'fighter-pbr',
  scale: 1,
  vfxId: 'vfx.jet.exhaust',
  audioId: 'audio.jet.pass',
});
```

Intended workflow for future reference images:

1. A reference image is provided for a unit, building, UI element or environment.
2. Silhouette, proportions, materials and design language are extracted into a model brief (not a generic substitute).
3. A GLB with PBR materials is produced and registered under the existing `assetId`.
4. The instanced unit layer draws it through the same projection; combat, AI, economy, country logic and saves are untouched.

Quality tiers control model LOD, material complexity and effects, so visual upgrades never require gameplay changes.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production bundle
npm run preview   # serve the production build
npm test          # headless campaign, tactical and strategic suites (economy, AI, logistics, migrations)
```

The headless suites run the real simulation and tactical engine in Node, without a browser:

- `scripts/sim-smoke.ts` — campaign, armies, war, battles, occupation, save round-trip, v1 migration.
- `scripts/tactical-smoke.ts` — token creation, formations, movement/rotation/stopping, layer-aware targeting, weapon cooldowns, damage and destruction, projectile simulation, strategic→tactical bridge, battlefield persistence, team assignment and the v2 → v3 migration.
- `scripts/strategic-smoke.ts` — regional economy/resources, construction queue and completion, research progress and effects, diplomatic pacts/war/peace/embargo guards, stability and war exhaustion, supply and attrition, AI focus/objectives, v4 round-trip, v3 → v4 migration, the full v1 → v4 chain and a 180-day multi-country campaign regression.

GitHub Actions runs the same typecheck, production build and test suites on every push and pull request (`.github/workflows/ci.yml`).

## Milestone roadmap

1. **Done** — foundation, 3D Earth, camera ladder, nation selection and dossiers, campaign shell, economy/research/military/diplomacy/AI simulation, save/load, EN + FA.
2. **Done** — field armies on the globe, strategic movement between neighbours, 3D army markers, deterministic battles, territorial occupation and liberation, AI army command, player war/peace actions, save schema v2, CI.
3. **Done** — tactical military foundation: data-driven units and weapons, 3D units on the globe, ground/air movement, formations, detection, targeting, real-time combat, placeholder projectiles, battlefield mode, tactical selection and command UI, save v3.
4. **Done** — strategic depth: provinces and terrain, regional economy and resources, budget allocation, infrastructure production, expanded research, trust/threat diplomacy with pacts and embargoes, scheduled strategic AI with objectives, supply/logistics, unrest and war exhaustion, strategic UI and save v4 (v3 → v4 migration). Trade routes and world events remain future work.
5. Final unit models from reference images, PBR materials, VFX and audio for the tactical layer; unit LOD and battlefield streaming.
6. Advanced AI, peace deals with terms, alliances that fight together on the map, deeper battlefield AI.
7. Content expansion to hundreds of units and a deeper world simulation.

## Known limitations (Milestone 4)

- Provinces are generated deterministically from country data, cities and anchors rather than real administrative polygons; `geometryRef` is the seam for a GIS dataset, and the map draws province markers rather than filled borders.
- Occupation is still whole-country. Region control exists in state and in the inspector, but capturing a country occupies every province at once and no separate peace terms or annexation exist yet.
- Resource flow is tracked per country, not per trade route: trade agreements add income but there is no convoy, blockade or market price model yet.
- Logistics is one supply value per army derived from the standing country, not a routed supply network; there are no depot stockpiles or interdiction.
- The strategic AI plans with a bounded objective list and coarse strength comparisons. It does not coordinate multi-army offensives or evaluate long-term war costs beyond treasury and supply checks.
- Terrain modifies strategic movement, supply, defence and industry; tactical battles use the country's weighted terrain defence but not per-tile cover, height or line-of-sight.
- The new panels and province markers were verified through typecheck, production build and the headless suites, not by clicking through a browser in this milestone.
- Strategic movement is still one hop at a time between adjacent countries; adjacency comes from label proximity, not border geometry, and there is no multi-hop pathfinding.
- Tactical battles **represent** an engagement the strategic layer already resolved. The winner and the formation losses are authoritative; tactical combat reconciles to that quota rather than feeding a new result back. A battle also runs in real time while campaign days advance.
- Only engagements involving the player spawn a 3D battlefield. AI-vs-AI wars remain abstract, though the AI commands its side in any battlefield it fights.
- Battlefields are anchored at a country's label on the globe and units stand on the sphere surface; there is no terrain height sampling, cover or terrain modifier yet, and no obstacle pathfinding or collision avoidance (formations are direct slots, so units can overlap).
- Visuals are placeholders: one procedural silhouette per archetype, no skeletal/prop animation, tracer trails, impact VFX or audio. Projectiles are instanced spheres.
- Targeting uses range, sensor radius and target layers. Stealth, electronic warfare, line-of-sight and terrain masking are represented in data but not yet applied. Weapon ammunition is in the schema but treated as unlimited for this era.
- Battlefields are capped at 12 tokens per side and 3 active player battles. The data structures are instancing/spatial-partition ready, but the caps keep the current build responsive.
- Occupation is whole-country and ends on liberation or peace; there are no separate peace terms, war score or annexation.
- The world surface is a single merged mesh; region-level geometry arrives with a later milestone.
- The tactical HUD and 3D unit rendering were verified through the headless suites (typecheck, build, simulation tests), not by clicking through a browser in this milestone.
- The cloud preview VM renders with a software rasteriser (SwiftShader); the game detects that and selects the low preset, but frame rate there is far below what a hardware GPU delivers.
