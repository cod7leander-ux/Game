import { clamp } from '../../core/math';
import type { CountryState } from '../country/types';
import type { SimEventSink } from '../events';
import {
  createRelation,
  relationStatus,
  type Relation,
  type RelationStatus,
} from './types';

/**
 * Bilateral relations and agreements.
 *
 * Every transition is normalised here: declaring war clears pacts and trade,
 * alliances supersede non-aggression, sanctions block trade, and breaking a
 * pact costs trust. Callers can therefore never create a contradictory state by
 * ordering actions in the wrong sequence.
 */
const DRIFT = 0.35;
const MAX_RELATIONS = 10;

/** Diplomatic capital price of each agreement. */
export const DIPLOMACY_COST = {
  improve: 0.05,
  nonAggression: 0.12,
  militaryAccess: 0.1,
  embargo: 0.08,
  alliance: 0.18,
  trade: 0.08,
} as const;

export const getRelation = (country: CountryState, otherId: string): Relation | undefined =>
  country.diplomacy.relations[otherId];

export const ensureRelation = (country: CountryState, otherId: string, day: number): Relation => {
  let relation = country.diplomacy.relations[otherId];
  if (!relation) {
    relation = createRelation(day);
    country.diplomacy.relations[otherId] = relation;
  }
  // Saves written before Milestone 4 have no agreement fields.
  if (relation.nonAggression === undefined) relation.nonAggression = false;
  if (relation.militaryAccess === undefined) relation.militaryAccess = false;
  if (relation.embargo === undefined) relation.embargo = false;
  if (relation.sanctioned === undefined) relation.sanctioned = false;
  if (relation.trust === undefined) relation.trust = 0;
  if (relation.threat === undefined) relation.threat = 0;
  return relation;
};

export const statusWith = (country: CountryState, otherId: string): RelationStatus =>
  relationStatus(country.diplomacy.relations[otherId]);

const removeFrom = (list: string[], id: string): void => {
  const index = list.indexOf(id);
  if (index >= 0) list.splice(index, 1);
};

const addOnce = (list: string[], id: string): void => {
  if (!list.includes(id)) list.push(id);
};

export class DiplomacySystem {
  constructor(private readonly events: SimEventSink) {}

  /** Slow pull toward neutrality; trust and threat follow value and decay. */
  drift(country: CountryState, day: number): void {
    for (const relation of Object.values(country.diplomacy.relations)) {
      if (!relation.atWar) {
        const pull = -Math.sign(relation.value) * DRIFT;
        if (Math.abs(relation.value) <= DRIFT) relation.value = 0;
        else relation.value += pull;
      }
      const trustTarget = relation.value * 0.5 + (relation.ally ? 25 : 0) - (relation.atWar ? 40 : 0);
      relation.trust = clamp(relation.trust + (trustTarget - relation.trust) * 0.02, -100, 100);
      relation.threat = clamp(relation.threat * 0.995, 0, 100);
      relation.lastChangeDay = day;
    }
    // Diplomatic capital regenerates slowly, faster for stable governments.
    country.diplomacy.influence = clamp(
      country.diplomacy.influence + 0.012 + country.stability * 0.006,
      0,
      1,
    );
  }

  adjust(country: CountryState, otherId: string, delta: number, day: number): void {
    const relation = ensureRelation(country, otherId, day);
    relation.value = clamp(relation.value + delta, -100, 100);
    relation.lastChangeDay = day;
  }

  adjustTrust(country: CountryState, otherId: string, delta: number, day: number): void {
    const relation = ensureRelation(country, otherId, day);
    relation.trust = clamp(relation.trust + delta, -100, 100);
    relation.lastChangeDay = day;
  }

  adjustThreat(country: CountryState, otherId: string, delta: number, day: number): void {
    const relation = ensureRelation(country, otherId, day);
    relation.threat = clamp(relation.threat + delta, 0, 100);
    relation.lastChangeDay = day;
  }

  private spend(country: CountryState, cost: number): boolean {
    if (country.diplomacy.influence + 1e-9 < cost) return false;
    country.diplomacy.influence = clamp(country.diplomacy.influence - cost, 0, 1);
    return true;
  }

  declareWar(aggressor: CountryState, defender: CountryState, day: number): boolean {
    if (aggressor.id === defender.id) return false;
    const existing = ensureRelation(aggressor, defender.id, day);
    if (existing.atWar) return false;

    // Breaking a pact is possible, but it destroys trust in both directions.
    const hadPact = existing.nonAggression || existing.militaryAccess || existing.ally;
    existing.atWar = true;
    existing.ally = false;
    existing.nonAggression = false;
    existing.militaryAccess = false;
    existing.tradePartner = false;
    existing.embargo = false;
    existing.value = Math.min(existing.value, -60);
    existing.trust = clamp(existing.trust - (hadPact ? 50 : 10), -100, 100);
    existing.lastChangeDay = day;

    const b = ensureRelation(defender, aggressor.id, day);
    b.atWar = true;
    b.ally = false;
    b.nonAggression = false;
    b.militaryAccess = false;
    b.tradePartner = false;
    b.value = Math.min(b.value, -60);
    b.threat = clamp(b.threat + 35, 0, 100);
    b.trust = clamp(b.trust - (hadPact ? 55 : 15), -100, 100);
    b.lastChangeDay = day;

    removeFrom(aggressor.diplomacy.allies, defender.id);
    removeFrom(defender.diplomacy.allies, aggressor.id);
    removeFrom(aggressor.diplomacy.tradePartners, defender.id);
    removeFrom(defender.diplomacy.tradePartners, aggressor.id);
    removeFrom(aggressor.diplomacy.nonAggressionPartners, defender.id);
    removeFrom(defender.diplomacy.nonAggressionPartners, aggressor.id);
    removeFrom(aggressor.diplomacy.militaryAccessPartners, defender.id);
    removeFrom(defender.diplomacy.militaryAccessPartners, aggressor.id);

    addOnce(aggressor.diplomacy.wars, defender.id);
    addOnce(defender.diplomacy.wars, aggressor.id);
    this.events.emit({
      type: 'warDeclared',
      aggressorId: aggressor.id,
      defenderId: defender.id,
      day,
    });
    return true;
  }

  signPeace(a: CountryState, b: CountryState, day: number): boolean {
    const ra = ensureRelation(a, b.id, day);
    const rb = ensureRelation(b, a.id, day);
    if (!ra.atWar && !rb.atWar) return false;
    ra.atWar = false;
    rb.atWar = false;
    ra.value = Math.max(ra.value, -10);
    rb.value = Math.max(rb.value, -10);
    ra.trust = Math.max(ra.trust, -10);
    rb.trust = Math.max(rb.trust, -10);
    ra.lastChangeDay = day;
    rb.lastChangeDay = day;

    removeFrom(a.diplomacy.wars, b.id);
    removeFrom(b.diplomacy.wars, a.id);
    this.events.emit({ type: 'peaceSigned', aId: a.id, bId: b.id, day });
    return true;
  }

  formAlliance(a: CountryState, b: CountryState, day: number): boolean {
    if (a.id === b.id) return false;
    const ra = ensureRelation(a, b.id, day);
    const rb = ensureRelation(b, a.id, day);
    if (ra.atWar || rb.atWar || ra.ally || rb.ally) return false;
    if (ra.value < 35 || ra.trust < 10) return false;
    if (!this.spend(a, DIPLOMACY_COST.alliance)) return false;

    ra.ally = true;
    ra.nonAggression = false;
    ra.tradePartner = true;
    ra.value = Math.max(ra.value, 70);
    ra.trust = clamp(ra.trust + 15, -100, 100);
    ra.lastChangeDay = day;
    rb.ally = true;
    rb.nonAggression = false;
    rb.tradePartner = true;
    rb.value = Math.max(rb.value, 70);
    rb.trust = clamp(rb.trust + 15, -100, 100);
    rb.lastChangeDay = day;

    addOnce(a.diplomacy.allies, b.id);
    addOnce(b.diplomacy.allies, a.id);
    addOnce(a.diplomacy.tradePartners, b.id);
    addOnce(b.diplomacy.tradePartners, a.id);
    removeFrom(a.diplomacy.nonAggressionPartners, b.id);
    removeFrom(b.diplomacy.nonAggressionPartners, a.id);
    this.events.emit({ type: 'allianceFormed', aId: a.id, bId: b.id, day });
    return true;
  }

  /** Voluntary dissolution; the breaker loses trust and standing. */
  breakAlliance(a: CountryState, b: CountryState, day: number): boolean {
    const ra = ensureRelation(a, b.id, day);
    const rb = ensureRelation(b, a.id, day);
    if (!ra.ally) return false;
    ra.ally = false;
    rb.ally = false;
    ra.value -= 20;
    rb.value -= 20;
    ra.trust = clamp(ra.trust - 35, -100, 100);
    rb.trust = clamp(rb.trust - 45, -100, 100);
    ra.lastChangeDay = day;
    rb.lastChangeDay = day;
    removeFrom(a.diplomacy.allies, b.id);
    removeFrom(b.diplomacy.allies, a.id);
    return true;
  }

  openTrade(a: CountryState, b: CountryState, day: number): boolean {
    const ra = ensureRelation(a, b.id, day);
    const rb = ensureRelation(b, a.id, day);
    if (ra.atWar || rb.atWar || ra.embargo || rb.embargo || ra.sanctioned || rb.sanctioned) {
      return false;
    }
    if (ra.tradePartner) return false;
    if (!this.spend(a, DIPLOMACY_COST.trade)) return false;
    ra.tradePartner = true;
    rb.tradePartner = true;
    ra.value = clamp(ra.value + 5, -100, 100);
    rb.value = clamp(rb.value + 5, -100, 100);
    ra.lastChangeDay = day;
    rb.lastChangeDay = day;
    addOnce(a.diplomacy.tradePartners, b.id);
    addOnce(b.diplomacy.tradePartners, a.id);
    this.events.emit({ type: 'tradeOpened', aId: a.id, bId: b.id, day });
    return true;
  }

  formNonAggression(a: CountryState, b: CountryState, day: number): boolean {
    if (a.id === b.id) return false;
    const ra = ensureRelation(a, b.id, day);
    const rb = ensureRelation(b, a.id, day);
    if (ra.atWar || rb.atWar || ra.ally || rb.ally || ra.nonAggression) return false;
    if (!this.spend(a, DIPLOMACY_COST.nonAggression)) return false;
    ra.nonAggression = true;
    rb.nonAggression = true;
    ra.value = clamp(ra.value + 6, -100, 100);
    rb.value = clamp(rb.value + 6, -100, 100);
    ra.trust = clamp(ra.trust + 8, -100, 100);
    rb.trust = clamp(rb.trust + 8, -100, 100);
    ra.lastChangeDay = day;
    rb.lastChangeDay = day;
    addOnce(a.diplomacy.nonAggressionPartners, b.id);
    addOnce(b.diplomacy.nonAggressionPartners, a.id);
    this.events.emit({ type: 'pactSigned', aId: a.id, bId: b.id, kind: 'nonAggression', day });
    return true;
  }

  grantMilitaryAccess(a: CountryState, b: CountryState, day: number): boolean {
    const ra = ensureRelation(a, b.id, day);
    const rb = ensureRelation(b, a.id, day);
    if (ra.atWar || rb.atWar || ra.militaryAccess) return false;
    if (!this.spend(a, DIPLOMACY_COST.militaryAccess)) return false;
    ra.militaryAccess = true;
    rb.militaryAccess = true;
    ra.value = clamp(ra.value + 4, -100, 100);
    rb.value = clamp(rb.value + 4, -100, 100);
    ra.lastChangeDay = day;
    rb.lastChangeDay = day;
    addOnce(a.diplomacy.militaryAccessPartners, b.id);
    addOnce(b.diplomacy.militaryAccessPartners, a.id);
    this.events.emit({ type: 'pactSigned', aId: a.id, bId: b.id, kind: 'militaryAccess', day });
    return true;
  }

  imposeEmbargo(a: CountryState, b: CountryState, day: number): boolean {
    const ra = ensureRelation(a, b.id, day);
    const rb = ensureRelation(b, a.id, day);
    if (a.id === b.id || ra.atWar || ra.embargo) return false;
    ra.embargo = true;
    ra.tradePartner = false;
    ra.value = clamp(ra.value - 12, -100, 100);
    ra.trust = clamp(ra.trust - 10, -100, 100);
    ra.lastChangeDay = day;
    rb.sanctioned = true;
    rb.tradePartner = false;
    rb.value = clamp(rb.value - 10, -100, 100);
    rb.threat = clamp(rb.threat + 12, 0, 100);
    rb.lastChangeDay = day;
    removeFrom(a.diplomacy.tradePartners, b.id);
    removeFrom(b.diplomacy.tradePartners, a.id);
    addOnce(a.diplomacy.embargoed, b.id);
    this.events.emit({ type: 'embargoImposed', aId: a.id, bId: b.id, day });
    return true;
  }

  liftEmbargo(a: CountryState, b: CountryState, day: number): void {
    const ra = ensureRelation(a, b.id, day);
    const rb = ensureRelation(b, a.id, day);
    ra.embargo = false;
    rb.sanctioned = false;
    ra.lastChangeDay = day;
    rb.lastChangeDay = day;
    removeFrom(a.diplomacy.embargoed, b.id);
  }

  improveRelations(a: CountryState, b: CountryState, day: number): boolean {
    const relation = ensureRelation(a, b.id, day);
    if (relation.atWar) return false;
    if (!this.spend(a, DIPLOMACY_COST.improve)) return false;
    relation.value = clamp(relation.value + 6, -100, 100);
    relation.threat = clamp(relation.threat - 4, 0, 100);
    relation.lastChangeDay = day;
    const reverse = ensureRelation(b, a.id, day);
    reverse.value = clamp(reverse.value + 5, -100, 100);
    reverse.lastChangeDay = day;
    return true;
  }

  /** Initial contact network, generated once per campaign from proximity. */
  seedRelations(country: CountryState, neighbours: string[], rngMin: number, rngMax: number, day: number, random: () => number): void {
    for (const neighbourId of neighbours.slice(0, MAX_RELATIONS)) {
      if (country.diplomacy.relations[neighbourId]) continue;
      const value = rngMin + random() * (rngMax - rngMin);
      const relation = createRelation(day, value);
      relation.tradePartner = value > 22 && random() > 0.55;
      if (relation.tradePartner) country.diplomacy.tradePartners.push(neighbourId);
      country.diplomacy.relations[neighbourId] = relation;
    }
  }
}
