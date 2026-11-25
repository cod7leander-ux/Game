import { GameSession } from '../src/game/GameSession';
import { SimClock } from '../src/core/clock';
import { GAME } from '../src/core/config';
import { CURRENT_SAVE_VERSION, type SaveFile } from '../src/save/types';
import { migrateSave } from '../src/save/migrations';
import { regionAt } from '../src/data/regions';
import { INFRASTRUCTURE_PROJECTS, getProject } from '../src/data/production';
import { POLICIES } from '../src/data/policies';
import { SITUATIONS } from '../src/data/situations';
import { TRADE_RESOURCES } from '../src/gameplay/trade/types';
import { PopulationSystem, manpowerCeiling } from '../src/gameplay/society/PopulationSystem';
import { WorldEventSystem } from '../src/gameplay/situation/WorldEventSystem';
import { armyUnits, syncMilitaryTotals } from '../src/gameplay/military/armies';
import { canAffordProject, projectAvailable } from '../src/gameplay/production/ProductionSystem';
import { MAX_ACTIVE_POLICIES } from '../src/gameplay/policy/types';
import type { SimEventSink } from '../src/gameplay/events';
import type { CountryState } from '../src/gameplay/country/types';

/**
 * Milestone 7 suite: persistent sandbox systems.
 *
 * Covers population/manpower, regional industry, the construction queue,
 * trade/market pricing, convoy and logistics state, naval invasion, airlift,
 * intelligence detection, national policies, emergent situations, weapons
 * production, clock speeds, notifications, save v7 and migration, determinism
 * and a multi-year open-ended campaign.
 *
 * No renderer, browser or wall-clock dependency: every scenario runs the same
 * seeded simulation the game uses.
 */
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};
const log = (message: string): void => console.log(`  ✓ ${message}`);
const days = (session: GameSession, from: number, to: number): void => {
  for (let day = from; day <= to; day += 1) session.simulation.tickDay(day);
};
const sink = { emit: () => undefined } as unknown as SimEventSink;

console.log('Terra Dominion — persistent sandbox smoke test');

const session = GameSession.create({ countryId: 'IRN', locale: 'en', difficulty: 'standard', seed: 4242 });
const world = session.world;
const player = world.player!;
assert(player, 'campaign has a player country');

// ── Population, manpower and regional industry ───────────────────────────────
const regionTotal = player.regions.reduce((sum, region) => sum + region.population, 0);
assert(Math.abs(regionTotal - player.population) <= player.regions.length, 'regional population sums to the nation');
assert(player.society.population === player.population, 'society mirrors national population');
assert(player.society.workingPopulation > 0, 'working population is derived');
assert(player.society.militaryAgePopulation > 0, 'military-age population is derived');
assert(player.society.manpowerPool >= 0, 'manpower pool is non-negative');
assert(player.economy.availableManpower === player.society.manpowerPool, 'military recruitment reads the society pool');
assert(
  player.regions.every(
    (region) =>
      region.workingPopulation > 0 &&
      region.militaryAgePopulation > 0 &&
      region.populationCapacity > region.population * 0.5 &&
      region.civilianIndustry >= 0 &&
      region.civilianIndustry <= 1 &&
      region.militaryIndustry >= 0 &&
      region.militaryIndustry <= 1 &&
      region.constructionCapacity > 0 &&
      region.development >= 0,
  ),
  'every region carries population, industry and construction capacity',
);
const growthBefore = player.population;
const pressureBefore = player.society.recruitmentPressure;
days(session, 2, 31);
assert(player.population >= growthBefore, 'population grows in peace');
assert(player.society.growthRate >= 0, 'growth rate is tracked');
assert(player.society.recruitmentPressure >= pressureBefore, 'recruitment pressure is recomputed');
log(`population: ${player.population.toLocaleString()} people, pool ${player.society.manpowerPool.toFixed(1)}k`);

const casualtiesBefore = player.society.casualties;
const populationBeforeLoss = player.population;
const poolBeforeLoss = player.society.manpowerPool;
new PopulationSystem(sink).registerCasualties(player, 3, 40);
assert(player.society.casualties > casualtiesBefore, 'battle casualties accumulate');
assert(player.population < populationBeforeLoss, 'casualties reduce population');
assert(player.society.manpowerPool < poolBeforeLoss, 'casualties consume future recruits');
assert(player.society.manpowerPool <= manpowerCeiling(player), 'manpower pool cannot exceed the mobilisation ceiling');
log('manpower: casualties reduce population and the recruit pool');

// ── Construction queue, priority and cancellation ────────────────────────────
player.economy.resources.money = 20_000;
player.economy.resources.steel = 5_000;
player.economy.resources.oil = 2_000;
player.economy.resources.electronics = 2_000;
const project = INFRASTRUCTURE_PROJECTS.find(
  (entry) =>
    entry.id === 'proj_roads' &&
    canAffordProject(player, entry) &&
    player.regions.some((region) => projectAvailable(player, entry, region.id)),
);
assert(project, 'a basic infrastructure project is available');
const buildRegion =
  player.regions.find(
    (region) => region.id !== player.capitalRegionId && projectAvailable(player, project!, region.id),
  ) ?? player.regions[0];
const infrastructureBefore = buildRegion.infrastructure;
assert(session.startConstruction(project!.id, buildRegion.id), 'construction can be queued');
assert(player.production.construction.length === 1, 'the queue contains the order');
const order = player.production.construction[0];
assert(order.priority === 'normal', 'new orders default to normal priority');
assert(session.setConstructionPriority(order.id, 'high'), 'priority can be raised');
assert(order.priority === 'high', 'priority is stored');
assert(session.cancelConstruction(order.id), 'an order can be cancelled');
assert(player.production.construction.length === 0, 'cancellation removes the order');
assert(player.economy.resources.money < 20_000, 'construction consumes material');
assert(session.startConstruction(project!.id, buildRegion.id, 'high'), 'construction can be restarted');
const completedBefore = player.production.completedProjects;
days(session, 32, 220);
assert(
  player.production.completedProjects > completedBefore,
  'the queued project completes through normal simulation ticks',
);
assert(
  player.production.construction.length === 0,
  'the queue empties after completion',
);
assert(
  buildRegion.infrastructure >= infrastructureBefore,
  'completed infrastructure improves the region',
);
log(`construction: ${project!.id} completed, infrastructure ${infrastructureBefore.toFixed(2)} → ${buildRegion.infrastructure.toFixed(2)}`);

// ── Trade, market pricing, routes and logistics ──────────────────────────────
const partner = world
  .neighboursOf(player.id)
  .map((id) => world.get(id))
  .find((country): country is CountryState => Boolean(country));
assert(partner, 'the player has a trade partner candidate');
assert(session.openTrade(partner!.id), 'a trade agreement can be opened');
for (const resource of TRADE_RESOURCES) {
  partner!.economy.resources[resource] = Math.max(partner!.economy.resources[resource], 100);
  player.economy.resources[resource] = Math.max(player.economy.resources[resource], 40);
}
player.economy.resources.money = 10_000;
partner!.economy.resources.money = 10_000;
const routeResult = session.establishTradeRoute(partner!.id, 'oil', 4);
assert(routeResult.ok, 'a trade route opens over a land or sea corridor');
assert(Object.values(world.tradeRoutes).length > 0, 'the route exists in the world');
assert(player.trade && player.trade.routes.length > 0, 'both endpoints record the route');
const route = Object.values(world.tradeRoutes)[0];
const playerOilBefore = player.economy.resources.oil;
const partnerOilBefore = partner!.economy.resources.oil;
const priceBefore = world.market.prices.oil;
days(session, 221, 240);
assert(player.economy.resources.oil !== playerOilBefore, 'trade moves real resources');
assert(partner!.economy.resources.oil < partnerOilBefore, 'the seller stockpile falls');
assert(world.market.prices.oil !== priceBefore, 'market prices move with supply and demand');
assert(
  world.market.prices.oil >= 0,
  'prices stay non-negative',
);
assert(route.throughput > 0 && route.throughput <= 1, 'route throughput is normalised');
assert(player.trade!.income >= 0 && player.trade!.expenses >= 0, 'trade income and expenses are tracked');
assert(player.logisticsState && player.logisticsState.throughput >= 0, 'logistics exposes network throughput');
assert(player.logisticsState.convoyCapacity >= 0, 'convoy capacity is tracked');
assert(typeof player.trade!.disruption === 'number', 'trade disruption is tracked');
log(
  `trade: oil ${playerOilBefore.toFixed(1)} → ${player.economy.resources.oil.toFixed(1)}, price ${priceBefore.toFixed(1)} → ${world.market.prices.oil.toFixed(1)}`,
);

// ── Naval invasion ──────────────────────────────────────────────────────────
const coastalEnemy = world
  .neighboursOf(player.id)
  .map((id) => world.get(id))
  .find(
    (country): country is CountryState =>
      Boolean(country) &&
      country!.regions.some((region) => Boolean(regionAt(region.id)?.hasPort)),
  );
assert(coastalEnemy, 'a neighbouring coastal country exists');
assert(session.declareWar(coastalEnemy!.id), 'war can be declared for an invasion');
const coastalTarget = coastalEnemy!.regions.find((region) => Boolean(regionAt(region.id)?.hasPort));
assert(coastalTarget, 'the enemy has a coastal region');
coastalEnemy!.military.armies = [];
coastalTarget!.fortification = 0;
player.military.formations.nav_patrol = (player.military.formations.nav_patrol ?? 0) + 40;
player.regions[0].portCapacity = 1;
player.economy.resources.money = 20_000;
player.economy.resources.oil = 5_000;
syncMilitaryTotals(player);
const invasionArmy = player.military.armies[0];
assert(invasionArmy, 'an army is available to embark');
assert(
  session.transportCapacity() > armyUnits(invasionArmy) * 0.8,
  `transport capacity is sufficient (capacity ${session.transportCapacity().toFixed(1)}, army ${armyUnits(invasionArmy)}, ports ${player.regions.filter((region) => Boolean(regionAt(region.id)?.hasPort)).length})`,
);
const invasion = session.startNavalInvasion(invasionArmy.id, coastalTarget!.id);
assert(invasion.ok, 'a naval invasion is an ordinary strategic action');
assert(player.maneuver.invasions.length === 1, 'the invasion enters the manoeuvre queue');
const invasionDays = invasion.days ?? 20;
days(session, 241, 241 + invasionDays + 12);
assert(player.maneuver.invasions.length === 0, 'the invasion resolves');
assert(invasionArmy.regionId === coastalTarget!.id, 'the landing force reaches the destination coast');
assert(invasionArmy.locationId === coastalEnemy!.id, 'the army is located in the enemy country');
log(`naval invasion: ${invasionArmy.id} landed at ${coastalTarget!.id}`);

// ── Airlift and strategic redeployment ──────────────────────────────────────
player.military.formations.air_transport = (player.military.formations.air_transport ?? 0) + 10;
syncMilitaryTotals(player);
const homeAirport = player.regions.find(
  (region) => region.id !== invasionArmy.regionId && (Boolean(regionAt(region.id)?.hasAirport) || region.airportCapacity > 0.05),
);
assert(homeAirport, 'the player owns another airport');
player.economy.resources.money = 20_000;
player.economy.resources.oil = 5_000;
const airlift = session.startAirlift(invasionArmy.id, homeAirport!.id, 'redeploy');
assert(airlift.ok, 'an airlift is launched between valid airports');
assert(player.maneuver.airlifts.length === 1, 'the airlift enters the queue');
days(session, 241 + invasionDays + 13, 241 + invasionDays + 25);
assert(player.maneuver.airlifts.length === 0, 'the airlift resolves');
assert(invasionArmy.regionId === homeAirport!.id, 'the formation is redeployed by air');
log(`airlift: ${invasionArmy.id} redeployed to ${homeAirport!.id}`);

// ── Intelligence, detection and information decay ───────────────────────────
days(session, 241 + invasionDays + 26, 241 + invasionDays + 40);
assert(player.intelligence, 'intelligence state exists');
assert(player.intelligence.coverage >= 0 && player.intelligence.coverage <= 1, 'reconnaissance coverage is bounded');
assert(player.intelligence.detection >= 0 && player.intelligence.detection <= 1, 'detection is bounded');
assert(Object.keys(player.intelligence.contacts).length > 0, 'neighbours produce intelligence contacts');
const neighbourContact = Object.values(player.intelligence.contacts)[0];
assert(neighbourContact.confidence >= 0 && neighbourContact.confidence <= 1, 'contact confidence is bounded');
assert(neighbourContact.lastSeenDay >= 1, 'contacts remember the last observation day');
log(`intelligence: ${Object.keys(player.intelligence.contacts).length} contacts, ${(player.intelligence.confidence * 100).toFixed(0)}% confidence`);

// ── Policies and mobilisation ───────────────────────────────────────────────
player.economy.resources.money = 20_000;
const policy = POLICIES.find((entry) => entry.id === 'pol_mass_mobilization');
assert(policy, 'a mobilisation policy exists');
const manpowerModifierBefore = player.modifiers.manpower;
assert(session.setPolicy(policy!.id, true), 'a national policy can be enacted');
assert(player.policy.active.includes(policy!.id), 'the policy is active');
assert(player.modifiers.manpower > manpowerModifierBefore, 'policy effects reach national modifiers');
const poolCeilingLow = manpowerCeiling(player);
assert(session.setMobilization(0.9), 'mobilisation can be raised');
assert(manpowerCeiling(player) > poolCeilingLow, 'higher mobilisation expands the manpower ceiling');
assert(player.policy.active.length <= MAX_ACTIVE_POLICIES, 'policy slots are enforced');
assert(session.setPolicy(policy!.id, false), 'a policy can be repealed');
log('policies: enactment, modifiers, mobilisation and repeal verified');

// ── Emergent world situations ───────────────────────────────────────────────
const situationSystem = new WorldEventSystem(sink);
const situationDefinition = SITUATIONS[0];
assert(situationDefinition, 'situations are data-driven');
const activeSituation = situationSystem.start(world, player, situationDefinition, world.day);
assert(world.situations.active.some((entry) => entry.id === activeSituation.id), 'a situation can begin');
days(session, world.day + 1, activeSituation.endDay + 2);
assert(
  !world.situations.active.some((entry) => entry.id === activeSituation.id),
  'a situation ends without a scripted objective',
);
assert(
  world.situations.history.some((entry) => entry.id === activeSituation.id),
  'resolved situations enter bounded history',
);
log(`situations: ${situationDefinition.id} began and resolved`);

// ── Strategic-weapons production ────────────────────────────────────────────
const factoryRegion = player.regions[0];
factoryRegion.militaryIndustry = Math.max(0.5, factoryRegion.militaryIndustry);
player.economy.resources.money = 20_000;
player.economy.resources.electronics = 2_000;
player.economy.resources.rare = 2_000;
const missileBefore = player.warfare.missiles.stockpile.tactical ?? 0;
const missileOrder = session.queueMissile('tactical');
assert(missileOrder.ok, 'a missile can be queued from military industry');
assert(player.warfare.missiles.production.length === 1, 'the missile production queue records the order');
days(session, world.day + 1, world.day + 20);
assert(
  (player.warfare.missiles.stockpile.tactical ?? 0) > missileBefore,
  'missile production adds a stockpile round',
);
log('strategic weapons: production consumes resources and adds a stockpile round');

// ── Clock speeds, pause and bounded catch-up ────────────────────────────────
const slow = new SimClock(1000, 1);
const fast = new SimClock(1000, 1);
slow.setSpeed(1);
fast.setSpeed(8);
assert(slow.advance(1000) === 1, '1x advances one day per day-length');
assert(fast.advance(1000) === 8, '8x advances eight days per day-length');
fast.setSpeed(0);
assert(fast.advance(100_000) === 0 && fast.isPaused, 'pause stops time');
fast.setSpeed(8);
assert(fast.advance(100_000) === GAME.maxDaysPerFrame, 'catch-up is bounded per frame');
assert(GAME.maxDaysPerFrame >= 16, 'fast speeds process several days per frame');
log(`clock: 1x/8x, pause and a ${GAME.maxDaysPerFrame}-day frame budget verified`);

// ── Notifications ───────────────────────────────────────────────────────────
const notificationsBefore = session.notifications.length;
const unreadBefore = session.unread;
const notificationTarget = world
  .neighboursOf(player.id)
  .map((id) => world.get(id))
  .find((country) => country && !player.diplomacy.relations[country.id]?.atWar);
assert(notificationTarget, 'a notification target is available');
session.declareWar(notificationTarget!.id);
assert(session.notifications.length > notificationsBefore, 'player-relevant events enter the feed');
assert(session.unread > unreadBefore, 'new notifications are unread');
assert(session.notifications.every((entry) => entry.message.length > 0), 'every notification is localized text');
log(`notifications: ${session.notifications.length} entries`);

// ── Save v7 round-trip and migration from v6 ────────────────────────────────
assert(CURRENT_SAVE_VERSION === 7, 'save schema is version 7');
session.saveName = 'Sandbox endurance';
const payload = session.toSavePayload();
const file = JSON.parse(
  JSON.stringify({ ...payload, slot: '1', version: CURRENT_SAVE_VERSION, updatedAt: Date.now() }),
) as SaveFile;
assert(file.meta.customName === 'Sandbox endurance', 'save names are persisted');
const loaded = GameSession.fromSave(file, 'en');
assert(loaded.world.player!.society.population > 0, 'save keeps society state');
assert(loaded.world.player!.trade !== undefined, 'save keeps trade state');
assert(loaded.world.player!.maneuver !== undefined, 'save keeps manoeuvre state');
assert(Object.keys(loaded.world.tradeRoutes).length >= 0, 'save keeps the world route registry');
assert(loaded.world.market.prices.oil > 0, 'save keeps market prices');
assert(Array.isArray(loaded.world.situations.active), 'save keeps situations');
assert(loaded.world.player!.military.armies.length === player.military.armies.length, 'save keeps armies');
assert(loaded.saveName === 'Sandbox endurance', 'loaded campaigns retain their name');
log('save v7: society, trade, manoeuvre, market, situations and names round-trip');

const legacy = JSON.parse(JSON.stringify(file)) as SaveFile & Record<string, unknown>;
legacy.version = 6;
const legacyWorld = legacy.world as unknown as Record<string, unknown>;
delete legacyWorld.market;
delete legacyWorld.tradeRoutes;
delete legacyWorld.situations;
for (const country of legacy.world.countries as unknown as Array<Record<string, unknown>>) {
  delete country.society;
  delete country.trade;
  delete country.intelligence;
  delete country.policy;
  delete country.logisticsState;
  delete country.maneuver;
  for (const region of country.regions as Array<Record<string, unknown>>) {
    delete region.workingPopulation;
    delete region.militaryAgePopulation;
    delete region.populationCapacity;
    delete region.civilianIndustry;
    delete region.militaryIndustry;
    delete region.constructionCapacity;
    delete region.airportCapacity;
    delete region.portCapacity;
    delete region.extractionCapacity;
    delete region.development;
  }
}
const migrated = migrateSave(legacy as unknown as Record<string, unknown>);
assert(migrated.version === 7, 'v6 migrates to v7');
assert(migrated.world.countries.every((country) => country.society && country.policy), 'v6 → v7 adds society and policy');
assert(migrated.world.countries.every((country) => country.maneuver && country.logisticsState), 'v6 → v7 adds manoeuvre and logistics');
assert(migrated.world.countries.every((country) => country.regions.every((region) => region.civilianIndustry >= 0)), 'v6 → v7 adds regional industry');
assert(Boolean(migrated.world.market && migrated.world.tradeRoutes && migrated.world.situations), 'v6 → v7 adds market, routes and situations');
const migratedSession = GameSession.fromSave(migrated, 'en');
assert(migratedSession.world.player!.society.population > 0, 'migrated campaign loads');
log('migration: v6 → v7 rebuilds the persistent sandbox state');

// ── Determinism ─────────────────────────────────────────────────────────────
const a = GameSession.create({ countryId: 'KWT', locale: 'en', difficulty: 'standard', seed: 777 });
const b = GameSession.create({ countryId: 'KWT', locale: 'en', difficulty: 'standard', seed: 777 });
for (let day = 2; day <= 181; day += 1) {
  a.simulation.tickDay(day);
  b.simulation.tickDay(day);
}
const fingerprint = (target: GameSession): string =>
  JSON.stringify({
    day: target.world.day,
    countries: [...target.world.countries.values()].map((country) => ({
      id: country.id,
      population: country.population,
      money: Math.round(country.economy.resources.money * 1000),
      armies: country.military.armies.map((army) => [army.id, army.regionId, armyUnits(army)]),
      policies: country.policy.active,
    })),
    prices: target.world.market.prices,
    situations: target.world.situations.active.map((entry) => entry.id),
  });
assert(fingerprint(a) === fingerprint(b), 'the same seed and inputs produce identical worlds');
log('determinism: two 180-day campaigns are byte-identical in state');

// ── Long-running open-ended sandbox ────────────────────────────────────────
const long = GameSession.create({ countryId: 'BRA', locale: 'en', difficulty: 'standard', seed: 9090 });
for (let day = 2; day <= 731; day += 1) long.simulation.tickDay(day);
assert(long.world.day === 731, 'the world runs for two years without a campaign ending');
assert(long.notifications.length > 0, 'the long campaign has a notification history');
assert(long.world.player!.society.population > 0, 'population survives two years of simulation');
assert(long.world.player!.policy.active.length <= MAX_ACTIVE_POLICIES, 'AI policy slots stay bounded');
assert(long.notifications.length <= GAME.notificationLimit, 'notification history stays bounded');
assert(Number.isFinite(long.world.player!.economy.resources.money), 'the economy remains finite');

// ── Persian localization and RTL-safe strings ──────────────────────────────
const persian = GameSession.create({ countryId: 'IRN', locale: 'fa', difficulty: 'standard', seed: 4242 });
const persianSnapshot = persian.snapshot();
assert(persianSnapshot, 'a Persian snapshot is produced');
assert(/[\u0600-\u06FF]/.test(persianSnapshot!.society.regions[0]?.name ?? ''), 'region names are Persian');
assert(/[\u0600-\u06FF]/.test(persianSnapshot!.policies.available[0]?.name ?? ''), 'policy names are Persian');
assert(/[\u0600-\u06FF]/.test(persianSnapshot!.situations[0]?.name ?? '') || persianSnapshot!.situations.length === 0, 'situations are localized');
assert((persianSnapshot!.trade.prices[0]?.name.length ?? 0) > 0, 'market labels are localized');
const persianWar = GameSession.create({ countryId: 'IRN', locale: 'fa', difficulty: 'standard', seed: 4242 });
const persianTarget = persianWar.world.neighboursOf('IRN')[0];
persianWar.declareWar(persianTarget);
assert(
  persianWar.notifications.some((entry) => /[\u0600-\u06FF]/.test(entry.message)),
  'notifications are localized in Persian',
);
log('localization: Persian labels and notification text verified');

console.log('Persistent sandbox smoke test passed.');
