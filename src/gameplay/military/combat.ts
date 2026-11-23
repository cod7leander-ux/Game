import type { Rng } from '../../core/rng';
import type { CountryState } from '../country/types';
import { applyLosses, armyPower, armyUnits, type Army } from './armies';

/**
 * Battle resolution.
 *
 * One synchronous engagement decides a contested country: the side with more
 * effective power wins, both sides take casualties proportional to the balance,
 * and the survivors retreat. The resolver is deterministic for a given seed and
 * day, which keeps campaigns reproducible and save/load exact.
 */
export interface BattleSide {
  army: Army;
  country: CountryState;
}

export interface BattleResult {
  attackerWon: boolean;
  attackerPower: number;
  defenderPower: number;
  attackerLosses: number;
  defenderLosses: number;
}

export const resolveBattle = (
  rng: Rng,
  attacker: BattleSide,
  defenders: BattleSide[],
): BattleResult => {
  const attackerPower = armyPower(attacker.army, attacker.country) * rng.range(0.86, 1.14);
  const defenderPower =
    defenders.reduce((total, side) => total + armyPower(side.army, side.country), 0) *
    rng.range(0.86, 1.14);

  if (defenderPower <= 0) {
    return {
      attackerWon: true,
      attackerPower,
      defenderPower,
      attackerLosses: 0,
      defenderLosses: 0,
    };
  }

  const attackerWon = attackerPower >= defenderPower;
  const winnerLoss = 0.1 + rng.next() * 0.16;
  const loserLoss = 0.55 + rng.next() * 0.35;

  let attackerLosses = 0;
  let defenderLosses = 0;

  if (attackerWon) {
    attackerLosses = applyLosses(attacker.army, winnerLoss);
    for (const side of defenders) defenderLosses += applyLosses(side.army, loserLoss);
    attacker.army.battlesWon += 1;
  } else {
    for (const side of defenders) defenderLosses += applyLosses(side.army, winnerLoss);
    attackerLosses = applyLosses(attacker.army, loserLoss);
  }

  return { attackerWon, attackerPower, defenderPower, attackerLosses, defenderLosses };
};

/** Total formations present on a side, used for battle reports. */
export const sideUnits = (sides: BattleSide[]): number =>
  sides.reduce((total, side) => total + armyUnits(side.army), 0);
