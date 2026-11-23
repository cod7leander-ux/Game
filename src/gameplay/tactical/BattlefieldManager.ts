import { COUNTRY_BY_ID } from '../../data/countries';
import type { SimEvent } from '../events';
import type { World } from '../World';
import type { BattleSideInit, SavedTacticalBattle } from './types';
import { TacticalBattle } from './TacticalBattle';
import { TacticalCommander } from './TacticalCommander';

/**
 * Bridge between the strategic and tactical layers.
 *
 * The strategic layer resolves every engagement exactly as before and publishes
 * a `battleResolved` event carrying both sides' pre-battle rosters. When the
 * player is involved, this manager instantiates a 3D battlefield for that
 * engagement; AI-only wars stay abstract so a world war does not spawn hundreds
 * of scenes. The battle is then advanced in real time, persisted with the save
 * and exposed to the interface as a read-only snapshot.
 */
const MAX_ACTIVE_BATTLES = 3;

export interface BattleRosterSide {
  countryId: string;
  armyId: string;
  roster: Record<string, number>;
}

const rosterTotal = (roster: Record<string, number>): number =>
  Object.values(roster).reduce((sum, count) => sum + Math.max(0, count), 0);

export class BattlefieldManager {
  private readonly battles = new Map<string, TacticalBattle>();
  private readonly commander = new TacticalCommander();
  private counter = 0;

  constructor(private readonly playerCountryId: string) {}

  get active(): TacticalBattle[] {
    return [...this.battles.values()];
  }

  playerBattle(): TacticalBattle | undefined {
    return this.active.find((battle) => !battle.finished) ?? this.active[0];
  }

  get(id: string): TacticalBattle | undefined {
    return this.battles.get(id);
  }

  dismiss(id: string): boolean {
    return this.battles.delete(id);
  }

  /** Called for every strategic battle; only player engagements become 3D. */
  onBattleResolved(world: World, event: Extract<SimEvent, { type: 'battleResolved' }>): TacticalBattle | null {
    const sides = event.sides;
    if (!sides || sides.length === 0) return null;
    const playerInvolved = sides.some((side) => side.countryId === this.playerCountryId);
    if (!playerInvolved) return null;

    this.prune();
    if (this.battles.size >= MAX_ACTIVE_BATTLES) return null;

    const definition = COUNTRY_BY_ID[event.locationId];
    const lon = definition?.label[0] ?? 0;
    const lat = definition?.label[1] ?? 0;
    const attacker = world.get(event.attackerId);
    const battleSides: BattleSideInit[] = [];
    const attackerFormation = attacker?.military.armies.find((army) => army.id === sides[0].armyId)?.formation;

    sides.forEach((side, index) => {
      battleSides.push({
        countryId: side.countryId,
        armyId: side.armyId,
        roster: side.roster,
        team: index === 0 ? 0 : 1,
        formation: this.formationOf(world, side.armyId) ?? (index === 0 ? attackerFormation : undefined),
      });
    });

    // Distribute the defender's total losses across defending countries by size.
    const defenderRoster = sides.slice(1);
    const defenderTotal = defenderRoster.reduce((sum, side) => sum + rosterTotal(side.roster), 0) || 1;
    const losses: Record<string, number> = {};
    sides.forEach((side, index) => {
      if (index === 0) {
        losses[side.countryId] = event.attackerLosses;
        return;
      }
      const share = rosterTotal(side.roster) / defenderTotal;
      const value = Math.round(event.defenderLosses * share);
      losses[side.countryId] = (losses[side.countryId] ?? 0) + value;
    });

    const winnerCountryId = event.attackerWon
      ? event.attackerId
      : (sides[1]?.countryId ?? event.defenderId);

    this.counter += 1;
    const battle = new TacticalBattle({
      id: `battle-${event.day}-${event.locationId}-${this.counter}`,
      locationId: event.locationId,
      lon,
      lat,
      day: event.day,
      seed: (event.day * 2654435761 + this.counter * 97) >>> 0,
      sides: battleSides,
      outcome: { winnerCountryId, losses },
      playerCountryId: this.playerCountryId,
    });

    this.battles.set(battle.id, battle);
    return battle;
  }

  private formationOf(world: World, armyId: string) {
    for (const country of world.countries.values()) {
      const army = country.military.armies.find((entry) => entry.id === armyId);
      if (army) return army.formation;
    }
    return undefined;
  }

  /** Real-time advance for every active battlefield. */
  tick(dtSeconds: number): void {
    if (this.battles.size === 0) return;
    for (const battle of this.battles.values()) {
      if (battle.finished) continue;
      this.commander.update(battle, dtSeconds);
      battle.advance(dtSeconds);
    }
  }

  private prune(): void {
    for (const [id, battle] of this.battles) {
      if (battle.finished && battle.finishedAt !== null && battle.elapsed - battle.finishedAt > 45) {
        this.battles.delete(id);
      }
    }
  }

  toSave(): SavedTacticalBattle[] {
    return this.active.map((battle) => battle.toSave());
  }

  restore(saved: SavedTacticalBattle[] | undefined): void {
    if (!saved) return;
    for (const entry of saved.slice(-MAX_ACTIVE_BATTLES)) {
      const battle = TacticalBattle.restore(entry, {
        locationId: entry.locationId,
        lon: entry.lon,
        lat: entry.lat,
        day: entry.day,
      });
      this.battles.set(battle.id, battle);
    }
  }

  /** Applies a formation change back to the strategic army that owns it. */
  applyFormationToArmies(world: World): void {
    for (const battle of this.battles.values()) {
      for (const [countryId, formation] of Object.entries(battle.formations)) {
        const country = world.get(countryId);
        if (!country) continue;
        for (const army of country.military.armies) {
          if (battle.units.some((unit) => unit.armyId === army.id && unit.countryId === countryId)) {
            army.formation = formation;
          }
        }
      }
    }
  }
}
