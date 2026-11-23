import { CURRENT_SAVE_VERSION, type SaveFile } from '../src/save/types';
import { migrateSave } from '../src/save/migrations';
import { GameSession } from '../src/game/GameSession';

/**
 * Headless campaign smoke test.
 *
 * Runs the real simulation without a renderer or a browser: creates a
 * campaign, declares war, marches an army, advances two months of world
 * history, then verifies the save round-trip and the v1 → v2 migration.
 * Any regression in the day tick, armies or persistence fails this script,
 * which is what CI runs.
 */
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};

const log = (message: string): void => console.log(`  ✓ ${message}`);

console.log('Terra Dominion — headless simulation smoke test');

// ── Campaign, armies and war ─────────────────────────────────────────────────
const session = GameSession.create({ countryId: 'IRN', locale: 'en', difficulty: 'standard' });
const player = session.world.player;
assert(player, 'campaign has a player country');
assert(player.military.armies.length > 0, 'player starts with a field army');
log(`campaign created: ${player.military.armies.length} army, day ${session.clock.day}`);

const army = player.military.armies[0];
const neighbours = session.world.neighboursOf(player.id);
assert(neighbours.length > 0, 'player has neighbours');
const targetId = neighbours[0];
assert(session.declareWar(targetId), 'war can be declared on a neighbour');
log(`war declared on ${targetId}`);

const march = session.marchArmy(army.id, targetId);
assert(march.ok, `army can march to an adjacent country (reason: ${march.ok ? '' : march.reason})`);
log(`army ordered to march: ${march.days} days`);

let battles = 0;
let occupations = 0;
session.simulation.events.on((event) => {
  if (event.type === 'battleResolved') battles += 1;
  if (event.type === 'territoryOccupied') occupations += 1;
});

for (let day = session.clock.day + 1; day <= 90; day += 1) {
  session.simulation.tickDay(day);
}

assert(Number.isFinite(player.economy.resources.money), 'treasury stays finite');
assert(Number.isFinite(player.military.strengthIndex), 'strength stays finite');
assert(
  Object.values(player.military.formations).every((count) => Number.isFinite(count) && count >= 0),
  'formations stay non-negative',
);
assert(battles > 0 || occupations > 0, 'the war produced a battle or an occupation');
log(`90 days simulated: ${battles} battle(s), ${occupations} occupation(s)`);

// ── Save round-trip ──────────────────────────────────────────────────────────
const payload = session.toSavePayload();
const file = JSON.parse(
  JSON.stringify({
    ...payload,
    slot: '1',
    version: CURRENT_SAVE_VERSION,
    updatedAt: Date.now(),
  }),
) as SaveFile;

const loaded = GameSession.fromSave(file, 'en');
assert(loaded.world.player, 'loaded save has a player country');
assert(
  loaded.world.player.military.armies.length > 0,
  'loaded save restores field armies',
);
const restoredStrength = loaded.world.player.military.strengthIndex;
const liveStrength = player.military.strengthIndex;
assert(
  Math.abs(restoredStrength - liveStrength) < 1e-6,
  `derived strength survives the round-trip (${restoredStrength} vs ${liveStrength})`,
);
log(
  `save round-trip restored ${loaded.world.player.military.armies.length} army/armies at strength ${Math.round(restoredStrength)}`,
);

// ── Schema migration from v1 ─────────────────────────────────────────────────
const legacy = JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
legacy.version = 1;
const legacyWorld = legacy.world as { countries: Array<Record<string, unknown>> };
for (const country of legacyWorld.countries) {
  delete country.occupierId;
  const military = country.military as Record<string, unknown>;
  delete military.armies;
}
const migrated = migrateSave(legacy);
assert(migrated.version === CURRENT_SAVE_VERSION, 'v1 save migrates to current version');
assert(migrated.world.countries.length === file.world.countries.length, 'all countries migrate');
assert(
  migrated.world.countries.every((country) => country.military.armies.length > 0),
  'every migrated country receives an army',
);
assert(
  migrated.world.countries.every((country) => country.occupierId === null),
  'migrated countries have no occupier',
);
log('v1 → v2 migration produced field armies for every country');

session.dispose();
console.log('Smoke test passed.');
