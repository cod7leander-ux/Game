import { clamp, clamp01 } from '../../core/math';
import { getGovernment } from '../../data/governments';
import type { CountryState } from '../country/types';
import { applyRegionalShock } from '../regions/regions';

/**
 * National stability and war weariness.
 *
 * Stability is deliberately slow-moving. War exhaustion accumulates while a
 * country fights and decays in peace; shortages, debt, occupation and unrest
 * drag stability down, and stability feeds the economy, production and research.
 * One system owns the state so statistics cannot drift between systems.
 */
const WAR_EXHAUSTION_RATE = 0.0011;
const EXHAUSTION_RECOVERY = 0.0016;

export interface StabilityResult {
  stability: number;
  unrest: number;
  warExhaustion: number;
}

export class StabilitySystem {
  tick(country: CountryState, day: number): StabilityResult {
    const government = getGovernment(country.governmentId);
    const resources = country.economy.resources;
    const atWar = country.diplomacy.wars.length > 0;
    const occupied = Boolean(country.occupierId);

    // ── War weariness ────────────────────────────────────────────────────────
    if (atWar) {
      country.warExhaustion = clamp01(
        country.warExhaustion + WAR_EXHAUSTION_RATE * Math.min(3, country.diplomacy.wars.length),
      );
    } else {
      country.warExhaustion = clamp(country.warExhaustion - EXHAUSTION_RECOVERY, 0, 1);
    }

    // ── Unrest target ────────────────────────────────────────────────────────
    const starvation = resources.food <= 1;
    const debt = resources.money < 0;
    const unrestTarget = clamp01(
      (starvation ? 0.55 : 0) +
        (debt ? 0.3 : 0) +
        country.warExhaustion * 0.45 +
        (occupied ? 0.35 : 0) +
        (country.stability < 0.35 ? 0.2 : 0),
    );
    country.unrest = clamp01(country.unrest + (unrestTarget - country.unrest) * 0.012);

    // ── Stability target ─────────────────────────────────────────────────────
    const fiscal = country.economy.income - country.economy.expenses >= 0 ? 0.02 : -0.04;
    const target = clamp01(
      government.stability +
        fiscal -
        country.warExhaustion * 0.22 -
        country.unrest * 0.2 -
        (occupied ? 0.18 : 0) -
        (starvation ? 0.1 : 0),
    );
    country.stability = clamp01(country.stability + (target - country.stability) * 0.006);

    // Occupation and unrest physically wear on the provinces.
    if (occupied) applyRegionalShock(country, 0.0004, 0.0006);
    else if (starvation || debt) applyRegionalShock(country, 0, 0.0004);

    // High unrest occasionally boils over into a stability shock.
    if (country.unrest > 0.75 && day % 30 === 0) {
      country.stability = clamp01(country.stability - 0.006);
    }

    return {
      stability: country.stability,
      unrest: country.unrest,
      warExhaustion: country.warExhaustion,
    };
  }
}
