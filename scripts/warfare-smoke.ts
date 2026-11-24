import { GameSession } from '../src/game/GameSession';
import { findRegionState } from '../src/gameplay/war/WarSystem';
import type { PeaceOffer, PeaceTerm } from '../src/gameplay/war/types';
import { CURRENT_SAVE_VERSION, type SaveFile } from '../src/save/types';
import { migrateSave } from '../src/save/migrations';
import { regionControllerId } from '../src/gameplay/regions/regions';
import { computeSupply, isArmyIsolated } from '../src/gameplay/logistics/LogisticsSystem';
import { GEO_PORTS, REGION_GEO_BY_ID } from '../src/geo';
import { PERSONALITIES } from '../src/data/personalities';
import { syncMilitaryTotals } from '../src/gameplay/military/armies';
import { DEFAULT_EVALUATORS, decide, type AIContext } from '../src/gameplay/ai/AIDirector';

/**
 * Milestone 6 suite: multi-country wars, goals, score, exhaustion, regional
 * control, fronts, army groups, operations, supply isolation, air/naval/
 * blockade/missile foundations, peace and annexation, strategic AI
 * personalities, save v6 and a full-year campaign.
 *
 * No renderer, no browser and no randomness outside the simulation's seeded
 * RNG, so results are deterministic.
 */
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};
const log = (message: string): void => console.log(`  ✓ ${message}`);
const days = (session: GameSession, from: number, to: number): void => {
  for (let day = from; day <= to; day += 1) session.simulation.tickDay(day);
};

console.log('Terra Dominion — advanced warfare smoke test');

const session = GameSession.create({ countryId: 'KWT', locale: 'en', difficulty: 'standard' });
const world = session.world;
const player = world.player!;
const defender = world.get(world.neighboursOf(player.id)[0])!;
assert(defender, 'campaign has a neighbouring target');
assert(session.declareWar(defender.id), 'war can be declared');

const war = session.simulation.warOf(player.id)[0];
assert(war && war.status === 'active', 'war entity exists and is active');
const activeWar = () => {
  const current = session.simulation.warOf(player.id)[0];
  if (current) return current;
  assert(session.declareWar(defender.id), 'a follow-up war can be declared');
  const next = session.simulation.warOf(player.id)[0];
  assert(next, 'follow-up war exists');
  return next;
};
assert(war.goals.length >= 3, 'war creates goals for both sides');
assert(
  war.goals.some((goal) => goal.type === 'captureCapital' && goal.ownerId === player.id),
  'attacker has a capture-capital goal',
);
assert(
  war.goals.some((goal) => goal.type === 'defendTerritory' && goal.ownerId === defender.id),
  'defender has a defend-territory goal',
);
assert(war.participants.some((entry) => entry.side === 'defender'), 'defender participates');
assert(player.diplomacy.relations[defender.id]?.atWar, 'diplomacy agrees with the war');
log(`war: ${war.id} with ${war.goals.length} goals`);

// ── Coalition and fronts ────────────────────────────────────────────────────
const third = world
  .neighboursOf(defender.id)
  .map((id) => world.get(id))
  .find((entry) => entry && entry.id !== player.id && entry.id !== defender.id);
assert(third, 'a third country borders the defender');
session.simulation.warSystem.joinWar(world, war, third!, 'attacker', world.day);
assert(war.participants.length >= 3, 'war supports a multi-country coalition');
assert(
  third!.diplomacy.relations[defender.id]?.atWar,
  'joining a war sets the bilateral war relation',
);

days(session, 2, 4);
const fronts = Object.values(world.frontlines).filter((front) => front.warId === war.id);
assert(fronts.length > 0, 'fronts are created for an active war');
assert(fronts.every((front) => front.regionIds.every((id) => Boolean(REGION_GEO_BY_ID[id]))), 'front regions exist');
assert(war.fronts.length === fronts.length, 'war records its fronts');
assert(Number.isFinite(war.score) && war.score >= -100 && war.score <= 100, 'war score is normalised');
assert(Number.isFinite(war.exhaustion.attacker), 'war exhaustion is finite');
log(`fronts: ${fronts.length} front(s), ${fronts.reduce((sum, front) => sum + front.regionIds.length, 0)} regions`);

const front = fronts[0];
assert(front.attackerSupply >= 0 && front.attackerSupply <= 1, 'front supply is normalised');
assert(front.pressure >= 0 && front.pressure <= 1, 'front pressure is normalised');
const objective = front.objectiveRegionId ? findRegionState(world, front.objectiveRegionId) : undefined;
assert(objective, 'front has a resolvable objective');

// ── Region-level occupation (OWNER ≠ CONTROLLER) ─────────────────────────────
const victim = defender.regions.find((region) => region.id !== defender.capitalRegionId);
assert(victim, 'defender has a non-capital region');
const ownerBefore = victim!.countryId;
assert(session.simulation.warfareSystem.captureByPresence(world, player, victim!.id, world.day), 'region can be captured by presence');
assert(victim!.controlStatus === 'recentlyCaptured', 'capture marks the region recently captured');
assert(victim!.countryId === ownerBefore, 'capture does not change sovereignty');
assert(regionControllerId(victim!) === player.id, 'capture changes the controller');
days(session, 5, 6);
assert(
  victim!.countryId === ownerBefore,
  'daily consolidation preserves the sovereign owner',
);
assert(
  victim!.controlStatus === 'occupied' || victim!.controlStatus === 'contested' || victim!.controlStatus === 'recentlyCaptured',
  'daily consolidation keeps a valid control status',
);
assert(war.economicDamage > 0, 'occupied industry registers as war economic damage');
log(`region control: ${victim!.id} owned by ${victim!.countryId}, controlled by ${regionControllerId(victim!)}`);

// A cut-off army on distant foreign soil is encircled and its supply drops.
const stagingArmy = player.military.armies[0];
const originalRegion = stagingArmy.regionId;
const originalLocation = stagingArmy.locationId;
const farCountry = world.get('FRA') ?? [...world.countries.values()].find((country) => country.id !== player.id)!;
stagingArmy.regionId = farCountry.regions[0].id;
stagingArmy.locationId = farCountry.id;
assert(isArmyIsolated(world, player, stagingArmy.regionId), 'an army without a friendly corridor is isolated');
const cutOffSupply = computeSupply(world, player, stagingArmy);
assert(cutOffSupply.reason === 'encircled', 'isolation is reported in supply state');
assert(cutOffSupply.supply < 0.6, 'isolation reduces combat supply');
stagingArmy.regionId = originalRegion;
stagingArmy.locationId = originalLocation;
log(`supply isolation: reason ${cutOffSupply.reason}, supply ${cutOffSupply.supply.toFixed(2)}`);

// ── Army groups, postures and operations ────────────────────────────────────
const army = player.military.armies[0];
assert(session.simulation.setArmyPosture(player.id, army.id, 'attack'), 'posture can be assigned');
assert(army.posture === 'attack', 'posture is stored on the army');
const group = session.simulation.createArmyGroup(
  player.id,
  'Northern Front',
  player.military.armies.slice(0, 2).map((entry) => entry.id),
  front.objectiveRegionId,
);
assert(group && group.memberArmyIds.length >= 1, 'army group can be formed');
assert(group!.primaryObjectiveRegionId === front.objectiveRegionId, 'group keeps its objective');
assert(session.simulation.assignArmyToFrontline(player.id, army.id, front.id, front.objectiveRegionId!), 'army can join a frontline');
const operation = session.simulation.createOperation(
  player.id,
  'majorOffensive',
  [front.objectiveRegionId!],
  [army.id],
  war.id,
);
assert(operation && operation.status === 'active', 'operation can be created');
days(session, 7, 10);
assert(
  operation!.status === 'active' || operation!.status === 'completed' || operation!.status === 'failed',
  'operation reaches a valid state',
);
assert(group!.memberArmyIds.every((id) => player.military.armies.some((entry) => entry.id === id)), 'group members stay valid');
log(`army group: ${group!.name} with ${group!.memberArmyIds.length} armies, operation ${operation!.status}`);

// ── Air operations and air defence ──────────────────────────────────────────
player.military.armies[0].composition.air_fighter = 24;
player.military.armies[0].composition.air_interceptor = 8;
player.military.armies[0].composition.ad_short = 12;
syncMilitaryTotals(player);
player.economy.resources.oil = Math.max(player.economy.resources.oil, 100);
player.economy.resources.electronics = Math.max(player.economy.resources.electronics, 100);
const airTarget = defender.regions[0];
assert(session.simulation.launchAirMission(player.id, 'groundSupport', airTarget.id), 'ground-support mission launches');
assert(player.warfare.air.missions.length === 1, 'mission is stored');
days(session, 11, 14);
assert(player.warfare.air.missions.length === 0, 'completed missions leave the queue');
assert(Number.isFinite(player.warfare.air.superiority), 'air superiority stays finite');
assert(
  player.regions.every((region) => Number.isFinite(region.airDefense) && region.airDefense >= 0),
  'air-defence coverage is computed for every region',
);
log(`air: superiority ${(player.warfare.air.superiority * 100).toFixed(0)}%, coverage ${(player.warfare.air.coverage * 100).toFixed(0)}%`);

// ── Naval task forces and blockade ──────────────────────────────────────────
// A dedicated coastal theatre keeps the naval test independent of KWT's
// landlocked first neighbour.
const navalSession = GameSession.create({ countryId: 'IRN', locale: 'en', difficulty: 'standard' });
const navalPlayer = navalSession.world.player!;
const coastalDefender = navalSession.world
  .neighboursOf('IRN')
  .map((id) => navalSession.world.get(id))
  .find((country) =>
    country && GEO_PORTS.some((port) => country.regions.some((region) => region.id === port.regionId)),
  );
assert(coastalDefender, 'a coastal neighbour exists for the naval theatre');
navalPlayer.military.armies[0].composition.nav_frigate = 30;
navalPlayer.military.armies[0].composition.nav_destroyer = 8;
syncMilitaryTotals(navalPlayer);
assert(navalSession.declareWar(coastalDefender!.id), 'naval war can start');
days(navalSession, 2, 4);
assert(navalPlayer.warfare.naval.taskForces.length > 0, 'naval power forms a task force');
assert(navalSession.simulation.orderBlockade(navalPlayer.id, coastalDefender!.id), 'blockade can be ordered against a port');
const blockade = navalSession.world.blockades.find(
  (entry) => entry.blockaderId === navalPlayer.id && entry.targetId === coastalDefender!.id && entry.active,
);
assert(blockade, 'blockade is registered');
assert(blockade!.effectiveness >= 0 && blockade!.effectiveness <= 1, 'blockade effectiveness is normalised');
days(navalSession, 5, 7);
assert(coastalDefender!.warfare.naval.blockadeEffect >= 0, 'blockaded country records the effect');
log(`naval: ${navalPlayer.warfare.naval.taskForces.length} task force(s), blockade ${(blockade!.effectiveness * 100).toFixed(0)}%`);
assert(navalSession.simulation.liftBlockade(navalPlayer.id, coastalDefender!.id), 'blockade can be lifted');
navalSession.dispose();

// ── Missiles: validation, range, cost and cooldown ──────────────────────────
player.warfare.missiles.stockpile.tactical = 3;
player.warfare.missiles.cooldownUntilDay = 0;
const neutral = [...world.countries.values()].find(
  (country) => country.id !== player.id && !player.diplomacy.relations[country.id]?.atWar,
)!;
const neutralResult = session.simulation.launchMissile(
  player.id,
  neutral.regions[0].id,
  'tactical',
);
assert(!neutralResult.ok && neutralResult.reason === 'not-at-war', 'missile rejects a neutral target');
activeWar();
const missileTarget = defender.regions.find((region) => region.id !== defender.capitalRegionId)!;
const oilBefore = player.economy.resources.oil;
const electronicsBefore = player.economy.resources.electronics;
const strike = session.simulation.launchMissile(player.id, missileTarget.id, 'tactical');
assert(strike.ok, `tactical missile strikes (${strike.reason})`);
assert(player.economy.resources.oil === oilBefore - 6, 'strike consumes oil');
assert(player.economy.resources.electronics === electronicsBefore - 8, 'strike consumes electronics');
assert(player.warfare.missiles.stockpile.tactical === 2, 'strike consumes a missile');
const cooldown = session.simulation.launchMissile(player.id, missileTarget.id, 'tactical');
assert(!cooldown.ok && cooldown.reason === 'cooldown', 'cooldown blocks an immediate second strike');
log('missiles: neutral target, resource cost, stockpile and cooldown verified');

// ── Save v6 round trip before peace changes the map ─────────────────────────
assert(CURRENT_SAVE_VERSION === 6, 'save schema is version 6');
const payload = JSON.parse(
  JSON.stringify({ ...session.toSavePayload(), slot: '1', version: 6, updatedAt: Date.now() }),
) as SaveFile;
assert((payload.world.wars ?? []).length >= 1, 'save carries wars');
assert((payload.world.frontlines ?? []).length > 0, 'save carries fronts');
assert(Array.isArray(payload.world.blockades), 'save carries blockades');
assert(
  payload.world.countries.every(
    (country) => country.warfare && Array.isArray(country.warfare.groups) && Array.isArray(country.warfare.operations),
  ),
  'save carries groups, operations, air, naval and missile state',
);
assert(
  payload.world.countries.every((country) =>
    country.regions.every((region) => typeof region.controllerId !== 'undefined'),
  ),
  'save carries region controllers',
);
const loaded = GameSession.fromSave(payload, 'en');
const loadedWar = Object.values(loaded.world.wars)[0];
assert(loadedWar && loadedWar.participants.length >= 3, 'war and coalition round-trip');
assert(Object.keys(loaded.world.frontlines).length > 0, 'fronts round-trip');
assert(
  loaded.world.player!.military.armies.every((entry) => typeof entry.posture === 'string'),
  'army postures round-trip',
);
log('save v6: wars, fronts, controllers and command state round-trip');

// ── v5 → v6 migration ──────────────────────────────────────────────────────
const legacy = JSON.parse(JSON.stringify(payload)) as SaveFile & Record<string, unknown>;
legacy.version = 5;
delete (legacy.world as Record<string, unknown>).wars;
delete (legacy.world as Record<string, unknown>).frontlines;
delete (legacy.world as Record<string, unknown>).blockades;
delete (legacy.world as Record<string, unknown>).peaceOffers;
for (const country of legacy.world.countries as Array<Record<string, unknown>>) {
  delete country.warfare;
  const military = country.military as Record<string, unknown>;
  for (const entry of military.armies as Array<Record<string, unknown>>) {
    delete entry.posture;
    delete entry.readiness;
    delete entry.morale;
    delete entry.isolated;
    delete entry.encircledDays;
    delete entry.groupId;
    delete entry.frontlineId;
    delete entry.objectiveRegionId;
  }
  for (const region of country.regions as Array<Record<string, unknown>>) {
    delete region.controllerId;
    delete region.occupierId;
    delete region.controlStatus;
    delete region.occupationProgress;
    delete region.resistance;
    delete region.supplyModifier;
    delete region.frontlineId;
  }
}
const migrated = migrateSave(legacy as unknown as Record<string, unknown>);
assert(migrated.version === 6, 'v5 migrates to v6');
assert(Array.isArray((migrated.world as Record<string, unknown>).wars), 'v5 → v6 creates the war registry');
assert(
  (migrated.world.countries as Array<{ warfare?: unknown }>).every((country) => country.warfare),
  'v5 → v6 adds warfare state',
);
assert(
  (migrated.world.countries as Array<{ military: { armies: Array<{ posture?: string }> } }>).every(
    (country) => country.military.armies.every((entry) => typeof entry.posture === 'string'),
  ),
  'v5 → v6 adds army posture',
);
log('v5 → v6 migration adds war, command and regional-control state');

// ── Peace and annexation ────────────────────────────────────────────────────
const peaceWar = activeWar();
const claimantRegion = victim!;
if (regionControllerId(claimantRegion) !== player.id) {
  session.simulation.warfareSystem.captureByPresence(world, player, claimantRegion.id, world.day);
}
assert(claimantRegion.countryId === defender.id, 'claimant region still belongs to the defeated defender');
const cession: PeaceTerm = {
  type: 'cession',
  fromId: claimantRegion.countryId,
  toId: player.id,
  regionIds: [claimantRegion.id],
  amount: 0,
};
const invalidRegionTerm: PeaceTerm = { ...cession, regionIds: ['missing-region'] };
const invalidOffer: PeaceOffer = {
  id: 'invalid-offer',
  warId: peaceWar.id,
  proposerId: defender.id,
  recipientId: player.id,
  terms: [invalidRegionTerm],
  day: world.day,
  status: 'pending',
};
assert(!session.simulation.warSystem.validatePeaceOffer(world, invalidOffer).ok, 'peace treaty with an unknown region is rejected');
const offer: PeaceOffer = {
  id: 'cession-offer',
  warId: peaceWar.id,
  proposerId: defender.id,
  recipientId: player.id,
  terms: [cession],
  day: world.day,
  status: 'pending',
};
const validation = session.simulation.warSystem.validatePeaceOffer(world, offer);
assert(validation.ok, `controlled region can be ceded (${validation.reason})`);
world.peaceOffers.push(offer);
assert(session.simulation.acceptPeace(offer.id), 'peace treaty can be accepted');
assert(claimantRegion.countryId === player.id, 'cession transfers sovereignty');
assert(player.regions.some((region) => region.id === claimantRegion.id), 'transferred region joins the new owner');
assert(!defender.regions.some((region) => region.id === claimantRegion.id), 'former owner loses the region');
assert(war.status !== 'active', 'accepted treaty ends the war');
assert(player.diplomacy.relations[defender.id]?.atWar !== true, 'peace clears the war relation');
assert(Object.values(world.frontlines).every((front) => front.warId !== war.id), 'peace dissolves its fronts');
log('peace: cession validated, sovereignty transferred, war and fronts ended');

// ── AI personalities remain meaningfully different ──────────────────────────
const aiWorld = GameSession.create({ countryId: 'IRN', locale: 'en', difficulty: 'standard' }).world;
const aiCountry = [...aiWorld.countries.values()].find((country) => country.id !== player.id)!;
const focuses = new Set<string>();
const researchChoices = new Set<string>();
for (const id of Object.keys(PERSONALITIES)) {
  aiCountry.ai.personalityId = id as keyof typeof PERSONALITIES;
  const context: AIContext = {
    world: aiWorld,
    country: aiCountry,
    personality: PERSONALITIES[id as keyof typeof PERSONALITIES],
    state: aiCountry.ai,
    day: 30,
  };
  const decision = decide(context, DEFAULT_EVALUATORS);
  focuses.add(decision.focus);
  if (decision.researchId) researchChoices.add(decision.researchId);
}
assert(focuses.size >= 2, `personalities select different strategic focuses (${[...focuses].join(', ')})`);

assert(Number.isFinite(aiCountry.military.strengthIndex), 'AI country remains valid');
log(`AI personalities: ${focuses.size} focus types, ${researchChoices.size} research choices`);

// ── Full-year deterministic campaign ────────────────────────────────────────
const campaign = GameSession.create({ countryId: 'KWT', locale: 'en', difficulty: 'standard' });
const campaignEnemy = campaign.world.neighboursOf('KWT')[0];
assert(campaign.declareWar(campaignEnemy), 'campaign war starts');
const sizeAtStart = JSON.stringify([...campaign.world.countries.values()]).length;
let invalidControllers = 0;
let invalidFronts = 0;
let invalidParticipants = 0;
let invalidRegions = 0;
let nonFinite = 0;
let battles = 0;
campaign.simulation.events.on((event) => {
  if (event.type === 'battleResolved') battles += 1;
});
for (let day = 2; day <= 365; day += 1) {
  campaign.simulation.tickDay(day);
  for (const country of campaign.world.countries.values()) {
    if (!Number.isFinite(country.economy.resources.money)) nonFinite += 1;
    if (!Number.isFinite(country.military.readiness)) nonFinite += 1;
    if (!country.warfare || !Array.isArray(country.warfare.operations)) nonFinite += 1;
    for (const army of country.military.armies) {
      if (!army.regionId || !campaign.world.get(army.locationId)) invalidRegions += 1;
      if (!Number.isFinite(army.readiness) || army.readiness < 0 || army.readiness > 1) nonFinite += 1;
      if (army.groupId && !country.warfare.groups.some((group) => group.id === army.groupId)) {
        invalidRegions += 1;
      }
    }
    for (const region of country.regions) {
      if (!REGION_GEO_BY_ID[region.id]) invalidRegions += 1;
      if (region.controllerId) {
        const controller = campaign.world.get(region.controllerId);
        if (!controller) {
          invalidControllers += 1;
        }
      }
    }
  }
  for (const front of Object.values(campaign.world.frontlines)) {
    if (
      !campaign.world.get(front.attackerId) ||
      !campaign.world.get(front.defenderId) ||
      front.regionIds.some((id) => !REGION_GEO_BY_ID[id])
    ) {
      invalidFronts += 1;
    }
  }
  for (const warEntry of Object.values(campaign.world.wars)) {
    if (
      warEntry.participants.some(
        (participant) => !campaign.world.get(participant.countryId),
      )
    ) {
      invalidParticipants += 1;
    }
  }
}
assert(invalidControllers === 0, '365-day campaign has no invalid region controllers');
assert(invalidFronts === 0, '365-day campaign has no orphan fronts');
assert(invalidParticipants === 0, '365-day campaign has no invalid war participants');
assert(invalidRegions === 0, '365-day campaign keeps armies and regions valid');
assert(nonFinite === 0, '365-day campaign stays finite and normalised');
assert(
  Object.values(campaign.world.frontlines).every((front) => front.status !== 'active' || front.regionIds.length > 0),
  'active fronts keep a region chain',
);
const sizeAtEnd = JSON.stringify([...campaign.world.countries.values()]).length;
assert(sizeAtEnd < sizeAtStart * 4 + 400_000, 'campaign memory stays bounded');
log(
  `365-day campaign: ${battles} battle(s), ${Object.values(campaign.world.wars).length} war record(s), ${Object.keys(campaign.world.frontlines).length} front(s), bytes ${sizeAtStart} → ${sizeAtEnd}`,
);

session.dispose();
campaign.dispose();
console.log('Advanced warfare smoke test passed.');
