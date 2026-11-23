import { clamp, clamp01 } from '../../core/math';
import { COUNTRY_BY_ID } from '../../data/countries';
import type { CountryState } from '../country/types';
import { areAllied } from '../diplomacy/helpers';
import type { World } from '../World';
import { armyUnits, applyLosses, removeEmptyArmies, countryDistanceKm } from '../military/armies';
import { averageInfrastructure, terrainProfile } from '../regions/regions';

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
  army: { locationId: string },
): ArmySupplyResult => {
  const location = world.get(army.locationId);
  if (!location) return { supply: 0.5, source: country.id, reason: 'unknown-territory' };

  const homeTerrain = terrainProfile(country);
  const localTerrain = terrainProfile(location);
  const homeInfrastructure = averageInfrastructure(country);
  const localInfrastructure = averageInfrastructure(location);

  let source: string | null = null;
  let base = 0.55;

  if (location.id === country.id || location.occupierId === country.id) {
    source = country.id;
    base = 0.9;
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
  const tech = 1 + country.modifiers.supply;
  const terrainSupply = (homeTerrain.supply + localTerrain.supply) / 2;

  const supply = clamp01(
    base *
      (0.6 + (source === country.id ? homeInfrastructure : localInfrastructure) * 0.4) *
      distanceFactor *
      terrainSupply *
      occupationPenalty *
      tech,
  );

  return {
    supply,
    source,
    reason: source ? 'connected' : 'unsupported',
  };
};

export class LogisticsSystem {
  /**
   * Recomputes supply for every army and applies readiness/attrition effects.
   * Runs once per simulated day for every country, not per frame.
   */
  tick(world: World): void {
    for (const country of world.countries.values()) {
      if (country.military.armies.length === 0) continue;
      let supplied = 0;

      for (const army of country.military.armies) {
        const result = computeSupply(world, country, army);
        // Supply recovers quickly, degrades slowly: advances get harder over time.
        const rate = result.supply > army.supply ? 0.22 : 0.12;
        army.supply = clamp01(army.supply + (result.supply - army.supply) * rate);
        army.supplySource = result.source;
        supplied += army.supply;

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
}

/** Human-readable source label used by the interface. */
export const supplySourceName = (countryId: string | null): string | null => {
  if (!countryId) return null;
  return COUNTRY_BY_ID[countryId]?.name.en ?? countryId;
};
