import { AIDirector } from './ai/AIDirector';
import type { CountryState } from './country/types';
import { recomputeModifiers } from './country/modifiers';
import { DiplomacySystem } from './diplomacy/DiplomacySystem';
import { EconomySystem } from './economy/EconomySystem';
import { SimEventBus } from './events';
import { MilitarySystem } from './military/MilitarySystem';
import { ResearchSystem, startResearch as beginProgramme } from './research/ResearchSystem';
import type { World } from './World';

/**
 * The simulation facade: one day of world history.
 *
 * Tick order is fixed and documented because it is part of save determinism:
 *   1. economy (production, upkeep, stability)
 *   2. research (programme progress)
 *   3. military (production queues, readiness)
 *   4. diplomacy drift (weekly)
 *   5. AI decisions (staggered slice)
 *
 * All mutations go through systems; no system reaches into another's state.
 */
export class Simulation {
  readonly events = new SimEventBus();
  private readonly economy = new EconomySystem();
  private readonly research: ResearchSystem;
  private readonly military: MilitarySystem;
  private readonly diplomacy: DiplomacySystem;
  private readonly ai: AIDirector;
  private readonly lowTreasuryWarned = new Set<string>();

  constructor(private readonly world: World) {
    this.research = new ResearchSystem(this.events);
    this.military = new MilitarySystem(this.events);
    this.diplomacy = new DiplomacySystem(this.events);
    this.ai = new AIDirector(world, this.events);
  }

  tickDay(day: number): void {
    this.world.day = day;

    for (const country of this.world.countries.values()) {
      const result = this.economy.tick(country);
      this.research.tick(country, day);
      this.military.tick(country, day);

      if (result.lowTreasury && !this.lowTreasuryWarned.has(country.id)) {
        this.lowTreasuryWarned.add(country.id);
        if (day % 10 === 0) {
          this.events.emit({ type: 'lowTreasury', countryId: country.id, day });
        }
      } else if (!result.lowTreasury) {
        this.lowTreasuryWarned.delete(country.id);
      }
    }

    if (day % 7 === 0) {
      for (const country of this.world.countries.values()) {
        this.diplomacy.drift(country, day);
      }
    }

    this.ai.onDay(
      day,
      (countryId, techId) => this.startResearch(countryId, techId),
      (countryId, unitId) => this.queueProduction(countryId, unitId),
    );
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

  declareWar(aggressorId: string, defenderId: string): boolean {
    const aggressor = this.world.get(aggressorId);
    const defender = this.world.get(defenderId);
    if (!aggressor || !defender || aggressorId === defenderId) return false;
    this.diplomacy.declareWar(aggressor, defender, this.world.day);
    return true;
  }

  makePeace(aId: string, bId: string): boolean {
    const a = this.world.get(aId);
    const b = this.world.get(bId);
    if (!a || !b) return false;
    this.diplomacy.signPeace(a, b, this.world.day);
    return true;
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
    }
  }

  countryOf(id: string): CountryState | undefined {
    return this.world.get(id);
  }
}
