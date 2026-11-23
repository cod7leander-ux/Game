import { getGovernment } from '../../data/governments';
import { getUnit } from '../../data/units';
import type { CountryState } from '../country/types';

/**
 * Daily credit cost of the standing army (shared by economy and UI).
 *
 * UPKEEP_SCALE is the single balance lever for how expensive it is to field an
 * army: it keeps small nations solvent while still making large forces a real
 * budget decision.
 */
export const UPKEEP_SCALE = 0.72;

export const dailyUpkeep = (country: CountryState): number => {
  const government = getGovernment(country.governmentId);
  let total = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (!unit) continue;
    total += unit.upkeep * count;
  }
  for (const order of country.military.queue) {
    const unit = getUnit(order.unitId);
    if (unit) total += unit.upkeep * 0.3;
  }
  return total * government.upkeepModifier * UPKEEP_SCALE;
};
