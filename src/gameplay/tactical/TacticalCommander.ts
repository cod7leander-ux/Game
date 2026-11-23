import type { TacticalBattle } from './TacticalBattle';
import { distance3 } from './vector';

/**
 * Tactical battle AI.
 *
 * Deliberately small and generic: it reads the same battle API the player uses
 * (advance, withdraw, hold, attack) and adapts to distance and condition. It is
 * the foundation the advanced battlefield AI is built on — there is no bespoke
 * script per unit type, and no unit-specific branch anywhere in this file.
 */
const DECISION_INTERVAL = 1.5;
const ENGAGE_DISTANCE = 850;
const RETREAT_HEALTH = 0.34;

export class TacticalCommander {
  private timer = 0;

  update(battle: TacticalBattle, dt: number): void {
    if (battle.finished) return;
    this.timer += dt;
    if (this.timer < DECISION_INTERVAL) return;
    this.timer = 0;

    for (const countryId of battle.aiCountries()) {
      const ownUnits = battle.unitsOfCountry(countryId).filter((unit) => unit.state !== 'destroyed');
      if (ownUnits.length === 0) continue;

      const side = battle.sideOf(countryId);
      const opponents = battle
        .livingUnits()
        .filter((unit) => unit.side !== side)
        .sort((a, b) => distance3(ownUnits[0].position, a.position) - distance3(ownUnits[0].position, b.position));

      if (opponents.length === 0) continue;
      const nearest = opponents[0];
      let distance = Number.POSITIVE_INFINITY;
      for (const unit of ownUnits) distance = Math.min(distance, distance3(unit.position, nearest.position));

      if (battle.healthRatio(countryId) < RETREAT_HEALTH && distance < ENGAGE_DISTANCE) {
        battle.withdrawSide(countryId);
        continue;
      }

      if (distance > ENGAGE_DISTANCE) {
        battle.advanceSide(countryId, 0.4);
      } else {
        battle.command({ kind: 'hold-line', countryId });
      }

      // Focus fire: prioritise the enemy's long-range support, then the closest.
      const priority = opponents
        .slice()
        .sort((a, b) => b.weight * b.maxHealth - a.weight * a.maxHealth)[0];
      let assigned = 0;
      for (const unit of ownUnits) {
        if (assigned >= 3) break;
        if (unit.manual || unit.forcedTargetId) continue;
        if (!battle.command({ kind: 'attack', unitId: unit.id, targetId: priority.id })) continue;
        assigned += 1;
      }
    }
  }
}
