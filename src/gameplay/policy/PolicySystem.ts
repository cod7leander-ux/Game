import { clamp, clamp01 } from '../../core/math';
import { getPolicy, POLICIES } from '../../data/policies';
import type { CountryState } from '../country/types';
import { recomputeModifiers } from '../country/modifiers';
import type { SimEventSink } from '../events';
import { MAX_ACTIVE_POLICIES } from './types';

/**
 * National policy management.
 *
 * Policies are persistent modifiers, not objectives. Enacting one costs money
 * and political stability; the daily tick charges upkeep and applies the
 * policy's stability drift. The AI and the player use the same methods.
 */
export class PolicySystem {
  constructor(private readonly events: SimEventSink) {}

  setPolicy(country: CountryState, policyId: string, enabled: boolean, day: number): boolean {
    const definition = getPolicy(policyId);
    if (!definition) return false;
    const state = country.policy;
    const active = state.active.includes(policyId);
    if (enabled === active) return false;
    if (enabled) {
      if (state.active.length >= MAX_ACTIVE_POLICIES) return false;
      if (country.economy.resources.money < 30) return false;
      country.economy.resources.money -= 30;
      country.stability = clamp01(country.stability - definition.politicalCost);
      state.active.push(policyId);
    } else {
      country.economy.resources.money -= 10;
      state.active = state.active.filter((id) => id !== policyId);
      country.stability = clamp01(country.stability - definition.politicalCost * 0.4);
    }
    state.lastChangedDay = day;
    recomputeModifiers(country);
    this.events.emit({
      type: 'policyChanged',
      countryId: country.id,
      policyId,
      enabled,
      day,
    });
    return true;
  }

  setMobilization(country: CountryState, level: number, day: number): boolean {
    const next = clamp(level, 0.2, 1);
    if (Math.abs(next - country.policy.mobilization) < 0.005) return false;
    const increase = Math.max(0, next - country.policy.mobilization);
    country.policy.mobilization = next;
    country.policy.lastChangedDay = day;
    country.stability = clamp01(country.stability - increase * 0.06);
    recomputeModifiers(country);
    this.events.emit({
      type: 'mobilizationChanged',
      countryId: country.id,
      level: next,
      day,
    });
    return true;
  }

  tick(country: CountryState, day: number): void {
    const state = country.policy;
    if (state.active.length === 0) return;
    let upkeep = 0;
    let drift = 0;
    let readiness = 0;
    for (const id of state.active) {
      const policy = getPolicy(id);
      if (!policy) continue;
      upkeep += policy.upkeep;
      drift += policy.stabilityDrift;
      readiness += policy.effects.readiness ?? 0;
    }
    country.economy.resources.money = clamp(
      country.economy.resources.money - upkeep,
      -500,
      Math.max(50, country.economy.gdp * 0.02) * 8,
    );
    country.stability = clamp01(country.stability + drift);
    country.military.readiness = clamp01(country.military.readiness + readiness);
    if (day % 20 === 0 && country.economy.resources.money < 0 && state.active.length > 0) {
      // Fiscal stress automatically suspends the most expensive policy.
      const mostExpensive = [...state.active]
        .map((id) => ({ id, upkeep: getPolicy(id)?.upkeep ?? 0 }))
        .sort((a, b) => b.upkeep - a.upkeep)[0];
      if (mostExpensive && mostExpensive.upkeep > 0) {
        state.active = state.active.filter((id) => id !== mostExpensive.id);
        recomputeModifiers(country);
        this.events.emit({
          type: 'policyChanged',
          countryId: country.id,
          policyId: mostExpensive.id,
          enabled: false,
          day,
        });
      }
    }
  }

  /** AI policy choice: one enactment per decision cycle, deterministic. */
  consider(country: CountryState, day: number): void {
    if (country.occupierId) return;
    if (country.policy.active.length >= MAX_ACTIVE_POLICIES) return;
    if (day - country.policy.lastChangedDay < 45) return;
    if (country.economy.resources.money < 120) return;
    const wantWar = country.diplomacy.wars.length > 0;
    const candidates = POLICIES.filter((policy) => {
      if (country.policy.active.includes(policy.id)) return false;
      if (policy.upkeep > country.economy.income * 0.2) return false;
      if (wantWar && policy.category === 'trade') return false;
      if (!wantWar && policy.category === 'mobilization') return false;
      return true;
    });
    if (candidates.length === 0) return;
    const preferred =
      country.diplomacy.wars.length > 0
        ? ['military', 'logistics', 'mobilization', 'stability']
        : ['economy', 'research', 'trade', 'diplomacy', 'logistics'];
    candidates.sort((a, b) => {
      const rank = (id: string) => {
        const index = preferred.indexOf(id);
        return index === -1 ? preferred.length : index;
      };
      const delta = rank(a.category) - rank(b.category);
      return delta !== 0 ? delta : a.upkeep - b.upkeep;
    });
    this.setPolicy(country, candidates[0].id, true, day);
  }
}
