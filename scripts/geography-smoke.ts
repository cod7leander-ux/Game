import {
  ALL_REGION_GEO,
  COUNTRY_ADJACENCY,
  GEOGRAPHY,
  GEOGRAPHY_REPORT,
  GEOGRAPHY_STATS,
  GEO_CITIES,
  GEO_AIRPORTS,
  GEO_PORTS,
  REGION_GEO_BY_ID,
  TRANSPORT,
  approxKm,
  normalizeRegionGeoJson,
  pointInPolygon,
} from '../src/geo';
import { COUNTRY_BY_ID } from '../src/data/countries';
import { REGIONS } from '../src/data/regions';
import { TERRAIN } from '../src/data/terrain';
import { World } from '../src/gameplay/World';
import { GameSession } from '../src/game/GameSession';
import { Simulation } from '../src/gameplay/Simulation';
import { EconomySystem, regionOutput } from '../src/gameplay/economy/EconomySystem';
import {
  Pathfinder,
  canTraverseRegion,
  strategicPathfinder,
  strategicStepCost,
  targetRegionForCountry,
} from '../src/gameplay/pathfinding/Pathfinder';
import { LogisticsSystem, computeSupply } from '../src/gameplay/logistics/LogisticsSystem';
import { computeSupplyField, supplyAtRegion } from '../src/gameplay/logistics/supplyNetwork';
import { relationIsConsistent } from '../src/gameplay/diplomacy/types';
import { CURRENT_SAVE_VERSION } from '../src/save/types';
import { migrateSave } from '../src/save/migrations';
import { armyUnits } from '../src/gameplay/military/armies';

/**
 * Milestone 5 suite: geographic data validation, region adjacency, map
 * selection/occupation state, pathfinding, supply flow, resources, save v5,
 * the whole migration chain and a long deterministic campaign.
 */
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};
const log = (message: string): void => console.log(`  ✓ ${message}`);

console.log('Terra Dominion — geography & strategic map smoke test');

// ── Geographic data layer ───────────────────────────────────────────────────
if (!GEOGRAPHY_REPORT.valid) {
  console.log(
    GEOGRAPHY_REPORT.issues
      .filter((issue) => issue.severity === 'error')
      .slice(0, 25)
      .map((issue) => `${issue.code} ${issue.ref ?? ''}: ${issue.message}`)
      .join('\n'),
  );
}
assert(GEOGRAPHY_REPORT.valid, `provider data is valid (${GEOGRAPHY_REPORT.errors} errors)`);
assert(GEOGRAPHY.countries().length > 150, 'provider supplies the world');
assert(GEOGRAPHY.regions().length > 300, 'provider supplies hundreds of regions');
assert(GEO_CITIES.length >= 75, 'city catalogue is present');
assert(GEO_AIRPORTS.length > 0 && GEO_PORTS.length > 0, 'airports and ports exist');
assert(TRANSPORT.edges.length > GEOGRAPHY.regions().length, 'transport graph is connected');
assert(
  GEOGRAPHY.countries().every((country) => country.polygons.length > 0 && country.areaKm2 > 0),
  'every country has real geometry and area',
);
assert(
  ALL_REGION_GEO.every(
    (region) =>
      Number.isFinite(region.centroid[0]) &&
      Number.isFinite(region.centroid[1]) &&
      region.areaKm2 > 0 &&
      region.bounds.minLon <= region.bounds.maxLon &&
      region.bounds.minLat <= region.bounds.maxLat,
  ),
  'every region has a centroid, area and bounding box',
);
assert(
  ALL_REGION_GEO.every((region) =>
    region.neighbours.every((neighbourId) => Boolean(REGION_GEO_BY_ID[neighbourId])),
  ),
  'region adjacency references existing regions',
);
assert(
  ALL_REGION_GEO.every((region) =>
    region.neighbours.every((neighbourId) =>
      REGION_GEO_BY_ID[neighbourId].neighbours.includes(region.id),
    ),
  ),
  'region adjacency is symmetric',
);
assert(
  GEOGRAPHY.countries().every((country) =>
    country.neighbours.every((id) => GEOGRAPHY.countryNeighbours(id).includes(country.id)),
  ),
  'country adjacency is symmetric',
);
assert(
  GEOGRAPHY.regionsOf('IRN').length >= 2 &&
    GEOGRAPHY.countries().find((country) => country.id === 'IRN')?.regions.length ===
      GEOGRAPHY.regionsOf('IRN').length,
  'country records reference their regions',
);
log(
  `geography: ${GEOGRAPHY_STATS.countries} countries, ${GEOGRAPHY_STATS.regions} regions, ${GEOGRAPHY_STATS.cities} cities, ${GEOGRAPHY_STATS.airports} airports, ${GEOGRAPHY_STATS.ports} ports`,
);
log(
  `geometry: ${GEOGRAPHY_STATS.cells} province cells, ${GEOGRAPHY_STATS.provinceBorders} internal borders, ${GEOGRAPHY_STATS.transportEdges} transport edges`,
);

// Region polygons are real territory cells; a triangle centroid must be inside.
const sampleRegion = GEOGRAPHY.region('IRN-R1');
assert(sampleRegion && sampleRegion.polygons.length > 0, 'IRN capital region has territory');
const triangle = sampleRegion!.polygons[0];
const centroidOfTriangle: [number, number] = [
  (triangle.outer[0][0] + triangle.outer[1][0] + triangle.outer[2][0]) / 3,
  (triangle.outer[0][1] + triangle.outer[1][1] + triangle.outer[2][1]) / 3,
];
assert(pointInPolygon(centroidOfTriangle, triangle), 'region polygon contains its own cell');
log('region geometry: cells are real, closed and point-testable');

// ── GIS import pipeline ─────────────────────────────────────────────────────
const imported = normalizeRegionGeoJson({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'TST-R1', country: 'IRN', name: 'Test One', name_fa: 'تست یک' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [44, 32],
            [45, 32],
            [45, 33],
            [44, 33],
            [44, 32],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { id: 'TST-R2', country: 'IRN', name: 'Test Two' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [45, 32],
            [46, 32],
            [46, 33],
            [45, 33],
            [45, 32],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { id: 'TST-R2', country: 'IRN', name: 'Duplicate' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    },
  ],
});
assert(imported.regions.length === 2, 'import normalisation keeps valid features');
assert(imported.issues.some((issue) => issue.code === 'duplicate-id'), 'import detects duplicate ids');
assert(
  imported.regions[0].neighbours.includes('TST-R2') &&
    imported.regions[1].neighbours.includes('TST-R1'),
  'import derives symmetric adjacency from shared borders',
);
assert(imported.regions.every((region) => region.areaKm2 > 0), 'import computes region area');
log('import pipeline: normalises GeoJSON, derives adjacency, rejects duplicates');

// ── World and map state ─────────────────────────────────────────────────────
const world = new World({ seed: 4242, playerCountryId: 'IRN', day: 1 });
const player = world.player!;
assert(player.regions.length >= 2, 'player owns regions');
assert(
  player.regions.every((region) => Boolean(GEOGRAPHY.region(region.id))),
  'runtime regions reference geographic records',
);
assert(
  player.regions.every((region) => typeof region.supplyLevel === 'number' && region.supplyLevel >= 0),
  'regions carry supply state',
);

const pathfinder = new Pathfinder();
const ownOrigin = player.regions[0].id;
const ownTarget = player.regions[player.regions.length - 1].id;
const ownPath = pathfinder.find(world, {
  countryId: player.id,
  fromRegionId: ownOrigin,
  toRegionId: ownTarget,
});
assert(ownPath.found && ownPath.nodes[0] === ownOrigin && ownPath.nodes.at(-1) === ownTarget, 'valid domestic path');
assert(ownPath.countries.every((id) => id === player.id), 'domestic path stays in country');
if (ownOrigin !== ownTarget) {
  assert(ownPath.nodes.length >= 2, 'domestic path crosses region graph');
}

const neutralTarget = targetRegionForCountry('FRA');
assert(neutralTarget, 'target country has a capital region');
const blockedPath = pathfinder.find(world, {
  countryId: player.id,
  fromRegionId: ownOrigin,
  toRegionId: neutralTarget!,
});
assert(!blockedPath.found, 'neutral closed territory blocks a path');
assert(blockedPath.reason === 'blocked' || blockedPath.reason === 'unreachable', 'blocked path reports why');

const neighbourId = world.neighboursOf(player.id)[0];
const warTarget = targetRegionForCountry(neighbourId);
assert(warTarget, 'neighbour has a capital region');
assert(world.get(neighbourId), 'neighbour exists in world');
// Declare war so the target becomes legally enterable.
player.diplomacy.relations[neighbourId] = {
  ...(player.diplomacy.relations[neighbourId] ?? {}),
  atWar: true,
} as never;
assert(canTraverseRegion(world, player, warTarget!), 'war opens enemy territory to the pathfinder');
const warPath = pathfinder.find(world, {
  countryId: player.id,
  fromRegionId: ownOrigin,
  toRegionId: warTarget!,
});
assert(warPath.found, 'path to an enemy capital is found during war');
assert(warPath.countries.includes(neighbourId), 'enemy path crosses the target country');

// Terrain and infrastructure modify step cost.
const region = REGION_GEO_BY_ID[ownOrigin];
const adjacentId = region.neighbours.find((id) => REGION_GEO_BY_ID[id].countryId === player.id);
assert(adjacentId, 'capital region has a domestic neighbour');
const baseCost = strategicStepCost(world, player, ownOrigin, adjacentId!);
const destination = player.regions.find((entry) => entry.id === adjacentId);
const definition = REGIONS.find((entry) => entry.id === adjacentId);
assert(destination && definition, 'destination region resolves');
const originalInfrastructure = destination!.infrastructure;
destination!.infrastructure = 0.05;
const poorCost = strategicStepCost(world, player, ownOrigin, adjacentId!);
destination!.infrastructure = 0.98;
const richCost = strategicStepCost(world, player, ownOrigin, adjacentId!);
destination!.infrastructure = originalInfrastructure;
assert(poorCost > richCost, 'poor infrastructure raises path cost');
assert(Number.isFinite(baseCost) && baseCost > 0, 'path step cost is finite');
assert(TERRAIN[definition!.terrain].march > 0, 'terrain data drives movement');

destination!.control = 'occupied';
const occupiedCost = strategicStepCost(world, player, ownOrigin, adjacentId!);
destination!.control = 'sovereign';
assert(occupiedCost >= richCost, 'occupied territory costs more to traverse');

// Long-distance path in a large country stays connected.
const russiaRegions = GEOGRAPHY.regionsOf('RUS');
const russia = world.get('RUS')!;
const longPath = pathfinder.find(world, {
  countryId: 'RUS',
  fromRegionId: russiaRegions[0].id,
  toRegionId: russiaRegions[russiaRegions.length - 1].id,
});
assert(longPath.found && longPath.nodes.length >= 2, 'long-distance domestic path resolves');
assert(longPath.distanceKm > 0, 'long path records distance');
void russia;
log(
  `pathfinding: domestic ${ownPath.nodes.length} nodes, long route ${longPath.nodes.length} nodes / ${Math.round(longPath.distanceKm)} km`,
);
// End-to-end army order over the graph: access through one country and war
// with the next must produce a multi-hop route executed by the army system.
const routeWorld = new World({ seed: 77, playerCountryId: 'IRN', day: 1 });
const routePlayer = routeWorld.player!;
const routeArmy = routePlayer.military.armies[0];
let hopWorld: { via: string; target: string } | null = null;
for (const via of COUNTRY_ADJACENCY.get('IRN') ?? []) {
  if (!routeWorld.get(via)) continue;
  for (const target of COUNTRY_ADJACENCY.get(via) ?? []) {
    if (target === 'IRN' || (COUNTRY_ADJACENCY.get('IRN') ?? []).includes(target)) continue;
    if (!routeWorld.get(target)) continue;
    hopWorld = { via, target };
    break;
  }
  if (hopWorld) break;
}
assert(hopWorld, 'a two-hop land corridor exists for the routing test');
const viaRelation = routePlayer.diplomacy.relations[hopWorld!.via];
if (viaRelation) viaRelation.militaryAccess = true;
else routePlayer.diplomacy.relations[hopWorld!.via] = { militaryAccess: true } as never;
routePlayer.diplomacy.militaryAccessPartners.push(hopWorld!.via);
const targetRelation = routePlayer.diplomacy.relations[hopWorld!.target];
if (targetRelation) targetRelation.atWar = true;
else routePlayer.diplomacy.relations[hopWorld!.target] = { atWar: true } as never;
routePlayer.diplomacy.wars.push(hopWorld!.target);
const routeTarget = targetRegionForCountry(hopWorld!.target)!;
// Use the route world's own systems through a fresh simulation.
const routeSimulation = new Simulation(routeWorld);
const move = routeSimulation.marchArmyTo('IRN', routeArmy.id, routeTarget);
assert(move.ok, 'multi-hop army order is accepted');
assert(routeArmy.movement, 'army begins the first hop of its route');
assert(move.ok && move.path.countries.length >= 2, 'route crosses at least two countries');
assert(
  routeArmy.route.every((id) => Boolean(routeWorld.get(id))),
  'remaining route references real countries',
);
log(
  `army routing: ${hopWorld!.via} → ${hopWorld!.target}, ${move.ok ? move.route.length + 1 : 0} hops planned`,
);
log('pathfinding: neutral blocked, war opens enemy soil, terrain/infrastructure/occupation affect cost');

// ── Supply network ──────────────────────────────────────────────────────────
const field = computeSupplyField(world, player);
const capitalRegionId = player.regions[0].id;
assert(supplyAtRegion(field, capitalRegionId) > 0.5, 'capital is supplied');
assert(supplyAtRegion(field, neutralTarget!) === 0, 'supply does not cross a closed neutral border');
assert(field.levels.size >= player.regions.length, 'supply reaches every home region');
assert(
  [...field.levels.keys()].every((regionId) => {
    const owner = world.get(REGION_GEO_BY_ID[regionId].countryId);
    if (!owner) return false;
    return (
      owner.id === player.id ||
      player.diplomacy.allies.includes(owner.id) ||
      player.diplomacy.relations[owner.id]?.militaryAccess === true ||
      owner.occupierId === player.id
    );
  }),
  'supply only flows through friendly, allied or accessed territory',
);
const army = player.military.armies[0];
army.regionId = capitalRegionId;
const connectedSupply = computeSupply(world, player, army, field);
assert(connectedSupply.supply > 0.5, 'army on connected soil is supplied');

army.regionId = adjacentId!;
const targetRegionState = player.regions.find((entry) => entry.id === adjacentId)!;
targetRegionState.control = 'occupied';
const occupiedSupply = computeSupply(world, player, army, field);
targetRegionState.control = 'sovereign';
const normalSupply = computeSupply(world, player, army, field);
assert(occupiedSupply.supply <= normalSupply.supply, 'occupied regions reduce supply');

const lowInfrastructureWorld = new World({ seed: 4242, playerCountryId: 'IRN', day: 1 });
for (const entry of lowInfrastructureWorld.player!.regions) entry.infrastructure = 0.08;
const poorField = computeSupplyField(lowInfrastructureWorld, lowInfrastructureWorld.player!);
const average = (levels: Map<string, number>): number =>
  [...levels.values()].reduce((sum, value) => sum + value, 0) / Math.max(1, levels.size);
assert(average(field.levels) > average(poorField.levels), 'infrastructure raises regional supply');

const logistics = new LogisticsSystem();
const economy = new EconomySystem();
for (let day = 2; day <= 12; day += 1) {
  economy.tick(player);
  logistics.tick(world);
}
assert(
  player.regions.every(
    (entry) => entry.supplyLevel >= 0 && entry.supplyLevel <= 1 && Number.isFinite(entry.supplyLevel),
  ),
  'daily logistics stores a valid regional supply field',
);
log(`supply: ${field.levels.size} reachable regions, ${field.hubs.length} hubs, occupied penalty verified`);

// ── Resources tied to regions ───────────────────────────────────────────────
const resourceOutputs = player.regions.map((entry) => regionOutput(player, entry));
assert(
  resourceOutputs.some((output) => Object.values(output).some((value) => (value ?? 0) > 0)),
  'regions produce resources',
);
assert(
  player.regions.every((entry) => {
    const regionDefinition = REGION_GEO_BY_ID[entry.id];
    return Boolean(regionDefinition) && regionDefinition.countryId === player.id;
  }),
  'resource ownership matches geographic ownership',
);
const richest = player.regions
  .map((entry) => ({
    entry,
    definition: REGIONS.find((definitionEntry) => definitionEntry.id === entry.id)!,
  }))
  .sort(
    (a, b) =>
      Math.max(...Object.values(b.definition.richness).map((value) => value ?? 0)) -
      Math.max(...Object.values(a.definition.richness).map((value) => value ?? 0)),
  )[0];
assert(richest.definition.strategicValue > 0, 'resource regions carry strategic value');
assert(
  Object.keys(richest.definition.richness).length > 0,
  'resource regions carry a resource mix',
);
log(`resources: ${richest.definition.name.en} is the richest home region`);

// ── Map selection, ownership and occupation visual state ────────────────────
const session = GameSession.create({ countryId: 'IRN', locale: 'en', difficulty: 'standard' });
const snapshot = session.snapshot()!;
assert(snapshot.mapRegions.length === GEOGRAPHY.regions().length, 'map exposes every region');
assert(
  snapshot.mapRegions.every((entry) => COUNTRY_BY_ID[entry.countryId]),
  'map regions reference real countries',
);
assert(
  snapshot.mapRegions.some((entry) => entry.tone === 'player') &&
    snapshot.mapRegions.some((entry) => entry.tone === 'neutral'),
  'political tones classify player and neutral territory',
);
const foreignRegion = snapshot.mapRegions.find((entry) => entry.countryId !== 'IRN')!;
session.selectedRegionId = foreignRegion.id;
const inspected = session.snapshot()!.inspectedRegion;
assert(inspected && inspected.id === foreignRegion.id, 'foreign region can be inspected');
assert(inspected!.ownerName.length > 0, 'inspected region shows its owner');
assert(snapshot.mapRegions.every((entry) => entry.terrainColor.startsWith('#')), 'terrain layer has colours');

const occupiedCountry = snapshot.mapRegions.find((entry) => entry.countryId !== 'IRN')!.countryId;
session.world.get(occupiedCountry)!.occupierId = 'IRN';
const occupiedSnapshot = session.snapshot()!;
assert(
  occupiedSnapshot.mapRegions
    .filter((entry) => entry.countryId === occupiedCountry)
    .every((entry) => entry.tone === 'player'),
  'occupation state changes the political colour',
);
session.world.get(occupiedCountry)!.occupierId = null;
log('map: region inspection, ownership and occupation visual state verified');

// ── Save v5 and migrations ──────────────────────────────────────────────────
assert(CURRENT_SAVE_VERSION === 5, 'save schema is version 5');
const payload = {
  ...session.toSavePayload(),
  slot: '1' as const,
  version: 5,
  updatedAt: Date.now(),
};
assert(payload.world.geography?.provider === GEOGRAPHY.id, 'saves store a geography reference, not geometry');
assert(
  payload.world.countries.every((country) =>
    country.military.armies.every(
      (entry) => typeof entry.regionId === 'string' && Array.isArray(entry.route) && 'routeTargetId' in entry,
    ),
  ),
  'saves carry army anchor and route state',
);
const roundTrip = migrateSave(JSON.parse(JSON.stringify(payload)));
assert(roundTrip.version === 5, 'v5 save round-trips');
assert(
  roundTrip.world.countries.every((country) =>
    country.regions.every((entry) => typeof entry.supplyLevel === 'number'),
  ),
  'v5 round-trip keeps regional supply',
);

const legacy = JSON.parse(JSON.stringify(payload));
legacy.version = 4;
delete legacy.world.geography;
for (const country of legacy.world.countries as Array<Record<string, unknown>>) {
  for (const region of (country.regions as Array<Record<string, unknown>>) ?? []) delete region.supplyLevel;
  const military = country.military as { armies: Array<Record<string, unknown>> };
  for (const entry of military.armies) {
    delete entry.regionId;
    delete entry.route;
    delete entry.routeTargetId;
  }
}
const migrated = migrateSave(legacy);
assert(migrated.version === 5, 'v4 migrates to v5');
assert(migrated.world.countries.every((country) => country.regions.every((entry) => typeof entry.supplyLevel === 'number')), 'v4 → v5 adds regional supply');
assert(migrated.world.countries.every((country) => country.military.armies.every((entry) => entry.regionId && entry.route.length === 0)), 'v4 → v5 anchors armies and clears routes');
assert(migrated.world.geography?.regionSource, 'v4 → v5 records the geography provider');
log('v4 → v5 migration adds geographic state without losing armies');

const ancient = JSON.parse(JSON.stringify(payload));
ancient.version = 1;
delete ancient.world.geography;
for (const country of ancient.world.countries as Array<Record<string, unknown>>) {
  delete country.occupierId;
  delete country.regions;
  delete country.capitalRegionId;
  delete country.warExhaustion;
  delete country.unrest;
  delete country.objectives;
  delete country.production;
  const legacyMilitary = country.military as Record<string, unknown>;
  delete legacyMilitary.armies;
}
const chained = migrateSave(ancient);
assert(chained.version === 5, 'v1 migrates through v2, v3, v4 to v5');
assert(chained.world.countries.every((country) => country.military.armies.length > 0), 'v1 → v5 keeps armies');
assert(chained.world.countries.every((country) => country.regions.length > 0), 'v1 → v5 creates provinces');
assert(chained.world.geography?.provider, 'v1 → v5 records geography');
log('v1 → v2 → v3 → v4 → v5 chain preserved');

// ── Long deterministic campaign ─────────────────────────────────────────────
const campaign = GameSession.create({ countryId: 'KWT', locale: 'en', difficulty: 'standard' });
const campaignNeighbour = campaign.world.neighboursOf('KWT')[0];
campaign.declareWar(campaignNeighbour);
const worldSizeAtStart = JSON.stringify([...campaign.world.countries.values()]).length;
let supplyViolations = 0;
let invalidRegions = 0;
let invalidArmies = 0;
let impossibleRelations = 0;
let battles = 0;
campaign.simulation.events.on((event) => {
  if (event.type === 'battleResolved') battles += 1;
});

for (let day = 2; day <= 240; day += 1) {
  campaign.simulation.tickDay(day);
  for (const country of campaign.world.countries.values()) {
    if (country.occupierId) {
      const occupier = campaign.world.get(country.occupierId);
      if (!occupier || occupier.id === country.id) invalidRegions += 1;
    }
    for (const regionState of country.regions) {
      const geo = REGION_GEO_BY_ID[regionState.id];
      if (!geo || geo.countryId !== country.id) invalidRegions += 1;
      if (!Number.isFinite(regionState.supplyLevel) || regionState.supplyLevel < 0 || regionState.supplyLevel > 1) {
        supplyViolations += 1;
      }
    }
    for (const entry of country.military.armies) {
      if (!entry.regionId || !REGION_GEO_BY_ID[entry.regionId]) invalidArmies += 1;
      if (!Number.isFinite(entry.supply) || entry.supply < 0 || entry.supply > 1) supplyViolations += 1;
      if (entry.route.some((id) => !campaign.world.get(id))) invalidArmies += 1;
      if (entry.routeTargetId && !REGION_GEO_BY_ID[entry.routeTargetId]) invalidArmies += 1;
    }
    for (const [otherId, relation] of Object.entries(country.diplomacy.relations)) {
      if (!relationIsConsistent(relation)) {
        impossibleRelations += 1;
        if (impossibleRelations <= 3) {
          console.log('inconsistent relation', country.id, otherId, JSON.stringify(relation));
        }
      }
    }
  }
}

const countries = [...campaign.world.countries.values()];
assert(invalidRegions === 0, 'long campaign keeps ownership and region references valid');
assert(invalidArmies === 0, 'long campaign keeps armies anchored and routes valid');
assert(supplyViolations === 0, 'long campaign keeps supply finite and in range');
assert(impossibleRelations === 0, 'long campaign keeps diplomacy consistent');
assert(
  countries.every((country) => Number.isFinite(country.economy.resources.money)),
  'long campaign keeps treasuries finite',
);
assert(
  countries.every(
    (country) =>
      country.regions.length === GEOGRAPHY.regionsOf(country.id).length,
  ),
  'long campaign has no orphan or duplicated regions',
);
const worldSizeAtEnd = JSON.stringify(countries).length;
assert(
  worldSizeAtEnd < worldSizeAtStart * 4 + 400_000,
  'long campaign memory does not run away',
);
log(
  `240-day campaign: ${battles} battle(s), ${countries.length} countries, ${GEOGRAPHY.regions().length} regions, world bytes ${worldSizeAtStart} → ${worldSizeAtEnd}`,
);
log(
  `path cache: ${strategicPathfinder.cachedRoutes} routes, armies ${armiesOf(countries)} total`,
);


function armiesOf(states: typeof countries): number {
  return states.reduce(
    (total, country) => total + country.military.armies.reduce((sum, entry) => sum + armyUnits(entry), 0),
    0,
  );
}

session.dispose();
campaign.dispose();
console.log('Geography & strategic map smoke test passed.');
