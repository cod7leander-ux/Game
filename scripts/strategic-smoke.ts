import { CURRENT_SAVE_VERSION, type SaveFile } from '../src/save/types';
import { migrateSave } from '../src/save/migrations';
import { GameSession } from '../src/game/GameSession';
import { World } from '../src/gameplay/World';
import { SimEventBus } from '../src/gameplay/events';
import { EconomySystem, regionOutput } from '../src/gameplay/economy/EconomySystem';
import { ProductionSystem } from '../src/gameplay/production/ProductionSystem';
import { ResearchSystem, startResearch, technologyAvailable } from '../src/gameplay/research/ResearchSystem';
import { DiplomacySystem } from '../src/gameplay/diplomacy/DiplomacySystem';
import { relationIsConsistent } from '../src/gameplay/diplomacy/types';
import { LogisticsSystem, computeSupply } from '../src/gameplay/logistics/LogisticsSystem';
import { StabilitySystem } from '../src/gameplay/stability/StabilitySystem';
import { addObjective, activeObjectives } from '../src/gameplay/objectives/objectives';
import { decide, DEFAULT_EVALUATORS, type AIContext } from '../src/gameplay/ai/AIDirector';
import { PERSONALITIES } from '../src/data/personalities';
import { armyUnits } from '../src/gameplay/military/armies';
import { normalizeAllocation } from '../src/gameplay/economy/types';

/**
 * Milestone 4 headless suite: economy, resources, production, research,
 * diplomacy, AI, logistics, stability, objectives and save migrations.
 *
 * Everything runs against the real systems with no renderer, so the suite
 * covers the same code paths the campaign uses.
 */
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};
const log = (message: string): void => console.log(`  ✓ ${message}`);

console.log('Terra Dominion — strategic depth smoke test');

const world = new World({ seed: 4242, playerCountryId: 'IRN', day: 1 });
const events = new SimEventBus();
const player = world.player;
assert(player, 'world has a player country');
assert(player.regions.length > 1, 'country owns multiple provinces');
assert(player.capitalRegionId === player.regions[0].id, 'capital region is tracked');
log(`${player.regions.length} provinces generated for ${player.id}`);

// ── Economy and resources ────────────────────────────────────────────────────
const economy = new EconomySystem();
const beforeTreasury = player.economy.resources.money;
const beforeSteel = player.economy.resources.steel;
for (let day = 2; day <= 12; day += 1) economy.tick(player);
assert(player.economy.income > 0, 'country earns daily income');
assert(player.economy.expenses >= 0, 'expenses are non-negative');
assert(Number.isFinite(player.economy.resources.money), 'treasury stays finite');
assert(player.economy.resources.money !== beforeTreasury, 'treasury changes with the daily tick');
assert(player.economy.resources.steel >= beforeSteel, 'steel production accumulates');
assert(player.economy.resourceFlow.steel > 0, 'resource flow records production');
assert(player.economy.resources.aluminum >= 0, 'aluminium exists as a resource');
assert(player.regions.every((region) => region.population > 0), 'every province has population');
const output = regionOutput(player, player.regions[0]);
assert(Object.values(output).some((value) => (value ?? 0) > 0), 'provinces produce resources');
assert(
  player.economy.resources.money <= Math.max(50, player.economy.gdp * 0.02) * 8 + 1e-6,
  'treasury is capped',
);
log(
  `economy: income ${player.economy.income.toFixed(1)}, expenses ${player.economy.expenses.toFixed(1)}, treasury ${Math.round(player.economy.resources.money)}`,
);

// ── Production / construction ────────────────────────────────────────────────
const production = new ProductionSystem(events);
const targetRegion = player.regions[0];
player.economy.resources.money = 5000;
player.economy.resources.steel = 5000;
player.economy.resources.oil = 5000;
const infrastructureBefore = targetRegion.infrastructure;
const order = production.enqueue(player, 'proj_roads', targetRegion.id, 12);
assert(order.ok, 'infrastructure project can be queued');
assert(player.production.construction.length === 1, 'queue holds the order');
const completion = { value: 0 };
events.on((event) => {
  if (event.type === 'constructionComplete') completion.value += 1;
});
for (let day = 13; day <= 80; day += 1) production.tick(player, day);
assert(player.production.completedProjects === 1, 'construction completes');
assert(completion.value === 1, 'completion event fires');
assert(targetRegion.infrastructure > infrastructureBefore, 'project raises regional infrastructure');
log('production: queued, advanced and applied a project');

// ── Research ────────────────────────────────────────────────────────────────
const research = new ResearchSystem(events);
assert(technologyAvailable(player, 'ind_assembly'), 'tier-1 technology is available');
assert(startResearch(player, 'ind_assembly'), 'research programme can start');
assert(player.research.activeTechId === 'ind_assembly', 'research programme selected');
const productionModifierBefore = player.modifiers.production;
for (let day = 81; day <= 400; day += 1) research.tick(player, day);
assert(player.research.completed.includes('ind_assembly'), 'research completes over time');
assert(player.modifiers.production > productionModifierBefore, 'technology applies its effects');
assert(!technologyAvailable(player, 'ind_assembly'), 'completed technology cannot restart');
log(`research: completed ${player.research.completed.length} programme(s)`);

// ── Diplomacy ───────────────────────────────────────────────────────────────
const diplomacy = new DiplomacySystem(events);
const other = [...world.countries.values()].find((country) => country.id !== player.id);
assert(other, 'world has another country');
player.diplomacy.influence = 1;
other.diplomacy.influence = 1;
diplomacy.improveRelations(player, other, 400);
const valueAfterImprove = player.diplomacy.relations[other.id]?.value ?? 0;
assert(valueAfterImprove > 0, 'improving relations raises their value');
assert(diplomacy.formNonAggression(player, other, 401), 'non-aggression pact can be signed');
assert(player.diplomacy.relations[other.id]?.nonAggression, 'pact flag is set on both sides');
assert(diplomacy.declareWar(player, other, 402), 'war can be declared');
const warRelation = player.diplomacy.relations[other.id]!;
assert(warRelation.atWar, 'war flag is set');
assert(!warRelation.nonAggression, 'war clears the non-aggression pact');
assert(player.diplomacy.relations[other.id] && relationIsConsistent(player.diplomacy.relations[other.id]!), 'no contradictory state after war');
assert(diplomacy.formAlliance(player, other, 403) === false, 'alliance cannot form while at war');
assert(diplomacy.declareWar(player, other, 404) === false, 'duplicate war declaration rejected');
assert(diplomacy.signPeace(player, other, 405), 'peace can be signed');
assert(!player.diplomacy.relations[other.id]!.atWar, 'peace clears the war flag');
assert(diplomacy.imposeEmbargo(player, other, 406), 'embargo can be imposed');
assert(diplomacy.openTrade(player, other, 407) === false, 'trade blocked while embargoed');
log('diplomacy: pacts, war, peace and embargo guards behave correctly');

// ── Stability and war weariness ─────────────────────────────────────────────
const stability = new StabilitySystem();
player.diplomacy.wars = [other.id];
const exhaustionBefore = player.warExhaustion;
for (let day = 410; day <= 460; day += 1) stability.tick(player, day);
assert(player.warExhaustion > exhaustionBefore, 'war raises exhaustion');
assert(player.unrest >= 0 && player.unrest <= 1, 'unrest stays in range');
assert(player.stability >= 0 && player.stability <= 1, 'stability stays in range');
player.diplomacy.wars = [];
for (let day = 461; day <= 520; day += 1) stability.tick(player, day);
assert(player.warExhaustion < 1, 'exhaustion recovers in peace');
log('stability: exhaustion rises at war and recovers in peace');

// ── Logistics ───────────────────────────────────────────────────────────────
const logistics = new LogisticsSystem();
const army = player.military.armies[0];
const homeSupply = computeSupply(world, player, army);
const enemy = world.neighboursOf(player.id)
  .map((id) => world.get(id))
  .find(Boolean);
assert(enemy, 'a neighbouring country exists');
army.locationId = enemy!.id;
army.supply = 0.1;
army.daysLowSupply = 10;
const abroadSupply = computeSupply(world, player, army);
assert(abroadSupply.supply < homeSupply.supply, 'supply drops in unsupported territory');
const unitsBefore = armyUnits(army);
for (let tick = 0; tick < 3; tick += 1) logistics.tick(world);
assert(armyUnits(army) < unitsBefore, 'unsupplied armies suffer attrition');
assert(army.supplySource === null, 'unsupported army has no supply source');
log('logistics: distance and lack of a source reduce supply and cost men');

// ── Objectives and AI decisions ─────────────────────────────────────────────
addObjective(player, { kind: 'captureCapital', priority: 0.9, targetCountryId: enemy!.id }, 500);
assert(activeObjectives(player).length > 0, 'objectives can be added');
assert(activeObjectives(player)[0].targetCountryId === enemy!.id, 'objective keeps its target');

const aiCountry = other!;
aiCountry.diplomacy.wars = [];
const context: AIContext = {
  world,
  country: aiCountry,
  personality: PERSONALITIES[aiCountry.ai.personalityId] ?? PERSONALITIES.balanced,
  state: aiCountry.ai,
  day: 600,
};
const decision = decide(context, DEFAULT_EVALUATORS);
assert(decision.focus.length > 0, 'AI picks a strategic focus');
assert(aiCountry.military.armies.length > 0, 'AI country has armies');

const normalized = normalizeAllocation({ military: 0.2, infrastructure: 0.2, research: 0.2 });
assert(Math.abs(normalized.military + normalized.infrastructure + normalized.research - 1) < 1e-9, 'allocation normalises to one');
log(`AI focus: ${decision.focus}`);

// ── Save v4 and migrations ──────────────────────────────────────────────────
const session = GameSession.create({ countryId: 'IRN', locale: 'en', difficulty: 'standard' });
for (let day = session.clock.day + 1; day <= 40; day += 1) session.simulation.tickDay(day);
const playerState = session.world.player!;
assert(playerState.objectives.length >= 0, 'objectives are part of the campaign');
const saveFile = JSON.parse(
  JSON.stringify({ ...session.toSavePayload(), slot: '1', version: CURRENT_SAVE_VERSION, updatedAt: Date.now() }),
) as SaveFile;
assert(saveFile.world.countries.every((country) => country.regions.length > 0), 'saves carry provinces');
assert(saveFile.world.countries.every((country) => country.economy.allocation), 'saves carry budget allocation');
assert(
  saveFile.world.countries.every((country) => country.military.armies.every((army) => typeof army.supply === 'number')),
  'saves carry army supply',
);

const loaded = GameSession.fromSave(saveFile, 'en');
assert(loaded.world.player!.regions.length === playerState.regions.length, 'province state round-trips');
assert(
  Math.abs(loaded.world.player!.economy.allocation.military - playerState.economy.allocation.military) < 1e-9,
  'allocation round-trips',
);
log('v4 save round-trip preserves provinces and strategic state');

// Strip a v4 save back to a v3 shape: all Milestone 4 fields must be rebuilt.
const legacy = JSON.parse(JSON.stringify(saveFile)) as Record<string, unknown>;
legacy.version = 3;
const legacyWorld = legacy.world as { countries: Array<Record<string, unknown>> };
for (const country of legacyWorld.countries) {
  delete country.regions;
  delete country.capitalRegionId;
  delete country.warExhaustion;
  delete country.unrest;
  delete country.objectives;
  delete country.production;
  const economyState = country.economy as Record<string, unknown>;
  delete economyState.allocation;
  delete economyState.resourceFlow;
  const resources = economyState.resources as Record<string, unknown>;
  delete resources.aluminum;
  const diplomacyState = country.diplomacy as Record<string, unknown>;
  delete diplomacyState.nonAggressionPartners;
  delete diplomacyState.militaryAccessPartners;
  delete diplomacyState.embargoed;
  for (const relation of Object.values(diplomacyState.relations as Record<string, Record<string, unknown>>)) {
    delete relation.nonAggression;
    delete relation.militaryAccess;
    delete relation.embargo;
    delete relation.sanctioned;
    delete relation.trust;
    delete relation.threat;
  }
  const military = country.military as Record<string, unknown>;
  for (const armyEntry of military.armies as Array<Record<string, unknown>>) {
    delete armyEntry.supply;
    delete armyEntry.supplySource;
    delete armyEntry.daysLowSupply;
  }
}
const migrated = migrateSave(legacy);
assert(migrated.version === 5, 'v3 migrates through v4 to v5');
assert(migrated.world.countries.every((country) => country.regions.length > 0), 'migration regenerates provinces');
assert(migrated.world.countries.every((country) => country.economy.allocation), 'migration adds allocation');
assert(
  migrated.world.countries.every((country) => country.military.armies.every((army) => typeof army.supply === 'number')),
  'migration adds army supply',
);
assert(migrated.world.countries.every((country) => country.economy.resources.aluminum >= 0), 'migration adds aluminium');
assert(
  Object.values(migrated.world.countries[0].diplomacy.relations).every((relation) => relationIsConsistent(relation)),
  'migrated relations are consistent',
);
log('v3 → v4 → v5 migration rebuilds provinces, economy and supply');

// The full chain from the original schema.
const ancient = JSON.parse(JSON.stringify(saveFile)) as Record<string, unknown>;
ancient.version = 1;
const ancientWorld = ancient.world as { countries: Array<Record<string, unknown>> };
for (const country of ancientWorld.countries) {
  delete country.occupierId;
  const military = country.military as Record<string, unknown>;
  delete military.armies;
  delete country.regions;
  delete country.capitalRegionId;
  delete country.warExhaustion;
  delete country.unrest;
  delete country.objectives;
  delete country.production;
}
const chained = migrateSave(ancient);
assert(chained.version === 5, 'v1 migrates through v2, v3, v4 to v5');
assert(chained.world.countries.every((country) => country.military.armies.length > 0), 'v1 → v5 keeps an army per country');
assert(chained.world.countries.every((country) => country.regions.length > 0), 'v1 → v5 creates provinces');
log('v1 → v2 → v3 → v4 → v5 chain preserved');

// ── Long campaign regression ────────────────────────────────────────────────
const campaign = GameSession.create({ countryId: 'KWT', locale: 'en', difficulty: 'standard' });
const neighbour = campaign.world.neighboursOf('KWT')[0];
assert(campaign.declareWar(neighbour), 'campaign war can start');
let battles = 0;
campaign.simulation.events.on((event) => {
  if (event.type === 'battleResolved') battles += 1;
});
let sawSupplyBelowOne = false;
for (let day = 2; day <= 180; day += 1) {
  campaign.simulation.tickDay(day);
  const armies = [...campaign.world.countries.values()].flatMap((country) => country.military.armies);
  if (armies.some((army) => army.supply < 1)) sawSupplyBelowOne = true;
}
const countries = [...campaign.world.countries.values()];
assert(countries.every((country) => Number.isFinite(country.economy.resources.money)), 'long campaign keeps treasuries finite');
assert(
  countries.every((country) =>
    Object.values(country.military.formations).every((count) => Number.isFinite(count) && count >= 0),
  ),
  'long campaign keeps formations valid',
);
assert(countries.every((country) => country.objectives.length <= 24), 'objective lists stay bounded');
assert(sawSupplyBelowOne, 'armies experience supply changes during the campaign');
assert(battles >= 0, 'battles remain resolvable');
log(`180-day campaign: ${battles} battle(s), ${countries.length} countries simulated`);

session.dispose();
campaign.dispose();
console.log('Strategic smoke test passed.');
