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
import type { World } from '../gameplay/World';
import type { NotificationEntry, CountryState } from '../gameplay/country/types';
import type {
  ArmyMarkerView,
  ArmyView,
  CountryBrief,
  DiplomacyView,
  FormationView,
  PlayerSnapshot,
  QueueView,
  ResourceView,
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
