import type { CountryState } from '../country/types';

/** True when either side's relationship records an active war. */
export const areAtWar = (a: CountryState, b: CountryState): boolean =>
  Boolean(a.diplomacy.relations[b.id]?.atWar || b.diplomacy.relations[a.id]?.atWar);

export const areAllied = (a: CountryState, b: CountryState): boolean =>
  a.diplomacy.allies.includes(b.id) || b.diplomacy.allies.includes(a.id);

/** Mutual transit permission granted by a pact. */
export const haveMilitaryAccess = (a: CountryState, b: CountryState): boolean =>
  Boolean(a.diplomacy.relations[b.id]?.militaryAccess || b.diplomacy.relations[a.id]?.militaryAccess);

/** True when either side has an active non-aggression pact. */
export const haveNonAggression = (a: CountryState, b: CountryState): boolean =>
  Boolean(a.diplomacy.relations[b.id]?.nonAggression || b.diplomacy.relations[a.id]?.nonAggression);

/**
 * Whether an army of `owner` may enter `target`'s territory.
 *
 * Movement is an act of policy: land may be entered when it is your own, an
 * ally's, already under your occupation, or an enemy's. Neutral soil is closed
 * until war is declared.
 */
export const canEnterTerritory = (owner: CountryState, target: CountryState): boolean => {
  if (target.id === owner.id) return true;
  if (areAllied(owner, target)) return true;
  if (haveMilitaryAccess(owner, target)) return true;
  if (target.occupierId === owner.id) return true;
  if (target.occupierId) {
    return false;
  }
  return areAtWar(owner, target);
};
