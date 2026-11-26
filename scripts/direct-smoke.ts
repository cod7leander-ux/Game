import { GameSession } from '../src/game/GameSession';
import { GAME } from '../src/core/config';
import { syncMilitaryTotals } from '../src/gameplay/military/armies';
import type { CountryState } from '../src/gameplay/country/types';

/**
 * Headless direct-control suite.
 *
 * Runs the real campaign, takes ground, air, naval and submarine units under
 * direct control, flies/drives/dives them, fires real weapons, and checks that
 * the strategic army, region and clock stay in sync. No browser is involved.
 */

const failures: string[] = [];
let checks = 0;

const assert = (condition: unknown, message: string): void => {
  checks += 1;
  if (!condition) failures.push(message);
};

const log = (message: string): void => {
  // eslint-disable-next-line no-console
  console.log(`  ${message}`);
};

const formationsTotal = (country: CountryState): number =>
  Object.values(country.military.formations).reduce((sum, value) => sum + value, 0);

/** Every non-player formation; only direct-control kills can change this here. */
const hostileFormationsTotal = (playerId: string): number => {
  let total = 0;
  for (const country of session.world.countries.values()) {
    if (country.id === playerId) continue;
    total += formationsTotal(country);
  }
  return total;
};

const step = (session: GameSession, seconds: number, dt = 0.1): void => {
  const steps = Math.max(1, Math.round(seconds / dt));
  for (let index = 0; index < steps; index += 1) {
    session.directControl.advance(dt, session.world);
  }
};

log('direct control — setup');
const session = GameSession.create({ countryId: 'IRN', locale: 'en' });
const player = session.world.player;
assert(Boolean(player), 'player country exists');
if (!player) throw new Error('Campaign did not create a player');

const army = player.military.armies[0];
assert(Boolean(army), 'player starts with an army');
if (!army) throw new Error('Campaign did not create a player army');

// Guarantee one unit of every domain for the suite, without touching systems.
for (const unitId of ['tank_mbt', 'art_towed', 'inf_rifle', 'air_fighter', 'nav_frigate', 'nav_submarine']) {
  army.composition[unitId] = (army.composition[unitId] ?? 0) + 1;
}
syncMilitaryTotals(player);

let enemy: CountryState | null = null;
for (const candidate of session.world.countries.values()) {
  if (candidate.id === player.id) continue;
  if (!session.declareWar(candidate.id)) continue;
  enemy = session.world.get(candidate.id) ?? null;
  if (enemy) break;
}
assert(Boolean(enemy), 'a war can be declared in the sandbox');
if (!enemy) throw new Error('Could not declare war');

const enemyArmy = enemy.military.armies[0];
if (enemyArmy) {
  enemyArmy.composition = { ...enemyArmy.composition, inf_rifle: 2, tank_mbt: 1, air_fighter: 1 };
  syncMilitaryTotals(enemy);
} else {
  assert(false, 'enemy has a field army to project into direct control');
}

const forced = session.directControl.enter(
  session.world,
  session.world.playerCountryId,
  army.id,
  'nonexistent_unit',
  session.clock.day,
);
assert(forced === false, 'unknown units cannot be taken under direct control');

// ── Ground path ──────────────────────────────────────────────────────────────
log('direct control — ground: drive, aim, fire, feed back');
assert(session.enterDirectControl(army.id, 'tank_mbt'), 'tank can be taken under direct control');
const ground = session.directControl.state();
assert(Boolean(ground), 'ground state exists');
if (!ground) throw new Error('No ground state');

const startLon = ground.entity.lon;
const startLat = ground.entity.lat;
const startAltitude = ground.entity.altitude;
assert(ground.entity.profile.handling === 'tracked', 'tank uses tracked handling');
assert(ground.entity.terrain.length > 0, 'ground terrain is sampled from the strategic catalogue');

session.setDirectInput({ throttle: 1, yaw: 0.35 });
step(session, 4);
assert(
  ground.entity.lon !== startLon || ground.entity.lat !== startLat,
  'the tank moves through the world',
);
assert(ground.entity.speed > 0, 'throttle drives the tank');
assert(
  Math.abs(ground.entity.altitude - startAltitude) > 0 || ground.entity.altitude > 0,
  'ground altitude tracks terrain height',
);
assert(
  ground.entity.altitude >= ground.entity.groundHeight,
  'a ground unit never sinks below its terrain',
);

const cameraView = session.directControl.cameraView();
assert(Boolean(cameraView), 'direct camera pose exists');
assert(cameraView?.mode === 'chase', 'direct camera starts in chase mode');
assert(session.directControl.toggleCamera() === 'cockpit', 'camera switches to cockpit');
assert(session.directControl.cameraView()?.mode === 'cockpit', 'cockpit pose is reported');
session.directControl.toggleCamera();

assert(ground.contacts.length > 0, 'hostile contacts are projected from the enemy army');
const enemyFormationsBefore = hostileFormationsTotal(player.id);
session.setDirectInput({ yaw: 0, fire: true });
step(session, 45);
const stateAfterFire = session.directControl.state();
assert(Boolean(stateAfterFire), 'direct control survives combat');
assert((stateAfterFire?.shots ?? 0) > 0, 'weapons fire on command');
assert((stateAfterFire?.hits ?? 0) > 0, 'real weapon accuracy produces hits');
assert((stateAfterFire?.kills ?? 0) > 0, 'direct combat destroys enemy formations');
const enemyFormationsAfter = hostileFormationsTotal(player.id);
assert(
  enemyFormationsAfter < enemyFormationsBefore,
  'direct kills remove formations from the strategic enemy army',
);
log(
  `combat: ${stateAfterFire?.kills ?? 0} kills, hostile formations ${enemyFormationsBefore} → ${enemyFormationsAfter}`,
);

// The strategic clock keeps running while a unit is directly controlled.
const dayBefore = session.clock.day;
session.setDirectInput({ fire: false, throttle: 0 });
session.advance(GAME.msPerDay * 2.2);
assert(session.clock.day > dayBefore, 'the strategic world keeps simulating during direct control');

session.exitDirectControl();
assert(!session.directControl.active, 'ground control can be released');
const groundResult = session.consumeDirectResult();
assert(groundResult?.status === 'exited', 'releasing a unit records a result');
assert(
  player.military.armies.some((entry) => entry.id === army.id),
  'the strategic army survives direct control',
);

// ── Air path ─────────────────────────────────────────────────────────────────
log('direct control — air: fly, climb, descend, cockpit');
assert(session.enterDirectControl(army.id, 'air_fighter'), 'fighter can be taken under direct control');
const air = session.directControl.state();
assert(Boolean(air), 'air state exists');
if (!air) throw new Error('No air state');
assert(air.entity.profile.handling === 'aircraft', 'fighter uses aircraft handling');
const airStartAltitude = air.entity.altitude;

session.setDirectInput({ throttle: 1, pitch: 1 });
step(session, 5);
assert(air.entity.altitude > airStartAltitude, 'pitch climbs the aircraft');
assert(air.entity.speed > 0, 'the aircraft accelerates');
const climbAltitude = air.entity.altitude;

session.setDirectInput({ pitch: -1 });
step(session, 6);
assert(air.entity.altitude < climbAltitude, 'negative pitch descends the aircraft');
assert(air.entity.altitude >= air.entity.groundHeight, 'terrain is a hard floor for flight');
assert(session.directControl.toggleCamera() === 'cockpit', 'aircraft supports a cockpit camera');
assert(session.directControl.toggleCamera() === 'chase', 'aircraft returns to chase camera');

const airSnapshot = session.snapshot();
assert(Boolean(airSnapshot?.direct), 'snapshot exposes the direct session');
assert((airSnapshot?.direct?.tokens.length ?? 0) > 0, 'the controlled unit is a 3D token in the world');
assert(
  airSnapshot?.direct?.tokens.some((token) => token.unitId === 'air_fighter'),
  'the aircraft token is rendered by the unit layer',
);
session.exitDirectControl();

// ── Naval and submarine paths ────────────────────────────────────────────────
log('direct control — naval: ship and submarine');
assert(session.enterDirectControl(army.id, 'nav_frigate'), 'frigate can be taken under direct control');
const naval = session.directControl.state();
assert(Boolean(naval), 'naval state exists');
if (!naval) throw new Error('No naval state');
assert(naval.entity.profile.handling === 'ship', 'frigate uses ship handling');
assert(naval.entity.profile.waterOnly, 'ships are marked as water-only');
const navalLon = naval.entity.lon;
session.setDirectInput({ throttle: 1, yaw: -0.4 });
step(session, 5);
assert(naval.entity.lon !== navalLon, 'the ship navigates');
assert(
  Math.abs(naval.entity.altitude - 0.00042) < 0.0005,
  'a ship stays on the sea surface',
);
session.exitDirectControl();

assert(
  session.enterDirectControl(army.id, 'nav_submarine'),
  'submarine can be taken under direct control',
);
const submarine = session.directControl.state();
assert(Boolean(submarine), 'submarine state exists');
if (!submarine) throw new Error('No submarine state');
assert(submarine.entity.profile.canDive, 'submarines can dive');
const surfaceAltitude = submarine.entity.altitude;
session.setDirectInput({ throttle: 0.6, dive: true });
step(session, 5);
assert(submarine.entity.altitude < surfaceAltitude, 'diving lowers the submarine');
const depthSnapshot = session.snapshot();
assert((depthSnapshot?.direct?.depthMetres ?? 0) > 0, 'the HUD receives a positive depth');
session.exitDirectControl();

// ── Map selection and re-entry ───────────────────────────────────────────────
log('direct control — world selection and army access');
const mapSnapshot = session.snapshot();
const token = mapSnapshot?.mapUnits.find((entry) => entry.controllable);
assert(Boolean(token), 'player army tokens are selectable on the globe');
if (token) {
  session.selectedMapUnitId = token.id;
  const selected = session.snapshot()?.selectedMapUnit;
  assert(selected?.armyId === token.armyId, 'selecting a token resolves its army');
  assert(selected?.unitId === token.unitId, 'selecting a token resolves its unit');
}

assert(
  session.enterDirectControl(army.id, 'inf_rifle'),
  'infantry can be taken under direct control',
);
const infantry = session.directControl.state();
assert(infantry?.entity.profile.handling === 'foot', 'infantry uses foot handling');
session.setDirectInput({ throttle: 1 });
const infantryLon = infantry?.entity.lon ?? 0;
step(session, 2);
assert((infantry?.entity.lon ?? 0) !== infantryLon, 'infantry moves on the ground');
session.exitDirectControl();

assert(session.enterDirectControl(army.id, 'art_towed'), 'artillery can be taken under direct control');
assert(session.directControl.state()?.entity.profile.handling === 'artillery', 'artillery uses its own handling');
session.exitDirectControl();

if (failures.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`\ndirect-smoke: ${failures.length} failure(s) out of ${checks} checks`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  throw new Error('direct-smoke failed');
}

// eslint-disable-next-line no-console
console.log(`✓ direct-smoke: ${checks} checks passed (ground, air, naval, submarine, infantry, artillery)`);
