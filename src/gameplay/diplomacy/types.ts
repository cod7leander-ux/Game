export type RelationStatus = 'war' | 'hostile' | 'strained' | 'neutral' | 'friendly' | 'ally';

export interface Relation {
  /** -100 (war) .. 100 (allied). */
  value: number;
  atWar: boolean;
  ally: boolean;
  tradePartner: boolean;
  lastChangeDay: number;
}

export interface DiplomacyState {
  /** Sparse map of countryId → relation. Absent means neutral contact. */
  relations: Record<string, Relation>;
  /** Countries that declared on this nation and are still hostile. */
  wars: string[];
  allies: string[];
  tradePartners: string[];
  /** 0..1 diplomatic capital, spent on agreements. */
  influence: number;
}

export const createRelation = (day: number, value = 0): Relation => ({
  value,
  atWar: false,
  ally: false,
  tradePartner: false,
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
