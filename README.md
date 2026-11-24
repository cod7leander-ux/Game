# Terra Dominion

An original, offline 3D grand-strategy / real-time strategy game: you take command of one nation on a living Earth while every other country is run by AI. Inspired by the strategic scale of classic world-map RTS games, with its own world, rules, art direction and interface.

**Status: Milestone 6 complete** — wars are now multi-country entities with goals, score and exhaustion; linked frontlines; owner-vs-controller regional occupation; army postures, groups and operations; encirclement and supply warfare; strategic air, air-defence, naval, blockade and missile layers; peace terms with liberation and annexation; a front-aware strategic AI with distinct personalities; a full war-room UI and frontline map layer; save schema v6 and the full v1 → v2 → v3 → v4 → v5 → v6 migration chain — all in English and Persian.

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
  geo/            geographic data layer (engine- and UI-independent)
    provider.ts     GeographicDataProvider, validation, cached world data
    provinces.ts    deterministic province partition + adjacency graphs
    cities.ts       city, airport and port geography with region links
    transport.ts    road/rail/sea/air strategic transport graph
    import.ts       GeoJSON normalisation pipeline for real GIS data
  gameplay/       the simulation — engine-agnostic
    World.ts        country registry, geographic adjacency, seeded diplomacy
    Simulation.ts   deterministic day tick order
    pathfinding/    A* strategic routing over the geographic region graph
    country/        CountryState factory, modifiers, types
    economy/        income, resources, stability
    research/       tech progress and effects
    military/       armies, strategic movement, battles, production, upkeep
    tactical/       battlefield engine: units, formations, targeting, weapons,
                    projectiles, spatial grid, tactical AI, strategic bridge
    diplomacy/      relations, alliances, trade (weekly tick)
    war/            war entities, goals, fronts, control, peace, air/naval/missiles
    ai/             AI director, utility evaluators, strategic war planner
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

## Geographic world (Milestone 5)

**Data model.** `src/geo/types.ts` defines the single geographic contract: countries, regions, cities, airports and ports, all in WGS84 `[lon, lat]`. A `GeographicDataProvider` supplies country boundaries, region boundaries, adjacency, cities, airports, ports, transport and validation. `NATURAL_EARTH_PROVIDER` (exported as `GEOGRAPHY`) is the bundled implementation; gameplay imports ids and metadata from it and never opens raw geometry.

**Real country boundaries.** Country outlines are the Natural Earth 1:110m admin-0 dataset (public domain) already in `src/data/countries.json`: 174 countries, 278 polygons with holes, islands and coastal outlines. Country adjacency is derived from shared border vertices, with a bounded sea-proximity fallback for island states. `scripts/build-country-data.mjs` regenerates the file from a newer GeoJSON extract.

**Provinces without invented borders.** The dataset has no admin-1 provinces, so Milestone 5 does not pretend to have real ones. Instead, each country's *real* territory is triangulated once and every triangle is assigned to the nearest strategic province anchor, producing a contiguous partition that respects coastlines, islands and holes. From it the provider derives the province centroid, spherical area, bounding box, exact intra-country adjacency from shared triangle edges and cross-border links. Small outlines that triangulate into fewer cells than they have provinces share a cell with their best-covered neighbour, so no region is ever an orphan. The result is `geometryRef: province:<id>@v1`, a stable reference rather than geometry in saves.

**Importing real GIS data.** `src/geo/import.ts` normalises an admin-1 GeoJSON FeatureCollection: rings are closed and validated, coordinates checked, ids de-duplicated, centroid/area/bounds computed and adjacency derived from shared edges. Expected properties are `id|code|ISO_1`, `country|iso_a3|ADM0_A3`, `name|NAME` and optional `name_fa|NAME_FA`. Place a generated `src/data/regions.geo.json`, run its features through `normalizeRegionGeoJson`, and export a provider built from those regions in place of `NATURAL_EARTH_PROVIDER`; simulation, saves, AI and UI keep reading region ids. The pipeline and its expected input are also documented in `IMPORT_INSTRUCTIONS`. Real admin-1 data was not bundled because no openly licensed, project-sized dataset was added within this milestone; the seam is complete and tested with synthetic imported polygons.

**Rendering.** The merged country surface carries a per-vertex `regionIndex` attribute built from the provider cells. A second batched mesh (`RegionLayer`) draws all province fills in one draw call, with one border line mesh for internal province boundaries and the existing coastline walls for the coast. Switching map layer only rewrites the colour attribute and only when the derived values changed; geometry is never rebuilt per frame. Cities use three LOD point clouds (capital/major/minor) plus separate airport and port clouds. Army markers remain instanced.

**Map layers.** Political, terrain, population, economy, resources, infrastructure, supply, military, diplomacy and objectives. Values are normalised into the snapshot (0..1) from the same simulation state the panels use, cached in the snapshot, and rendered through one vertex-colour buffer. Resource regions show their dominant resource colour; supply shows the regional network level; objectives highlight their target regions.

**Picking and camera.** One raycast against the merged surface resolves both `countryIndex` and `regionIndex`; there is no polygon scan and no per-country object. At country altitude or closer a click selects the province and opens its inspector; at global altitude it selects the country, preserving the original behaviour. The single camera rig gained a `frameRegion` step, so the ladder is global → country → region → army → battlefield without a controller swap.

**Cities and infrastructure.** Cities carry population, strategic/industrial value, category, airport/port flags and a region link. Airports and ports are region-owned infrastructure points with level, capacity and military/naval classification; they feed the transport graph and the supply network and are available to future air/naval systems. The transport graph adds road/rail edges from province adjacency, sea lanes between nearby ports and air links between airport hubs.

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

## Strategic routing and supply (Milestone 5)

**Army pathfinding.** `gameplay/pathfinding/Pathfinder.ts` runs A* over the region adjacency graph. Cost includes great-circle distance, terrain march cost, infrastructure, enemy soil, occupation, damage and a bounded heuristic; only provinces the mover may legally enter are expanded (own, allied, military access, occupied by the mover, or at war with the owner). Neutral closed territory blocks the search. Paths are cached per mover/origin/destination/day and are only computed when an order is issued — never per frame. The region route is projected onto a country hop sequence; `ArmySystem.orderStrategicMove` executes it hop by hop, and every hop resolves through the normal arrival rules (battle, occupation, liberation), so multi-hop movement cannot bypass combat or borders. Direct single-hop orders still work and cancel a standing route.

**Supply network.** `SupplySystem`/`supplyNetwork.ts` computes a bounded multi-source flow from hubs (capital, depots, ports, developed provinces) over the geographic region graph, with decay from distance, terrain, infrastructure, unrest, damage, occupation and sea lanes. Each country gets one field per day; the level is stored per region and drives both the supply layer and army supply. Occupied and unsupported soil is more expensive and weaker, but the approximation never simulates individual convoys.

**Resources on the map.** Resource production is already regional; the resource layer surfaces the dominant resource and richness of every province, and resource objectives remain part of the AI and objective systems.

## Advanced warfare (Milestone 6)

**War model.** A war is a first-class world entity in `world.wars`, not a flag on a bilateral relation. It records the aggressor, primary defender, every participant with its side (attacker/defender), join/leave days and casualties, data-driven goals, fronts, battle counts, occupied regions, economic damage, score, exhaustion and status. `WarSystem` creates one on a successful declaration, folds a later declaration between the same coalitions into the existing war, lets allies join by a deterministic trust/threat/proximity/exhaustion rule, and keeps every bilateral `Relation.atWar` in sync through `DiplomacySystem.joinWar`/`endWarPair`. Separate wars remain separate; a country may fight several opponents at once without contradictory sides in one war.

**War goals.** Goals are typed records (`conquest`, `liberation`, `captureCapital`, `captureRegion`, `secureResource`, `defendTerritory`, `punitive`) with owner, target country/region, priority, score contribution, progress, status and creation/completion day. `WarSystem.updateGoals` evaluates them from actual region control; completed goals add to the attacker/defender score and failed goals are exposed to AI and peace evaluation. Attacker declarations create capital, conquest and resource goals plus the defender's territorial-defence goal; no goal exists only as a label.

**War score and exhaustion.** `updateScore` is deterministic and normalised to −100…100 (attacker perspective): controlled territory weighted by strategic value and infrastructure, held capitals, battle wins, completed goals, blockade effectiveness and economic damage. Exhaustion is the mean of the participating countries' existing war-exhaustion state, which already follows time at war, casualties, occupation, blockades and stability. High exhaustion feeds AI peace willingness and never ends a war by itself.

**Frontlines.** `rebuildFrontlines` builds connected chains of adjacent hostile regions from the actual region graph, including sovereign borders before any occupation, on daily ticks or after a dirty event (war start, join, capture, peace). A front records both lead countries, its region chain, priority from strategic value, attacker/defender strength and supply from armies standing on the chain, pressure, active battles, objective and status. Rebuilds are bounded to 12 fronts per war and never run from the render loop; `frontline` is also a batched map layer.

**Region-level control.** Sovereignty and control are separate fields on every `RegionState`: `countryId` is the owner, while `controllerId`/`occupierId` identify the power exercising military control. `controlStatus` is one of controlled, contested, occupied, liberated or recently captured, alongside occupation progress, resistance, supply modifier, frontline link, air defence and air/naval support. `captureRegion` never changes `countryId`. Daily consolidation grows or decays occupation from friendly/enemy army presence, supply and resistance, and cities and territory transfer only through a validated peace term. Capital capture still triggers whole-country occupation as the Milestone 1–5 compatibility path; non-capital captures remain regional.

**Armies, groups and operations.** Every army now carries a name, abstract commander, posture (`attack`, `defend`, `hold`, `advance`, `support`, `reserve`, `withdraw`, `recon`), morale, readiness, objective, frontline, group and isolation state; `armyPower` includes all of them. Army groups bind several armies to one objective, front, priority and command posture. Operations (`majorOffensive`, `defensiveLine`, `encirclement`, `capitalDefense`, `resourceSeizure`, `breakthrough`, `reinforcement`, `withdrawal`) hold member armies, targets, war and start day, and issue bounded movement orders through the same `ArmySystem` as the player. Groups, operations and postures are available to AI and player through identical `Simulation` APIs.

**Supply warfare and encirclement.** The Milestone 5 supply field now resolves control at runtime, so transferred regions, occupied soil and blockaded sea lanes change the graph without rewriting static geography. An army is isolated when its supply route is cut or it stands in enemy-controlled territory without a friendly corridor; isolation reduces supply, readiness, combat power, morale and movement, grows `encircledDays`, and pressures the AI to withdraw. Supply recovers when a corridor is restored.

**Air, air defence, naval, blockade and missiles.** Air missions (`airSuperiority`, `interception`, `groundSupport`, `recon`, `strategicBombing`, `transport`) launch from owned airports, consume oil/electronics and readiness, and apply region-level air support, damage, supply interdiction, detection or transport effects. Air-defence units and airports produce regional coverage and interception strength that reduce enemy air effects and feed tactical battle modifiers. Naval power forms grouped task forces (fleet, carrier group, escort, submarine abstraction, transport fleet) at owned ports; blockades require a coastal target and naval power, and their effectiveness depends on relative fleets, air superiority and enemy naval presence, feeding trade, supply, production and exhaustion. Strategic missiles (`tactical`, `cruise`, `ballistic`) validate target hostility, range from the capital, stockpile, cooldown and oil/electronics cost, then damage infrastructure, supply, air defence and readiness without graphic destruction.

**Peace and territorial change.** `PeaceTerm` supports white peace, status quo, liberation, return of occupied territory, cession/annexation, reparations and demilitarised regions. `validatePeaceOffer` rejects unknown regions, non-participants, capitals, unowned/uncontrolled territory and impossible transfers; a claimant may annex a region it controls while the defeated sovereign still owns it. Accepted treaties apply terms, transfer sovereignty by moving region state between country arrays (never mutating the static geographic definition), update population, economy, supply and map rendering, release remaining occupation, dissolve the war's fronts and clear every bilateral war relation. AI recipients evaluate offers deterministically from score, exhaustion, relative strength and war goals; exhausted losing AI sides may also sue for white peace.

**AI planner and personalities.** The scheduled AI now evaluates fronts instead of only the weakest neighbour: friendly/enemy strength, supply, strategic value, war-goal relevance and reinforcement availability decide attack, defend, hold, reinforce, withdraw or reserve. It keeps at most four persistent strategic plans (capital defence, defensive line, prepare offensive, resource seizure, economic growth, air superiority, naval control, supply recovery), forms army groups and operations when it has a local advantage, masses forces on priority fronts, avoids attacks below a personality-scaled power threshold and withdraws isolated armies. Aggressive, defensive, expansionist, economic, diplomatic, technological, naval, air and balanced personalities change the aggression threshold, research branches, preferred domains and plan priorities.

**Player war room and map.** The new `War Room` panel exposes active wars, score, exhaustion, participants, goals, fronts, army groups, operations, air/naval/missile status, peace offers and every army's posture, with actions to offer white peace, accept/reject AI offers, form groups, create operations, launch air missions, order blockades and fire missiles. It is fully localized in English and Persian and uses the existing logical-property/RTL layout. The `frontline` map layer colours front regions by pressure, while the political layer distinguishes occupied, contested and recently captured regions.

**Save schema v6.** Saves now persist world wars/fronts/blockades/peace offers, region controllers and occupation progress, army postures/groups/operations, air missions, naval task forces, missile stockpiles/cooldowns and strategic plans. Migrations add neutral defaults to old records without dropping territory, armies or diplomacy.

## Localization

Typed catalogs (`src/i18n/locales/en.ts`, `fa.ts`) keyed by `MessageKey`, so a missing key is a compile error. Content (country, city, unit, tech, government, personality names/descriptions) is `LocalizedText { en, fa }` in the data files. `useI18n()` exposes `t`, and locale-aware `n`, `compact`, `signed`, `percent`, `decimal`, `timestamp` — every number and date goes through it so Persian digits, separators and the `٪` sign are consistent. Direction is applied at the document root, layouts use logical CSS properties, and Vazirmatn is bundled for Persian typography. Adding a language is a catalog plus a `LOCALES` entry.

## Save architecture

`SaveFile` is versioned (`CURRENT_SAVE_VERSION = 6`, migration chain in `save/migrations.ts`). A save contains campaign metadata, the full world (every country's state, provinces with owner/controller/occupation/supply state, economy allocation and resource flow, production queues, objectives, armies with anchors, routes, postures and supply, army groups and operations, air/naval/missile/plan state, wars, fronts, blockades, peace offers, occupation, AI memory, queues, relations incl. trust/threat/pacts), clock, notifications, seed, the **geography reference** (provider id and region source, never geometry) and any active **battlefields** — including tactical unit positions, altitude, heading, health, formation, targets, cooldowns, casualties and team assignment. Raw country/province polygons, cities and map meshes are static data and are never written to saves.

Migrations keep old campaigns loading:

- **v1 → v2** gives every country a field army built from its old aggregate formations and an explicit `occupierId`.
- **v2 → v3** gives every army a default formation and adds the battlefield list.
- **v3 → v4** regenerates deterministic provinces for every country, adds aluminium, budget allocation, resource flow, production/objectives, war exhaustion/unrest, army supply fields and the expanded agreement set with neutral defaults — no saved army, relation or territory is dropped.
- **v4 → v5** adds the geographic layer: regional supply levels, army anchor regions and an empty multi-hop route, occupation-aware region control and the geography provider reference. Geometry is re-read from the data layer; every saved army, region and relation survives.
- **v5 → v6** adds the war registry, fronts, blockades and peace offers; region controller/occupier/control-status/occupation-progress/resistance/supply-modifier/frontline fields; army names, commanders, postures, morale, readiness, isolation, group/frontline/objective links; and per-country groups, operations, air, naval, missile and strategic-plan state. Old armies default to defending, old occupation becomes an occupied controller, and empty war containers are created.

The full chain **v1 → v2 → v3 → v4 → v5 → v6** is exercised by the headless suites.

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
- `scripts/strategic-smoke.ts` — regional economy/resources, construction queue and completion, research progress and effects, diplomatic pacts/war/peace/embargo guards, stability and war exhaustion, supply and attrition, AI focus/objectives, v6 round-trip, v3 → v6 migration, the full v1 → v6 chain and a 180-day multi-country campaign regression.
- `scripts/geography-smoke.ts` — provider validation, country/region geometry, centroid/area/bounds, adjacency symmetry, GIS import and duplicate detection, domestic/blocked/war/long-distance pathfinding with terrain/infrastructure/occupation costs, regional supply flow, resource ownership, map selection and occupation tones, v6 round-trip, v4 → v6 and v1 → v6 chains, and a 240-day deterministic campaign checking ownership, controllers, routes, supply, diplomacy, wars, fronts and memory growth.
- `scripts/warfare-smoke.ts` — multi-country wars, goals/score/exhaustion, front creation and dissolution, owner-vs-controller occupation, supply isolation, army groups/postures/operations, air superiority and air defence, naval task forces and blockades, missile validation/cost/cooldown, valid and invalid peace treaties, cession and sovereignty transfer, personality differences, v6 round-trip, v5 → v6 migration and a 365-day deterministic campaign checking controllers, fronts, participants, armies and memory.

GitHub Actions runs the same typecheck, production build and test suites on every push and pull request (`.github/workflows/ci.yml`).

## Milestone roadmap

1. **Done** — foundation, 3D Earth, camera ladder, nation selection and dossiers, campaign shell, economy/research/military/diplomacy/AI simulation, save/load, EN + FA.
2. **Done** — field armies on the globe, strategic movement between neighbours, 3D army markers, deterministic battles, territorial occupation and liberation, AI army command, player war/peace actions, save schema v2, CI.
3. **Done** — tactical military foundation: data-driven units and weapons, 3D units on the globe, ground/air movement, formations, detection, targeting, real-time combat, placeholder projectiles, battlefield mode, tactical selection and command UI, save v3.
4. **Done** — strategic depth: provinces and terrain, regional economy and resources, budget allocation, infrastructure production, expanded research, trust/threat diplomacy with pacts and embargoes, scheduled strategic AI with objectives, supply/logistics, unrest and war exhaustion, strategic UI and save v4 (v3 → v4 migration).
5. **Done** — geographic strategic map: provider-based geographic data layer over real country boundaries, province territory geometry with centroids/areas/bounds/adjacency, batched province fills and borders, ten map layers, region picking and inspector, region camera level, city/airport/port LOD, transport graph, A* army routing, regional supply network, geography save v5 (v4 → v5 migration).
6. **Done** — advanced warfare: multi-country war entities, war goals/score/exhaustion, frontlines, owner-vs-controller regional occupation, army postures/groups/operations, encirclement and supply warfare, strategic air/air-defence/naval/blockade/missile layers, peace terms with liberation and annexation, front-aware strategic AI and personalities, war-room UI, frontline map layer and save v6 (v5 → v6 migration).
7. Final unit models from reference images, PBR materials, VFX and audio for the tactical layer; unit LOD and battlefield streaming.
8. Deeper battlefield AI, naval invasion/airlift execution, convoy routing and a larger map dataset.
9. Content expansion to hundreds of units and a deeper world simulation, plus a bundled licensed admin-1 dataset.

## Known limitations (Milestone 6)

- Provinces are a deterministic partition of real national territory, not real administrative polygons. No openly licensed admin-1 dataset was bundled; the province shapes are intentionally a fallback and `geometryRef` + the tested GeoJSON import pipeline are the replacement seam. Tiny nations with fewer triangulated cells than provinces share a cell between neighbouring provinces.
- Whole-country occupation remains the compatibility fallback when a capital falls; ordinary non-capital capture is regional. There is no province-by-province urban combat or civilian simulation, and resistance is a single strategic value per region.
- Resource flow is tracked per country, not per trade route: blockades apply a national trade/supply penalty, but there is no convoy routing, port throughput queue or market price model yet.
- Supply is a bounded regional flow (hubs, roads, sea lanes, control, infrastructure), not a convoy simulation: there are no depot stockpiles or per-route capacity limits, and the field is recomputed once per country per day. Isolation is strategic (route cut / no friendly corridor), not a per-soldier pocket.
- The strategic AI keeps at most four plans and coordinates groups/operations only at front scale. It does not run a multi-month force-generation plan, compare alliance-wide economies, or stage amphibious invasions; air/naval effects remain regional modifiers rather than separate battles.
- Terrain modifies strategic movement, supply, defence and industry; tactical battles use the country's weighted terrain defence but not per-tile cover, height or line-of-sight.
- Browser validation was available but deliberately bounded: the app loaded from the Vite dev server, a fresh Iran campaign started, the War Room opened and rendered an active war with participants, score, goals and exhaustion, and the frontlines map-layer control responded without runtime errors. The selected belligerent had no shared land border, so a populated front card and coloured frontline cells were not visually exercised; their data and rendering paths are covered by the headless suites.
- Multi-hop strategic routing exists but is exposed to the player as a “march to objective” order rather than free province-to-province route drawing. Naval and air transport edges exist in the graph but armies still route over land; there is no naval invasion or airlift execution yet.
- Tactical battles **represent** an engagement the strategic layer already resolved. The winner and the formation losses are authoritative; tactical combat reconciles to that quota rather than feeding a new result back. A battle also runs in real time while campaign days advance.
- Only engagements involving the player spawn a 3D battlefield. AI-vs-AI wars remain abstract, though the AI commands its side in any battlefield it fights.
- Battlefields are anchored at a country's label on the globe and units stand on the sphere surface; there is no terrain height sampling, cover or terrain modifier yet, and no obstacle pathfinding or collision avoidance (formations are direct slots, so units can overlap).
- Visuals are placeholders: one procedural silhouette per archetype, no skeletal/prop animation, tracer trails, impact VFX or audio. Projectiles are instanced spheres.
- Targeting uses range, sensor radius and target layers. Stealth, electronic warfare, line-of-sight and terrain masking are represented in data but not yet applied. Weapon ammunition is in the schema but treated as unlimited for this era.
- Battlefields are capped at 12 tokens per side and 3 active player battles. The data structures are instancing/spatial-partition ready, but the caps keep the current build responsive.
- The country surface and the province overlay are each a single merged mesh. There is no tile streaming or per-province culling; at the current 384-region scale this is comfortably batched, but a multi-thousand-region dataset would need visible-tile streaming.
- The tactical HUD and 3D unit rendering were verified through the headless suites (typecheck, build, simulation tests), not by clicking through a browser in this milestone.
- The cloud preview VM renders with a software rasteriser (SwiftShader); the game detects that and selects the low preset, but frame rate there is far below what a hardware GPU delivers.
