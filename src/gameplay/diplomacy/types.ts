export type RelationStatus = 'war' | 'hostile' | 'strained' | 'neutral' | 'friendly' | 'ally';

/**
 * Bilateral relationship.
 *
 * Agreement flags are mutually exclusive where they must be (a country cannot
 * be an ally and at war, or trade while sanctioned); the diplomacy system
 * enforces that on every transition instead of trusting callers.
 */
export interface Relation {
  /** -100 (war) .. 100 (allied). */
  value: number;
  atWar: boolean;
  ally: boolean;
  tradePartner: boolean;
  /** Non-aggression pact: no war declarations without breaking it first. */
  nonAggression: boolean;
  /** Mutual permission for armies to transit the other's territory. */
  militaryAccess: boolean;
  /** Trade embargo imposed by either side. */
  embargo: boolean;
  /** Sanctions: the other side has restricted this country's commerce. */
  sanctioned: boolean;
  /** -100..100 confidence in the other side's word. */
  trust: number;
  /** 0..100 perceived military threat from the other side. */
  threat: number;
  lastChangeDay: number;
}

export interface DiplomacyState {
  /** Sparse map of countryId → relation. Absent means neutral contact. */
  relations: Record<string, Relation>;
  /** Countries that declared on this nation and are still hostile. */
  wars: string[];
  allies: string[];
  tradePartners: string[];
  nonAggressionPartners: string[];
  militaryAccessPartners: string[];
  /** Countries this nation has embargoed. */
  embargoed: string[];
  /** 0..1 diplomatic capital, spent on agreements. */
  influence: number;
}

export const createRelation = (day: number, value = 0): Relation => ({
  value,
  atWar: false,
  ally: false,
  tradePartner: false,
  nonAggression: false,
  militaryAccess: false,
  embargo: false,
  sanctioned: false,
  trust: 0,
  threat: 0,
  lastChangeDay: day,
});

export const relationStatus = (relation: Relation | undefined): RelationStatus => {
  if (!relation) return 'neutral';
  if (relation.atWar) return 'war';
  if (relation.ally) return 'ally';
  if (relation.value >= 45) return 'friendly';
  if (relation.value <= -45) return 'hostile';
  if (relation.value <= -15) return 'strained';
  return 'neutral';
};

/** True when the relationship has no contradictory agreement flags. */
export const relationIsConsistent = (relation: Relation): boolean => {
  if (relation.atWar && (relation.ally || relation.nonAggression || relation.tradePartner)) return false;
  if (relation.ally && relation.nonAggression) return false;
  if (relation.sanctioned && relation.tradePartner) return false;
  return true;
};
