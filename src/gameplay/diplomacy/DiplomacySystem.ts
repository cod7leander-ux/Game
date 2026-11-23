import { clamp } from '../../core/math';
import type { CountryState } from '../country/types';
import type { SimEventSink } from '../events';
import { createRelation, relationStatus, type Relation, type RelationStatus } from './types';

/**
 * Bilateral relations and agreements.
 *
 * In Milestone 1 relations drift and the AI reads them; the agreement actions
 * (war, peace, alliance, trade) are complete and are exercised by the UI state
 * machine as it arrives in Milestone 4.
 */
const DRIFT = 0.35;
const MAX_RELATIONS = 10;

export const getRelation = (country: CountryState, otherId: string): Relation | undefined =>
  country.diplomacy.relations[otherId];

export const ensureRelation = (country: CountryState, otherId: string, day: number): Relation => {
  let relation = country.diplomacy.relations[otherId];
  if (!relation) {
    relation = createRelation(day);
    country.diplomacy.relations[otherId] = relation;
  }
  return relation;
};

export const statusWith = (country: CountryState, otherId: string): RelationStatus =>
  relationStatus(country.diplomacy.relations[otherId]);

export class DiplomacySystem {
  constructor(private readonly events: SimEventSink) {}

  /** Slow pull toward neutrality; wars and alliances pin their state. */
  drift(country: CountryState, day: number): void {
    for (const relation of Object.values(country.diplomacy.relations)) {
      if (relation.atWar || relation.ally) continue;
      const pull = -Math.sign(relation.value) * DRIFT;
      if (Math.abs(relation.value) <= DRIFT) {
        relation.value = 0;
      } else {
        relation.value += pull;
      }
      relation.lastChangeDay = day;
    }
  }

  adjust(country: CountryState, otherId: string, delta: number, day: number): void {
    const relation = ensureRelation(country, otherId, day);
    relation.value = clamp(relation.value + delta, -100, 100);
    relation.lastChangeDay = day;
  }

  declareWar(aggressor: CountryState, defender: CountryState, day: number): void {
    const a = ensureRelation(aggressor, defender.id, day);
    a.atWar = true;
    a.ally = false;
    a.tradePartner = false;
    a.value = Math.min(a.value, -60);
    a.lastChangeDay = day;

    const b = ensureRelation(defender, aggressor.id, day);
    b.atWar = true;
    b.ally = false;
    b.tradePartner = false;
    b.value = Math.min(b.value, -60);
    b.lastChangeDay = day;

    if (!aggressor.diplomacy.wars.includes(defender.id)) aggressor.diplomacy.wars.push(defender.id);
    if (!defender.diplomacy.wars.includes(aggressor.id)) defender.diplomacy.wars.push(aggressor.id);
    this.events.emit({
      type: 'warDeclared',
      aggressorId: aggressor.id,
      defenderId: defender.id,
      day,
    });
  }

  signPeace(a: CountryState, b: CountryState, day: number): void {
    const ra = ensureRelation(a, b.id, day);
    ra.atWar = false;
    ra.value = Math.max(ra.value, -10);
    ra.lastChangeDay = day;
    const rb = ensureRelation(b, a.id, day);
    rb.atWar = false;
    rb.value = Math.max(rb.value, -10);
    rb.lastChangeDay = day;

    a.diplomacy.wars = a.diplomacy.wars.filter((id) => id !== b.id);
    b.diplomacy.wars = b.diplomacy.wars.filter((id) => id !== a.id);
    this.events.emit({ type: 'peaceSigned', aId: a.id, bId: b.id, day });
  }

  formAlliance(a: CountryState, b: CountryState, day: number): void {
    const ra = ensureRelation(a, b.id, day);
    ra.ally = true;
    ra.atWar = false;
    ra.value = Math.max(ra.value, 70);
    ra.lastChangeDay = day;
    const rb = ensureRelation(b, a.id, day);
    rb.ally = true;
    rb.atWar = false;
    rb.value = Math.max(rb.value, 70);
    rb.lastChangeDay = day;

    if (!a.diplomacy.allies.includes(b.id)) a.diplomacy.allies.push(b.id);
    if (!b.diplomacy.allies.includes(a.id)) b.diplomacy.allies.push(a.id);
    this.events.emit({ type: 'allianceFormed', aId: a.id, bId: b.id, day });
  }

  openTrade(a: CountryState, b: CountryState, day: number): void {
    ensureRelation(a, b.id, day).tradePartner = true;
    ensureRelation(a, b.id, day).lastChangeDay = day;
    ensureRelation(b, a.id, day).tradePartner = true;
    ensureRelation(b, a.id, day).lastChangeDay = day;
    if (!a.diplomacy.tradePartners.includes(b.id)) a.diplomacy.tradePartners.push(b.id);
    if (!b.diplomacy.tradePartners.includes(a.id)) b.diplomacy.tradePartners.push(a.id);
    this.events.emit({ type: 'tradeOpened', aId: a.id, bId: b.id, day });
  }

  /** Initial contact network, generated once per campaign from proximity. */
  seedRelations(country: CountryState, neighbours: string[], rngMin: number, rngMax: number, day: number, random: () => number): void {
    for (const neighbourId of neighbours.slice(0, MAX_RELATIONS)) {
      if (country.diplomacy.relations[neighbourId]) continue;
      const value = rngMin + random() * (rngMax - rngMin);
      const relation = createRelation(day, value);
      relation.tradePartner = value > 22 && random() > 0.55;
      country.diplomacy.relations[neighbourId] = relation;
      if (relation.tradePartner) country.diplomacy.tradePartners.push(neighbourId);
    }
  }
}
