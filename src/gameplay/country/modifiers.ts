import { TECHNOLOGIES } from '../../data/research';
import { UNITS } from '../../data/units';
import type { CountryState } from './types';

/**
 * Recomputes derived country modifiers from completed research.
 * Called on load, on research completion and whenever the player changes
 * doctrine. Nothing else may write to `country.modifiers`.
 */
export const recomputeModifiers = (country: CountryState): void => {
  const modifiers = {
    production: 0,
    income: 0,
    research: 0,
    attack: 0,
    defence: 0,
    supply: 0,
    detection: 0,
    resource: 0,
  };
  const completed = new Set(country.research.completed);

  for (const tech of TECHNOLOGIES) {
    if (!completed.has(tech.id)) continue;
    for (const effect of tech.effects) {
      switch (effect.kind) {
        case 'production':
          modifiers.production += effect.value;
          break;
        case 'income':
          modifiers.income += effect.value;
          break;
        case 'research':
          modifiers.research += effect.value;
          break;
        case 'attack':
          modifiers.attack += effect.value;
          break;
        case 'defence':
          modifiers.defence += effect.value;
          break;
        case 'supply':
          modifiers.supply += effect.value;
          break;
        case 'detection':
          modifiers.detection += effect.value;
          break;
        case 'resource':
          modifiers.resource += effect.value;
          break;
        default:
          break;
      }
    }
  }

  country.modifiers = modifiers;
  country.techLevel = 1 + completed.size * 0.18;
};

/** Whether the country may build a unit: every required technology is known. */
export const canBuildUnit = (country: CountryState, unitId: string): boolean => {
  const unit = UNITS[unitId];
  if (!unit) return false;
  if (unit.requiresTech.length === 0) return true;
  return unit.requiresTech.every((techId) => country.research.completed.includes(techId));
};

/** Recalculates the global army strength index (kept in one place for the AI). */
export const recomputeStrength = (country: CountryState): void => {
  let strength = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = UNITS[unitId];
    if (!unit || count <= 0) continue;
    const attack = unit.stats.attack * (1 + country.modifiers.attack);
    const hardAttack = unit.stats.hardAttack * (1 + country.modifiers.attack);
    const health = unit.stats.health * (1 + country.modifiers.defence);
    strength += (attack * 0.5 + hardAttack * 0.6 + health * 0.12) * count;
  }
  country.military.strengthIndex = strength * (0.6 + country.military.readiness * 0.4);
};
