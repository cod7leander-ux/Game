import { AIDirector } from './ai/AIDirector';
import type { CountryState } from './country/types';
import { recomputeModifiers } from './country/modifiers';
import { DiplomacySystem } from './diplomacy/DiplomacySystem';
import { EconomySystem } from './economy/EconomySystem';
import { SimEventBus } from './events';
import { syncMilitaryTotals } from './military/armies';
import { ArmySystem, type MarchResult } from './military/ArmySystem';
import { MilitarySystem } from './military/MilitarySystem';
import { BattlefieldManager } from './tactical/BattlefieldManager';
import type { BattleCommand, SavedTacticalBattle } from './tactical/types';
import { ResearchSystem, startResearch as beginProgramme } from './research/ResearchSystem';
import type { World } from './World';

/**
 * The simulation facade: one day of world history.
 *
 * Tick order is fixed and documented because it is part of save determinism:
 *   1. economy (production, upkeep, stability, occupation tribute)
 *   2. research (programme progress)
 *   3. military (production queues, readiness)
 *   4. armies (marches resolve; battles and occupations happen here)
 *   5. diplomacy drift (weekly)
 *   6. AI decisions (staggered slice)
 *
 * All mutations go through systems; no system reaches into another's state.
 */
const OCCUPATION_TRIBUTE = 0.4;

export class Simulation {
  readonly events = new SimEventBus();
  /** Player-involved engagements represented in 3D. Strategic results stay authoritative. */
  readonly battlefields: BattlefieldManager;
  private readonly economy = new EconomySystem();
  private readonly research: ResearchSystem;
  private readonly armies: ArmySystem;
  private readonly military: MilitarySystem;
  private readonly diplomacy: DiplomacySystem;
  private readonly ai: AIDirector;
  private readonly lowTreasuryWarned = new Set<string>();

  constructor(private readonly world: World) {
    this.research = new ResearchSystem(this.events);
    this.armies = new ArmySystem(this.events);
    this.military = new MilitarySystem(this.events, this.armies);
    this.diplomacy = new DiplomacySystem(this.events);
    this.ai = new AIDirector(world, this.events);
    this.battlefields = new BattlefieldManager(world.playerCountryId);
    // Every strategic battle publishes its rosters; the tactical manager opens
    // a battlefield only for engagements that involve the player.
    this.events.on((event) => {
      if (event.type === 'battleResolved') this.battlefields.onBattleResolved(world, event);
    });
  }

  tickDay(day: number): void {
    this.world.day = day;

    for (const country of this.world.countries.values()) {
      const result = this.economy.tick(country);
      this.research.tick(country, day);
      this.military.tick(country, day);
      this.collectOccupationTribute(country);

      if (result.lowTreasury && !this.lowTreasuryWarned.has(country.id)) {
        this.lowTreasuryWarned.add(country.id);
        if (day % 10 === 0) {
          this.events.emit({ type: 'lowTreasury', countryId: country.id, day });
        }
      } else if (!result.lowTreasury) {
        this.lowTreasuryWarned.delete(country.id);
      }
    }

    this.armies.tick(this.world, day);

    if (day % 7 === 0) {
      for (const country of this.world.countries.values()) {
        this.diplomacy.drift(country, day);
      }
    }

    this.ai.onDay(day, {
      startResearch: (countryId, techId) => this.startResearch(countryId, techId),
      queueUnits: (countryId, unitId) => this.queueProduction(countryId, unitId),
      marchArmy: (countryId, armyId, targetId) =>
        this.marchArmy(countryId, armyId, targetId).ok,
      declareWar: (countryId, targetId) => this.declareWar(countryId, targetId),
      makePeace: (countryId, targetId) => this.makePeace(countryId, targetId),
    });
  }

  /** Advances real-time 3D battlefields while the campaign is running. */
  advanceRealtime(dtSeconds: number): void {
    this.battlefields.tick(dtSeconds);
  }

  /** Restores battlefields from a save after the strategic world is rebuilt. */
  restoreBattlefields(saved: SavedTacticalBattle[] | undefined): void {
    this.battlefields.restore(saved);
  }

  playerBattle() {
    return this.battlefields.playerBattle();
  }

  issueBattleCommand(command: BattleCommand): boolean {
    const battle = this.battlefields.playerBattle();
    if (!battle) return false;
    const accepted = battle.command(command);
    if (accepted) this.battlefields.applyFormationToArmies(this.world);
    return accepted;
  }

  dismissBattle(): void {
    const battle = this.battlefields.playerBattle();
    if (battle) this.battlefields.dismiss(battle.id);
  }

  /** A share of an occupied country's revenue goes to its occupier. */
  private collectOccupationTribute(country: CountryState): void {
    if (!country.occupierId) return;
    const occupier = this.world.get(country.occupierId);
    if (!occupier || occupier.id === country.id) {
      country.occupierId = null;
      return;
    }
    const tribute = Math.max(0, country.economy.income) * OCCUPATION_TRIBUTE;
    country.economy.resources.money = Math.max(
      -500,
      country.economy.resources.money - tribute,
    );
    occupier.economy.resources.money += tribute;
  }

  // ── Player/AI shared actions ────────────────────────────────────────────────

  startResearch(countryId: string, techId: string): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    const started = beginProgramme(country, techId);
    if (started) {
      this.events.emit({ type: 'researchStart', countryId, techId, day: this.world.day });
    }
    return started;
  }

  queueProduction(countryId: string, unitId: string): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    const result = this.military.enqueue(country, unitId, this.world.day);
    return result.ok;
  }

  marchArmy(countryId: string, armyId: string, targetId: string): MarchResult {
    return this.armies.march(this.world, countryId, armyId, targetId, this.world.day);
  }

  declareWar(aggressorId: string, defenderId: string): boolean {
    const aggressor = this.world.get(aggressorId);
    const defender = this.world.get(defenderId);
    if (!aggressor || !defender || aggressorId === defenderId) return false;
    if (aggressor.diplomacy.relations[defenderId]?.atWar) return false;
    this.diplomacy.declareWar(aggressor, defender, this.world.day);
    return true;
  }

  makePeace(aId: string, bId: string): boolean {
    const a = this.world.get(aId);
    const b = this.world.get(bId);
    if (!a || !b) return false;
    this.diplomacy.signPeace(a, b, this.world.day);
    this.releaseOccupations(a.id, b.id);
    return true;
  }

  /** Peace returns occupied territory to its sovereign. */
  private releaseOccupations(aId: string, bId: string): void {
    for (const country of this.world.countries.values()) {
      if (country.occupierId !== aId && country.occupierId !== bId) continue;
      country.occupierId = null;
      country.stability = Math.min(0.95, country.stability + 0.04);
      this.events.emit({
        type: 'territoryLiberated',
        countryId: country.id,
        day: this.world.day,
      });
    }
  }

  formAlliance(aId: string, bId: string): boolean {
    const a = this.world.get(aId);
    const b = this.world.get(bId);
    if (!a || !b) return false;
    this.diplomacy.formAlliance(a, b, this.world.day);
    return true;
  }

  openTrade(aId: string, bId: string): boolean {
    const a = this.world.get(aId);
    const b = this.world.get(bId);
    if (!a || !b) return false;
    this.diplomacy.openTrade(a, b, this.world.day);
    return true;
  }

  /** Restores derived values after a load; never re-runs history. */
  static rehydrate(world: World): void {
    for (const country of world.countries.values()) {
      recomputeModifiers(country);
      country.research.output = 0;
      syncMilitaryTotals(country);
    }
  }

  countryOf(id: string): CountryState | undefined {
    return this.world.get(id);
  }
}
