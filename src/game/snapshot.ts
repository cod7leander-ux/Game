import { getGovernment } from '../data/governments';
import { PERSONALITIES } from '../data/personalities';
import { RESOURCES, RESOURCE_ORDER } from '../data/resources';
import { getTech, TECHNOLOGIES } from '../data/research';
import { UNIT_LIST, getUnit } from '../data/units';
import { citiesOf, capitalOf } from '../data/cities';
import { COUNTRY_BY_ID } from '../data/countries';
import { formatGameDate, formatNumber, gameYear } from '../i18n/format';
import { localize, translate } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import type { MessageKey } from '../i18n/locales/en';
import type { GameSpeed } from '../core/config';
import { getRelation, statusWith } from '../gameplay/diplomacy/DiplomacySystem';
import { areAllied, areAtWar, canEnterTerritory } from '../gameplay/diplomacy/helpers';
import { researchOutput } from '../gameplay/research/ResearchSystem';
import { dailyUpkeep } from '../gameplay/military/upkeep';
import { armyPower, armyUnits } from '../gameplay/military/armies';
import { tacticalProfileOrFallback, weaponsOf } from '../data/tacticalProfiles';
import type { TacticalBattle } from '../gameplay/tactical/TacticalBattle';
import { TACTICAL } from '../core/config';
import type { World } from '../gameplay/World';
import type { NotificationEntry, CountryState } from '../gameplay/country/types';
import type {
  ArmyMarkerView,
  ArmyView,
  BattleProjectileView,
  BattleUnitView,
  BattleView,
  CountryBrief,
  DiplomacyView,
  FormationView,
  PlayerSnapshot,
  QueueView,
  ResourceView,
  UnitTokenView,
} from './types';

/**
 * Read-only view models for the interface.
 *
 * The UI never touches simulation objects directly: it consumes snapshots that
 * are cheap to build, localised at creation time and safe to memoise.
 */

export interface SnapshotInput {
  locale: LocaleCode;
  world: World;
  day: number;
  speed: GameSpeed;
  paused: boolean;
  dayProgress: number;
  notifications: NotificationEntry[];
  unread: number;
  /** Active player battlefield, if any. */
  battle?: TacticalBattle | null;
  /** Currently selected tactical unit. */
  selectedUnitId?: string | null;
}

const monthName = (locale: LocaleCode) => (index: number) =>
  translate(locale, `time.month.${index + 1}` as MessageKey);

const stabilityKey = (stability: number): PlayerSnapshot['country']['stabilityKey'] => {
  if (stability >= 0.7) return 'stable';
  if (stability >= 0.5) return 'strained';
  if (stability >= 0.3) return 'unstable';
  return 'critical';
};

const strengthClass = (strength: number, total: number): CountryBrief['strengthClass'] => {
  const share = strength / Math.max(1, total);
  if (share > 0.08) return 'super';
  if (share > 0.03) return 'major';
  if (share > 0.008) return 'regional';
  return 'weak';
};

const buildResourceViews = (country: CountryState, locale: LocaleCode): ResourceView[] =>
  RESOURCE_ORDER.map((id) => ({
    id,
    name: localize(RESOURCES[id].name, locale),
    short: localize(RESOURCES[id].short, locale),
    color: RESOURCES[id].color,
    amount: Math.round(country.economy.resources[id]),
  }));

const buildFormationViews = (country: CountryState, locale: LocaleCode): FormationView[] =>
  Object.entries(country.military.formations)
    .filter(([, count]) => count > 0)
    .map(([unitId, count]) => {
      const unit = getUnit(unitId);
      return {
        unitId,
        name: unit ? localize(unit.name, locale) : unitId,
        domain: unit?.domain ?? 'support',
        role: unit?.role ?? 'support',
        count,
        tier: unit?.tier ?? 1,
      };
    })
    .sort((a, b) => b.tier - a.tier || b.count - a.count);

const buildQueueViews = (country: CountryState, locale: LocaleCode): QueueView[] =>
  country.military.queue.map((order) => {
    const unit = getUnit(order.unitId);
    return {
      orderId: order.id,
      unitId: order.unitId,
      name: unit ? localize(unit.name, locale) : order.unitId,
      daysRemaining: Math.max(0, Math.ceil(order.daysRemaining)),
      totalDays: order.totalDays,
      progress: Math.min(1, 1 - order.daysRemaining / Math.max(1, order.totalDays)),
    };
  });

const buildDiplomacyViews = (country: CountryState, locale: LocaleCode): DiplomacyView[] => {
  const views: DiplomacyView[] = [];
  for (const [otherId, relation] of Object.entries(country.diplomacy.relations)) {
    const definition = COUNTRY_BY_ID[otherId];
    if (!definition) continue;
    views.push({
      id: otherId,
      name: localize(definition.name, locale),
      iso2: definition.iso2,
      value: Math.round(relation.value),
      status: statusWith(country, otherId),
      atWar: relation.atWar,
      ally: relation.ally,
      trade: relation.tradePartner,
      neighbour: true,
      canDeclareWar: !relation.atWar && !relation.ally,
      canMakePeace: relation.atWar,
    });
  }
  return views.sort((a, b) => {
    const priority = (view: DiplomacyView) => (view.atWar ? 0 : view.ally ? 1 : 2);
    const delta = priority(a) - priority(b);
    return delta !== 0 ? delta : b.value - a.value;
  });
};

const buildArmyViews = (
  world: World,
  country: CountryState,
  locale: LocaleCode,
): ArmyView[] => {
  const views: ArmyView[] = [];
  for (const army of country.military.armies) {
    const location = COUNTRY_BY_ID[army.locationId];
    const destination = army.movement ? COUNTRY_BY_ID[army.movement.to] : undefined;
    const targets: ArmyView['targets'] = army.movement
      ? []
      : world
          .neighboursOf(army.locationId)
          .map((id) => world.get(id))
          .filter((entry): entry is CountryState => Boolean(entry))
          .filter((entry) => canEnterTerritory(country, entry))
          .map((entry) => {
            const definition = COUNTRY_BY_ID[entry.id];
            return {
              id: entry.id,
              name: definition ? localize(definition.name, locale) : entry.id,
              atWar: areAtWar(country, entry),
              ally: areAllied(country, entry),
              occupiedByUs: entry.occupierId === country.id,
            };
          })
          .sort((a, b) => Number(b.atWar) - Number(a.atWar) || a.name.localeCompare(b.name));

    views.push({
      id: army.id,
      ordinal: army.ordinal,
      locationId: army.locationId,
      locationName: location ? localize(location.name, locale) : army.locationId,
      composition: Object.entries(army.composition)
        .filter(([, count]) => count > 0)
        .map(([unitId, count]) => {
          const unit = getUnit(unitId);
          return {
            unitId,
            name: unit ? localize(unit.name, locale) : unitId,
            count,
          };
        })
        .sort((a, b) => b.count - a.count),
      units: armyUnits(army),
      strength: Math.round(armyPower(army, country)),
      movement:
        army.movement && destination
          ? {
              toId: army.movement.to,
              toName: localize(destination.name, locale),
              daysRemaining: Math.max(1, Math.ceil(army.movement.daysRemaining)),
              totalDays: army.movement.totalDays,
              progress: Math.min(
                1,
                Math.max(
                  0,
                  1 - army.movement.daysRemaining / Math.max(1, army.movement.totalDays),
                ),
              ),
            }
          : null,
      targets,
    });
  }
  return views.sort((a, b) => a.ordinal - b.ordinal);
};

/** Player armies and those of powers at war with the player, as 3D markers. */
const buildArmyMarkers = (world: World, playerId: string): ArmyMarkerView[] => {
  const player = world.get(playerId);
  if (!player) return [];
  const markers: ArmyMarkerView[] = [];
  for (const country of world.countries.values()) {
    const own = country.id === playerId;
    if (!own && !areAtWar(player, country)) continue;
    const definition = COUNTRY_BY_ID[country.id];
    if (!definition) continue;
    for (const army of country.military.armies) {
      markers.push({
        id: army.id,
        lon: definition.label[0],
        lat: definition.label[1],
        tone: own ? 'player' : 'enemy',
      });
    }
  }
  return markers;
};

/**
 * Strategic army tokens.
 *
 * Each army is represented by a few 3D unit silhouettes planted at its country
 * anchor, so military forces are visible on the globe before a battle starts.
 * Purely presentational: the army stacks remain the source of truth.
 */
const buildMapUnits = (world: World, playerId: string): UnitTokenView[] => {
  const player = world.get(playerId);
  if (!player) return [];
  const tokens: UnitTokenView[] = [];

  for (const country of world.countries.values()) {
    const own = country.id === playerId;
    if (!own && !areAtWar(player, country)) continue;
    const definition = COUNTRY_BY_ID[country.id];
    if (!definition) continue;
    const tone: UnitTokenView['tone'] = own ? 'player' : 'enemy';

    country.military.armies.forEach((army, armyIndex) => {
      const entries = Object.entries(army.composition)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TACTICAL.mapTokensPerArmy);
      const armyOffset = (armyIndex - (country.military.armies.length - 1) / 2) * 0.03;

      entries.forEach(([unitId], index) => {
        const profile = tacticalProfileOrFallback(unitId);
        const columns = 2;
        const column = index % columns;
        const row = Math.floor(index / columns);
        tokens.push({
          id: `${army.id}-token-${index}`,
          unitId,
          archetype: profile.archetype,
          lon: definition.label[0],
          lat: definition.label[1],
          offsetEast: armyOffset + (column - 0.5) * 0.016,
          offsetNorth: (row - 0.5) * 0.016,
          altitude: profile.layer === 'air' ? 0.022 : 0.004,
          heading: 0.6,
          tone,
          health: 1,
          selected: false,
          selectable: false,
          scale: TACTICAL.mapTokenScale,
        });
      });
    });
  }
  return tokens;
};

const battleUnitView = (
  countryName: (id: string) => string,
  battle: TacticalBattle,
  unit: TacticalBattle['units'][number],
  locale: LocaleCode,
): BattleUnitView => {
  const definition = getUnit(unit.unitId);
  const profile = tacticalProfileOrFallback(unit.unitId);
  const target = unit.targetId ? battle.getUnit(unit.targetId) : undefined;
  const targetDefinition = target ? getUnit(target.unitId) : undefined;
  return {
    id: unit.id,
    unitId: unit.unitId,
    name: definition ? localize(definition.name, locale) : unit.unitId,
    archetype: profile.archetype,
    countryId: unit.countryId,
    countryName: countryName(unit.countryId),
    side: unit.countryId === battle.playerCountryId ? 'player' : 'enemy',
    health: Math.max(0, Math.round(unit.health)),
    maxHealth: Math.round(unit.maxHealth),
    healthRatio: unit.maxHealth > 0 ? Math.max(0, unit.health / unit.maxHealth) : 0,
    state: unit.state,
    targetName: targetDefinition ? localize(targetDefinition.name, locale) : null,
    formation: unit.formation,
    weight: unit.weight,
    kills: unit.kills,
    weapons: weaponsOf(unit.unitId).map((weapon) => ({
      name: localize(weapon.name, locale),
      damage: weapon.damage,
      range: weapon.range,
      cooldown: weapon.cooldown,
      ready: Math.max(0, unit.cooldowns[weapon.id] ?? 0),
    })),
  };
};

const buildBattleView = (
  battle: TacticalBattle | null,
  locale: LocaleCode,
): BattleView | null => {
  if (!battle) return null;
  const place = COUNTRY_BY_ID[battle.locationId];
  const countryName = (id: string): string => {
    const entry = COUNTRY_BY_ID[id];
    return entry ? localize(entry.name, locale) : id;
  };
  const playerCountryId = battle.playerCountryId;
  const playerSide = battle.sideOf(playerCountryId);

  let playerStrength = 0;
  let enemyStrength = 0;
  for (const unit of battle.units) {
    if (unit.state === 'destroyed') continue;
    if (unit.countryId === playerCountryId) playerStrength += unit.weight;
    else if (unit.side !== playerSide) enemyStrength += unit.weight;
  }

  return {
    id: battle.id,
    placeName: place ? localize(place.name, locale) : battle.locationId,
    lon: battle.lon,
    lat: battle.lat,
    day: battle.day,
    elapsed: battle.elapsed,
    status: battle.status,
    winner: !battle.finished
      ? null
      : battle.winnerCountryId === null
        ? 'draw'
        : battle.winnerCountryId === playerCountryId
          ? 'player'
          : 'enemy',
    playerCountryId,
    formation: battle.formationOf(playerCountryId),
    units: battle.units.map((unit) => battleUnitView(countryName, battle, unit, locale)),
    projectiles: battle.projectiles.map(
      (projectile): BattleProjectileView => ({
        id: projectile.id,
        kind: projectile.kind,
        lon: battle.lon,
        lat: battle.lat,
        offsetEast: projectile.position.x * TACTICAL.visualScale,
        offsetNorth: projectile.position.z * TACTICAL.visualScale,
        altitude: projectile.position.y * TACTICAL.visualScale + 0.002,
        friendly: projectile.countryId === playerCountryId,
      }),
    ),
    playerStrength: Math.round(playerStrength),
    enemyStrength: Math.round(enemyStrength),
  };
};

const buildBattleUnits = (
  battle: TacticalBattle | null,
  selectedUnitId: string | null | undefined,
): UnitTokenView[] => {
  if (!battle) return [];
  const tokens: UnitTokenView[] = [];
  const playerSide = battle.sideOf(battle.playerCountryId);

  for (const unit of battle.units) {
    if (unit.state === 'destroyed') continue;
    const profile = tacticalProfileOrFallback(unit.unitId);
    tokens.push({
      id: unit.id,
      unitId: unit.unitId,
      archetype: profile.archetype,
      lon: battle.lon,
      lat: battle.lat,
      offsetEast: unit.position.x * TACTICAL.visualScale,
      offsetNorth: unit.position.z * TACTICAL.visualScale,
      altitude: unit.position.y * TACTICAL.visualScale + 0.002,
      heading: unit.heading,
      tone:
        unit.countryId === battle.playerCountryId
          ? 'player'
          : unit.side === playerSide
            ? 'ally'
            : 'enemy',
      health: Math.max(0, unit.health / Math.max(1, unit.maxHealth)),
      selected: unit.id === selectedUnitId,
      selectable: true,
      scale: TACTICAL.battleTokenScale,
    });
  }
  return tokens;
};

const buildWarnings = (country: CountryState, locale: LocaleCode): string[] => {
  const warnings: string[] = [];
  const resources = country.economy.resources;
  if (country.occupierId) {
    const occupier = COUNTRY_BY_ID[country.occupierId];
    warnings.push(
      translate(locale, 'overview.occupied', {
        country: occupier ? localize(occupier.name, locale) : country.occupierId,
      }),
    );
  }
  if (resources.money < 0) warnings.push(translate(locale, 'notify.lowTreasury'));
  if (resources.food <= 0) warnings.push(translate(locale, 'economy.resources'));
  if (resources.oil <= 0) warnings.push(translate(locale, 'military.readiness'));
  if (!country.research.activeTechId) warnings.push(translate(locale, 'research.none'));
  if (country.diplomacy.wars.length > 0) warnings.push(translate(locale, 'diplomacy.wars'));
  if (country.military.readiness < 0.45) warnings.push(translate(locale, 'military.readiness'));
  return warnings;
};

export const buildPlayerSnapshot = (input: SnapshotInput): PlayerSnapshot | null => {
  const country = input.world.get(input.world.playerCountryId);
  if (!country) return null;
  const definition = COUNTRY_BY_ID[country.id];
  if (!definition) return null;

  const locale = input.locale;
  const government = getGovernment(country.governmentId);
  const personality = PERSONALITIES[country.ai.personalityId] ?? PERSONALITIES.balanced;
  const activeTech = country.research.activeTechId ? getTech(country.research.activeTechId) : null;
  const output = researchOutput(country);
  const cost = activeTech?.cost ?? 0;
  const remaining = Math.max(0, cost - country.research.progress);
  const netIncome = country.economy.income - country.economy.expenses;

  return {
    day: input.day,
    year: gameYear(input.day),
    dateLabel: formatGameDate(input.day, locale, monthName(locale)),
    speed: input.speed,
    paused: input.paused,
    dayProgress: input.dayProgress,
    unread: input.unread,
    country: {
      id: country.id,
      name: localize(definition.name, locale),
      iso2: definition.iso2,
      flagSeed: definition.iso2 ? definition.iso2.charCodeAt(0) * 131 + definition.iso2.charCodeAt(1) : 1,
      governmentName: localize(government.name, locale),
      personalityName: localize(personality.name, locale),
      focus: country.ai.focus,
      population: Math.round(country.population),
      treasury: Math.round(country.economy.resources.money),
      income: country.economy.income,
      expenses: country.economy.expenses,
      netIncome,
      stability: country.stability,
      stabilityKey: stabilityKey(country.stability),
      manpower: Math.round(country.economy.availableManpower),
      strength: Math.round(country.military.strengthIndex),
      industrialCapacity: country.economy.industrialCapacity,
      techLevel: country.techLevel,
      researchOutput: output,
      taxRate: country.economy.taxRate,
      armyFormations: Object.values(country.military.formations).reduce((total, n) => total + n, 0),
      occupierName: country.occupierId
        ? (() => {
            const occupier = COUNTRY_BY_ID[country.occupierId];
            return occupier ? localize(occupier.name, locale) : country.occupierId;
          })()
        : null,
    },
    armies: buildArmyViews(input.world, country, locale),
    mapArmies: buildArmyMarkers(input.world, country.id),
    mapUnits: buildMapUnits(input.world, country.id),
    battle: buildBattleView(input.battle ?? null, locale),
    battleUnits: buildBattleUnits(input.battle ?? null, input.selectedUnitId),
    resources: buildResourceViews(country, locale),
    research: {
      activeId: country.research.activeTechId,
      activeName: activeTech ? localize(activeTech.name, locale) : null,
      progress: country.research.progress,
      cost,
      ratio: cost > 0 ? Math.min(1, country.research.progress / cost) : 0,
      output,
      daysRemaining: output > 0 ? Math.ceil(remaining / output) : 0,
      completedCount: country.research.completed.length,
      totalCount: TECHNOLOGIES.length,
      completed: [...country.research.completed],
    },
    military: {
      formations: buildFormationViews(country, locale),
      queue: buildQueueViews(country, locale),
      readiness: country.military.readiness,
      manpowerCommitted: country.military.manpowerCommitted,
      strength: country.military.strengthIndex,
      upkeep: dailyUpkeep(country),
    },
    diplomacy: buildDiplomacyViews(country, locale),
    cities: citiesOf(country.id),
    warnings: buildWarnings(country, locale),
    notifications: input.notifications,
  };
};

export const buildCountryBrief = (country: CountryState, totalStrength: number): CountryBrief | null => {
  const definition = COUNTRY_BY_ID[country.id];
  if (!definition) return null;
  return {
    definition,
    state: country,
    capital: capitalOf(country.id) ?? null,
    cities: citiesOf(country.id),
    strengthClass: strengthClass(country.military.strengthIndex, totalStrength),
  };
};

/** National power ranking for UI sorting. */
export const rankCountries = (world: World): CountryState[] =>
  [...world.countries.values()].sort((a, b) => b.military.strengthIndex - a.military.strengthIndex);

export const availableUnitIds = (country: CountryState): string[] =>
  UNIT_LIST.filter((unit) => unit.requiresTech.every((tech) => country.research.completed.includes(tech))).map(
    (unit) => unit.id,
  );

export const relationFor = (country: CountryState, otherId: string) => getRelation(country, otherId);

export const numberFor = (value: number, locale: LocaleCode): string =>
  formatNumber(Math.round(value), locale, { maximumFractionDigits: 0 });
