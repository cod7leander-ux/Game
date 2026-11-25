import { clamp, clamp01 } from '../../core/math';
import { COUNTRY_BY_ID } from '../../data/countries';
import type { CountryState } from '../country/types';
import { areAllied } from '../diplomacy/helpers';
import type { World } from '../World';
import { armyUnits, applyLosses, removeEmptyArmies, countryDistanceKm } from '../military/armies';
import { averageInfrastructure, terrainProfile } from '../regions/regions';
import { capitalRegionOf } from '../../data/regions';
import { computeSupplyField, supplyAtRegion, type SupplyField } from './supplyNetwork';
import { REGION_GEO_BY_ID } from '../../geo';
import { findRegionState } from '../war/WarSystem';
import { getUnit } from '../../data/units';

/**
 * Lightweight operational logistics.
 *
 * Supply is a single 0..1 value per army, recomputed daily from the territory it
 * stands in, its distance from a friendly source, infrastructure, terrain,
 * occupation and logistics technology. It is deliberately coarse: enough to
 * make deep advances and poor terrain matter, without a per-vehicle simulation.
 */
const SUPPLY_THRESHOLD = 0.45;
const ATTRITION_GRACE_DAYS = 8;
const MAX_ATTRITION = 0.035;

export interface ArmySupplyResult {
  supply: number;
  source: string | null;
  reason: string;
}

export const computeSupply = (
  world: World,
  country: CountryState,
  army: { locationId: string; regionId?: string },
  field?: SupplyField,
): ArmySupplyResult => {
  const location = world.get(army.locationId);
  if (!location) return { supply: 0.5, source: country.id, reason: 'unknown-territory' };

  const homeTerrain = terrainProfile(country);
  const localTerrain = terrainProfile(location);
  const homeInfrastructure = averageInfrastructure(country);
  const localInfrastructure = averageInfrastructure(location);

  let source: string | null = null;
  let base = 0.55;
  const armyRegion =
    army.regionId ?? capitalRegionOf(army.locationId)?.id ?? capitalRegionOf(country.id)?.id;
  const network = field ? supplyAtRegion(field, armyRegion) : null;

  if (location.id === country.id || location.occupierId === country.id) {
    source = country.id;
    // Own soil supply comes from the geographic network (hubs, roads, ports),
    // falling back to the coarse distance model when no field is supplied.
    base = network === null ? 0.9 : 0.6 + Math.min(1, network) * 0.34;
  } else if (areAllied(country, location)) {
    source = location.id;
    base = 0.78;
  } else if (country.diplomacy.relations[location.id]?.militaryAccess) {
    source = location.id;
    base = 0.7;
  } else if (location.occupierId) {
    source = null;
    base = 0.4;
  } else {
    source = null;
    base = 0.34;
  }

  const distanceFactor = source
    ? clamp(1 - countryDistanceKm(country.id, location.id) / 12000, 0.45, 1)
    : 0.7;
  const occupationPenalty = country.occupierId ? 0.85 : 1;
  const localRegion = location.regions?.find((region) => region.id === armyRegion);
  const regionalOccupation = localRegion && localRegion.control !== 'sovereign' ? 0.88 : 1;
  const tech = 1 + country.modifiers.supply;
  const terrainSupply = (homeTerrain.supply + localTerrain.supply) / 2;
  const blockade = country.warfare?.naval.blockadeEffect ?? 0;
  const isolated = isArmyIsolated(world, country, army.regionId);
  const networkFactor = 0.85 + (country.logisticsState?.throughput ?? 0.5) * 0.15;

  const supply = clamp01(
    base *
      (0.6 + (source === country.id ? homeInfrastructure : localInfrastructure) * 0.4) *
      distanceFactor *
      terrainSupply *
      occupationPenalty *
      regionalOccupation *
      (1 - blockade * 0.28) *
      networkFactor *
      (isolated ? 0.62 : 1) *
      tech,
  );

  return {
    supply,
    source,
    reason: isolated ? 'encircled' : source ? 'connected' : 'unsupported',
  };
};

/**
 * A regional isolation test: an army is encircled when its region has no
 * adjacent friendly-controlled region and it is not standing on home soil.
 */
export const isArmyIsolated = (
  world: World,
  country: CountryState,
  regionId: string | undefined,
): boolean => {
  if (!regionId) return false;
  const state = findRegionState(world, regionId);
  if (!state) return false;
  if (state.countryId === country.id && !state.controllerId) return false;
  const geo = REGION_GEO_BY_ID[regionId];
  if (!geo) return false;
  for (const neighbourId of geo.neighbours) {
    const neighbour = findRegionState(world, neighbourId);
    if (!neighbour) continue;
    const controller = neighbour.controllerId ?? neighbour.countryId;
    if (
      controller === country.id ||
      country.diplomacy.allies.includes(controller) ||
      country.diplomacy.relations[controller]?.militaryAccess
    ) {
      return false;
    }
  }
  return true;
};

export class LogisticsSystem {
  /**
   * Recomputes supply for every army and applies readiness/attrition effects.
   * Runs once per simulated day for every country, not per frame.
   */
  tick(world: World): void {
    for (const country of world.countries.values()) {
      this.updateNetwork(world, country);
      // The geographic field is recomputed once per country per day and stored
      // on regions, so the supply layer and the army model cannot disagree.
      const field = computeSupplyField(world, country);
      for (const region of country.regions) {
        region.supplyLevel = Math.max(0, Math.min(1, field.levels.get(region.id) ?? 0));
      }
      if (country.military.armies.length === 0) continue;
      let supplied = 0;

      for (const army of country.military.armies) {
        const result = computeSupply(world, country, army, field);
        army.isolated = isArmyIsolated(world, country, army.regionId);
        if (army.isolated) army.encircledDays += 1;
        else army.encircledDays = Math.max(0, army.encircledDays - 2);
        // Supply recovers quickly, degrades slowly: advances get harder over time.
        const rate = result.supply > army.supply ? 0.22 : 0.12;
        army.supply = clamp01(army.supply + (result.supply - army.supply) * rate);
        army.supplySource = result.source;
        supplied += army.supply;
        if (result.reason === 'encircled') {
          army.morale = clamp01(army.morale - 0.004);
          army.readiness = clamp01(army.readiness - 0.005);
        } else {
          army.morale = clamp01(army.morale + 0.001);
          army.readiness = clamp01(army.readiness + 0.001);
        }

        if (army.supply < SUPPLY_THRESHOLD) {
          army.daysLowSupply += 1;
          if (army.daysLowSupply > ATTRITION_GRACE_DAYS && armyUnits(army) > 0) {
            const severity = 1 - army.supply / SUPPLY_THRESHOLD;
            // Always cost at least one formation per attrition day so small
            // forces are not immune through rounding.
            const fraction = Math.max(
              1 / Math.max(1, armyUnits(army)),
              Math.min(MAX_ATTRITION, 0.004 + severity * 0.02),
            );
            applyLosses(army, fraction);
          }
        } else {
          army.daysLowSupply = 0;
        }
      }

      const average = supplied / Math.max(1, country.military.armies.length);
      // Readiness cannot stay high on an unsupplied force.
      if (average < 0.6) {
        country.military.readiness = clamp(
          country.military.readiness - (0.6 - average) * 0.004,
          0.2,
          0.98,
        );
      }
      removeEmptyArmies(country);
    }
  }

  /**
   * Derives convoy capacity, hubs, bottlenecks and throughput once per day.
   * Trade routes reuse this state for their route capacity instead of keeping a
   * second, contradictory logistics model.
   */
  private updateNetwork(world: World, country: CountryState): void {
    if (!country.logisticsState) {
      country.logisticsState = {
        hubCount: 0,
        throughput: 0.6,
        convoyCapacity: 1,
        disruption: 0,
        bottlenecks: [],
        convoyLosses: 0,
        lastUpdateDay: 0,
      };
    }
    const state = country.logisticsState;
    let hubs = 0;
    let capacity = 0;
    let transports = 0;
    for (const region of country.regions) {
      const definition = REGION_GEO_BY_ID[region.id];
      const isHub =
        region.supplyHub > 0.08 ||
        region.id === country.capitalRegionId ||
        (region.portCapacity ?? 0) > 0.1 ||
        (region.airportCapacity ?? 0) > 0.1;
      if (isHub) hubs += 1;
      capacity +=
        0.3 +
        (region.portCapacity ?? 0) * 0.9 +
        (region.airportCapacity ?? 0) * 0.4 +
        (region.constructionCapacity ?? 0) * 0.4 +
        region.infrastructure * 0.55 +
        region.supplyHub * 0.8;
      void definition;
    }
    for (const [unitId, count] of Object.entries(country.military.formations)) {
      const unit = getUnit(unitId);
      if (unit?.role === 'transport' && unit.domain === 'air') transports += count * 2.4;
      if (unit?.domain === 'naval' && unit.role === 'transport') transports += count * 4;
    }
    const routes = (country.trade?.routes ?? [])
      .map((id) => world.tradeRoutes[id])
      .filter(Boolean);
    const routeDisruption = routes.length
      ? routes.reduce((sum, route) => sum + route.disruption, 0) / routes.length
      : 0;
    const blockade = country.warfare?.naval.blockadeEffect ?? 0;
    const occupation = country.occupierId ? 0.55 : 1;
    state.hubCount = hubs;
    state.convoyCapacity = Math.max(0.5, transports + capacity * 0.2);
    state.disruption = clamp01(routeDisruption * 0.7 + blockade * 0.55);
    state.throughput = clamp01(
      (capacity / Math.max(1, country.regions.length)) *
        0.45 *
        occupation *
        (1 - state.disruption * 0.6) *
        (1 + (country.modifiers?.logistics ?? 0)),
    );
    state.bottlenecks = country.regions
      .slice()
      .sort(
        (a, b) =>
          a.supplyLevel +
          a.infrastructure * 0.4 -
          (b.supplyLevel + b.infrastructure * 0.4),
      )
      .slice(0, 3)
      .map((region) => region.id);
    state.convoyLosses += state.disruption * blockade * 0.8;
    state.lastUpdateDay = world.day;
  }
}

/** Human-readable source label used by the interface. */
export const supplySourceName = (countryId: string | null): string | null => {
  if (!countryId) return null;
  return COUNTRY_BY_ID[countryId]?.name.en ?? countryId;
};
