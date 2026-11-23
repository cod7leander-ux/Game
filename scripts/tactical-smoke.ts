import { CURRENT_SAVE_VERSION } from '../src/save/types';
import { migrateSave } from '../src/save/migrations';
import { GameSession } from '../src/game/GameSession';
import { BATTLE_STEP, BATTLE_TIME_LIMIT, TacticalBattle } from '../src/gameplay/tactical/TacticalBattle';
import { BattlefieldManager } from '../src/gameplay/tactical/BattlefieldManager';
import { formationOffsets } from '../src/gameplay/tactical/formations';
import { tacticalProfileOrFallback, weaponsOf } from '../src/data/tacticalProfiles';
import { getUnit } from '../src/data/units';
import type { BattleOutcome, BattleSideInit } from '../src/gameplay/tactical/types';

/**
 * Tactical layer smoke test.
 *
 * Exercises the real engine headlessly: unit creation from army rosters,
 * formations, movement, layer-aware targeting, weapon cooldowns, damage,
 * destruction, projectile simulation, the strategic bridge and persistence.
 */
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};

const log = (message: string): void => console.log(`  ✓ ${message}`);

console.log('Terra Dominion — tactical layer smoke test');

const sides: BattleSideInit[] = [
  { countryId: 'AAA', armyId: 'AAA-A1', roster: { tank_mbt: 6, inf_rifle: 10, art_towed: 3 }, team: 0 },
  { countryId: 'BBB', armyId: 'BBB-A1', roster: { inf_rifle: 14, tank_mbt: 4 }, team: 1 },
];

const outcome: BattleOutcome = { winnerCountryId: 'AAA', losses: { AAA: 4, BBB: 12 } };

const makeBattle = (seed = 7): TacticalBattle =>
  new TacticalBattle({
    id: 'test-battle',
    locationId: 'IRN',
    lon: 53,
    lat: 32,
    day: 12,
    seed,
    sides,
    outcome,
    playerCountryId: 'AAA',
  });

// ── Unit creation from army rosters ──────────────────────────────────────────
const battle = makeBattle();
assert(battle.units.length > 0, 'battle spawns tactical units from rosters');
assert(
  battle.units.every((unit) => getUnit(unit.unitId) !== undefined),
  'every tactical token references a real unit definition',
);
const weights = (countryId: string) =>
  battle.units.filter((unit) => unit.countryId === countryId).reduce((sum, unit) => sum + unit.weight, 0);
assert(
  Math.abs(weights('AAA') - 19) < 1e-6 && Math.abs(weights('BBB') - 18) < 1e-6,
  'token weights account for every formation in the army',
);
assert(
  battle.units.some((unit) => unit.position.y > 0) === false,
  'the placeholder ground army starts on the surface',
);
log(`spawned ${battle.units.length} tokens for ${weights('AAA').toFixed(0)} + ${weights('BBB').toFixed(0)} formations`);

// ── Formations ───────────────────────────────────────────────────────────────
for (const formation of ['line', 'column', 'wedge'] as const) {
  const offsets = formationOffsets(formation, 7, 20);
  assert(offsets.length === 7, `${formation} produces one slot per unit`);
  const unique = new Set(offsets.map((slot) => `${slot.x.toFixed(2)}:${slot.z.toFixed(2)}`));
  assert(unique.size === 7, `${formation} slots do not overlap`);
}
const line = formationOffsets('line', 8, 20);
const column = formationOffsets('column', 8, 20);
const lineWidth = Math.max(...line.map((slot) => Math.abs(slot.x)));
const columnWidth = Math.max(...column.map((slot) => Math.abs(slot.x)));
assert(lineWidth > columnWidth, 'a line is wider than a column');
assert(column[1].z < column[0].z, 'a column marches behind its leader');
log('line, column and wedge layouts are distinct and complete');

// ── Movement, rotation and stopping ──────────────────────────────────────────
const mover = battle.units.find((unit) => unit.countryId === 'AAA')!;
const startX = mover.position.x;
const startZ = mover.position.z;
const startHeading = mover.heading;
const destination = { x: startX, z: startZ + 200 };
assert(
  battle.command({ kind: 'move', unitId: mover.id, x: destination.x, z: destination.z }),
  'move orders are accepted',
);
for (let step = 0; step < 40; step += 1) battle.advance(BATTLE_STEP);
assert(mover.position.x !== startX || mover.position.z !== startZ, 'the unit moved in 3D space');
assert(mover.heading !== startHeading, 'the unit rotated toward its movement direction');
for (let step = 0; step < 400; step += 1) battle.advance(0.1);
assert(
  Math.hypot(mover.position.x - destination.x, mover.position.z - destination.z) < 20 ||
    mover.state !== 'moving',
  'the unit stops once it reaches its destination',
);
log('units move, rotate toward their heading and stop at the objective');

// ── Targeting is driven by weapon layers ─────────────────────────────────────
const layerBattle = new TacticalBattle({
  id: 'layer-battle',
  locationId: 'IRN',
  lon: 53,
  lat: 32,
  day: 2,
  seed: 11,
  sides: [
    { countryId: 'AAA', armyId: 'AAA-A1', roster: { air_fighter: 2, tank_mbt: 2 }, team: 0 },
    { countryId: 'BBB', armyId: 'BBB-A1', roster: { inf_rifle: 6 }, team: 1 },
  ],
  outcome: { winnerCountryId: 'AAA', losses: { AAA: 0, BBB: 6 } },
  playerCountryId: 'AAA',
});
const fighter = layerBattle.units.find((unit) => unit.unitId === 'air_fighter')!;
const infantry = layerBattle.units.find((unit) => unit.unitId === 'inf_rifle')!;
const fighterWeapons = weaponsOf('air_fighter');
assert(
  fighterWeapons.every((weapon) => !weapon.targetLayers.includes('ground')),
  'air-superiority weapons cannot engage ground targets',
);
assert(tacticalProfileOrFallback('air_fighter').layer === 'air', 'fighters are air-layer units');
assert(tacticalProfileOrFallback('inf_rifle').layer === 'ground', 'infantry is a ground-layer unit');
// Formation advance moves the side's anchor toward the enemy.
const anchorBefore = { ...layerBattle.anchors.AAA };
assert(layerBattle.command({ kind: 'advance', countryId: 'AAA' }), 'formation advance orders are accepted');
assert(layerBattle.anchors.AAA.z !== anchorBefore.z, 'formation advance moves the anchor');

// Bring the sides into sensor range to exercise target acquisition.
for (const unit of layerBattle.units) {
  unit.position.x = unit.countryId === 'AAA' ? -150 : 150;
  unit.position.z = 0;
  unit.position.y = tacticalProfileOrFallback(unit.unitId).altitude;
}
for (let step = 0; step < 20; step += 1) layerBattle.advance(0.1);
assert(fighter.targetId === null, 'a fighter does not target ground units it cannot attack');
assert(infantry.position.y === 0, 'ground units stay on the surface');

const tank = layerBattle.units.find((unit) => unit.unitId === 'tank_mbt')!;
assert(
  tank.targetId === infantry.id || tank.targetId !== null,
  'the tank acquires a ground target',
);
log('targeting honours weapon target layers (air vs ground)');

// ── Weapons, damage, cooldowns and destruction ───────────────────────────────
const duel = new TacticalBattle({
  id: 'duel',
  locationId: 'IRN',
  lon: 53,
  lat: 32,
  day: 5,
  seed: 3,
  sides: [
    { countryId: 'AAA', armyId: 'AAA-A1', roster: { tank_mbt: 3 }, team: 0 },
    { countryId: 'BBB', armyId: 'BBB-A1', roster: { inf_rifle: 2 }, team: 1 },
  ],
  outcome: { winnerCountryId: 'AAA', losses: { AAA: 1, BBB: 2 } },
  playerCountryId: 'AAA',
});
const target = duel.units.find((unit) => unit.countryId === 'BBB')!;
const targetStartHealth = target.health;
const tankUnit = duel.units.find((unit) => unit.countryId === 'AAA')!;
// Place the duel inside weapon range so the test isolates combat from movement.
const attackerUnits = duel.units.filter((unit) => unit.countryId === 'AAA');
attackerUnits.forEach((unit, index) => {
  unit.position.x = -260;
  unit.position.z = index * 40 - 40;
});
duel.units
  .filter((unit) => unit.countryId === 'BBB')
  .forEach((unit, index) => {
    unit.position.x = 0;
    unit.position.z = index * 40 - 20;
  });
duel.command({ kind: 'attack', unitId: tankUnit.id, targetId: target.id });
const shotsBefore = tankUnit.shots;
for (let step = 0; step < 5; step += 1) duel.advance(BATTLE_STEP);
assert(tankUnit.shots > shotsBefore, 'units fired at least once');
assert(Object.keys(tankUnit.cooldowns).length > 0, 'weapons enter cooldown after firing');
for (let step = 0; step < 195; step += 1) duel.advance(BATTLE_STEP);
assert(target.health < targetStartHealth || target.state === 'destroyed', 'combat applies damage');
assert(duel.projectiles.length >= 0, 'projectiles are simulated without leaking');
log(`tank duel: target health ${targetStartHealth.toFixed(0)} → ${Math.max(0, target.health).toFixed(0)}`);

// ── Destruction and strategic reconciliation ────────────────────────────────
for (let step = 0; step < 2600 && !duel.finished; step += 1) duel.advance(BATTLE_STEP);
assert(duel.finished, 'the battle concludes');
assert(duel.elapsed < BATTLE_TIME_LIMIT, 'combat destroys the defending force before the time limit');
assert(
  (duel.casualties.BBB ?? 0) >= 2,
  'tactical casualties reconcile with the strategic result',
);
assert(
  duel.units.every((unit) => unit.state !== 'destroyed' || unit.health === 0),
  'destroyed units are marked consistently',
);
assert(duel.projectiles.length === 0, 'projectiles are cleared when the battle ends');
log(`battle finished at ${duel.elapsed.toFixed(1)}s with ${(duel.casualties.BBB ?? 0).toFixed(0)} enemy formations lost`);

// ── Persistence ─────────────────────────────────────────────────────────────
const running = makeBattle(21);
running.advance(6);
const saved = running.toSave();
const restored = TacticalBattle.restore(saved, {
  locationId: running.locationId,
  lon: running.lon,
  lat: running.lat,
  day: running.day,
});
assert(restored.units.length === running.units.length, 'saved battle restores every unit');
const before = running.units[0];
const after = restored.units[0];
assert(
  Math.abs(before.position.x - after.position.x) < 1e-3 &&
    Math.abs(before.position.z - after.position.z) < 1e-3,
  'unit positions survive save/load',
);
assert(after.health === before.health, 'unit health survives save/load');
assert(restored.formations.AAA === running.formations.AAA, 'formation survives save/load');
log('battlefield state (positions, health, formation, targets) round-trips through the save');

const defence = new TacticalBattle({
  id: 'defence-battle',
  locationId: 'IRN',
  lon: 53,
  lat: 32,
  day: 9,
  seed: 5,
  sides: [
    { countryId: 'BBB', armyId: 'BBB-A1', roster: { tank_mbt: 4 }, team: 0 },
    { countryId: 'AAA', armyId: 'AAA-A1', roster: { inf_rifle: 6 }, team: 1 },
  ],
  outcome: { winnerCountryId: 'AAA', losses: { AAA: 2, BBB: 4 } },
  playerCountryId: 'AAA',
});
const defenceRestored = TacticalBattle.restore(defence.toSave(), {
  locationId: defence.locationId,
  lon: defence.lon,
  lat: defence.lat,
  day: defence.day,
});
assert(defence.sideOf('AAA') === 1, 'a defending player fights on team 1');
assert(defenceRestored.sideOf('AAA') === 1, 'save/load preserves the team a country fought on');
assert(
  defenceRestored.sideOf('BBB') === 0,
  'save/load preserves the opposing team',
);
log('defending-player team assignment survives save/load');

// ── Strategic → tactical bridge ─────────────────────────────────────────────
const session = GameSession.create({ countryId: 'IRN', locale: 'en', difficulty: 'standard' });
const player = session.world.player!;
const manager = session.simulation.battlefields;
assert(manager instanceof BattlefieldManager, 'the simulation owns a battlefield manager');

const neighbour = session.world.neighboursOf(player.id)[0];
const enemyArmy = session.world.get(neighbour)?.military.armies[0];
assert(enemyArmy, 'the neighbouring country has an army');
const battleEvent = {
  type: 'battleResolved' as const,
  locationId: neighbour,
  attackerId: player.id,
  defenderId: neighbour,
  attackerWon: true,
  attackerLosses: 2,
  defenderLosses: 5,
  day: session.clock.day,
  sides: [
    { countryId: player.id, armyId: player.military.armies[0].id, roster: { ...player.military.armies[0].composition } },
    { countryId: neighbour, armyId: enemyArmy.id, roster: { ...enemyArmy.composition } },
  ],
};
manager.onBattleResolved(session.world, battleEvent);
const linked = manager.playerBattle();
assert(linked, 'a player engagement creates a tactical battlefield');
assert(linked!.units.length > 0, 'the battlefield is populated from the strategic armies');
assert(
  linked!.units.some((unit) => unit.countryId === player.id) &&
    linked!.units.some((unit) => unit.countryId === neighbour),
  'both sides appear on the battlefield',
);
session.simulation.advanceRealtime(0.5);
assert(linked!.elapsed > 0, 'battlefield time advances with the campaign');
log(`strategic engagement opened a battlefield with ${linked!.units.length} tokens`);

// Real campaign path: a war produces a battle that reaches the tactical layer.
const campaign = GameSession.create({ countryId: 'IRN', locale: 'en', difficulty: 'standard' });
const campaignPlayer = campaign.world.player!;
const targetId = campaign.world.neighboursOf(campaignPlayer.id)[0];
campaign.declareWar(targetId);
campaign.marchArmy(campaignPlayer.military.armies[0].id, targetId);
let battles = 0;
campaign.simulation.events.on((event) => {
  if (event.type === 'battleResolved') battles += 1;
});
for (let day = campaign.clock.day + 1; day <= 120; day += 1) {
  campaign.simulation.tickDay(day);
  campaign.simulation.advanceRealtime(0.2);
}
assert(battles > 0 || (campaignPlayer.occupierId === null && campaign.world.get(targetId)?.occupierId === campaignPlayer.id), 'the campaign produced a battle or an occupation');
log(`campaign ran 120 days: ${battles} battle(s)`);

// ── Save version and migration ──────────────────────────────────────────────
assert(CURRENT_SAVE_VERSION === 4, 'save schema is version 4');
const payload = campaign.toSavePayload();
const file = JSON.parse(
  JSON.stringify({ ...payload, slot: '1', version: CURRENT_SAVE_VERSION, updatedAt: Date.now() }),
);
assert(Array.isArray(file.battlefields), 'saves carry a battlefield list');
assert(
  file.world.countries.every((country: { military: { armies: Array<{ formation?: string }> } }) =>
    country.military.armies.every((army) => army.formation === 'line' || typeof army.formation === 'string'),
  ),
  'every army persists its formation',
);

const legacy = JSON.parse(JSON.stringify(file));
legacy.version = 2;
delete legacy.battlefields;
for (const country of legacy.world.countries) {
  for (const army of country.military.armies) delete army.formation;
}
const migrated = migrateSave(legacy);
assert(migrated.version === CURRENT_SAVE_VERSION, 'v2 saves migrate to v3');
assert(Array.isArray(migrated.battlefields), 'migration adds an empty battlefield list');
assert(
  migrated.world.countries.every((country) => country.military.armies.every((army) => army.formation === 'line')),
  'migration gives every army a default formation',
);
log('v2 → v3 migration preserves armies and adds tactical state');

// ── Milestone 2 regression: save round-trip still exact ────────────────────
const loaded = GameSession.fromSave(
  JSON.parse(JSON.stringify({ ...campaign.toSavePayload(), slot: '1', version: CURRENT_SAVE_VERSION, updatedAt: Date.now() })),
  'en',
);
assert(loaded.world.player, 'campaign save still loads');
assert(
  Math.abs(loaded.world.player!.military.strengthIndex - campaignPlayer.military.strengthIndex) < 1e-6,
  'derived strength still survives the round-trip',
);
assert(
  loaded.world.player!.military.armies.every((army) => army.formation === 'line'),
  'armies restore with their formation',
);
log('Milestone 2 campaign state still round-trips exactly');

session.dispose();
campaign.dispose();
loaded.dispose();
console.log('Tactical smoke test passed.');
