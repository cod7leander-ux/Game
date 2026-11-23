import type { CountryState } from '../country/types';

/** True when either side's relationship records an active war. */
export const areAtWar = (a: CountryState, b: CountryState): boolean =>
  Boolean(a.diplomacy.relations[b.id]?.atWar || b.diplomacy.relations[a.id]?.atWar);

export const areAllied = (a: CountryState, b: CountryState): boolean =>
  a.diplomacy.allies.includes(b.id) || b.diplomacy.allies.includes(a.id);

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
  if (target.occupierId === owner.id) return true;
  if (target.occupierId) {
    return false;
  }
  return areAtWar(owner, target);
};
