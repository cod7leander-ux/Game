import type { CountryState } from '../country/types';
import type { ObjectiveKind, StrategicObjective } from './types';

/**
 * Objective bookkeeping.
 *
 * Deterministic, allocation-free and independent of the AI: any system can add
 * or complete an objective, and the director reads them every planning cycle.
 */
export interface ObjectiveInput {
  kind: ObjectiveKind;
  priority: number;
  armyId?: string | null;
  targetCountryId?: string | null;
  targetRegionId?: string | null;
  note?: string;
}

export const addObjective = (
  country: CountryState,
  input: ObjectiveInput,
  day: number,
): StrategicObjective | null => {
  const duplicate = country.objectives.find(
    (objective) =>
      objective.status === 'active' &&
      objective.kind === input.kind &&
      objective.targetCountryId === (input.targetCountryId ?? null) &&
      objective.targetRegionId === (input.targetRegionId ?? null) &&
      objective.armyId === (input.armyId ?? null),
  );
  if (duplicate) {
    duplicate.priority = Math.max(duplicate.priority, input.priority);
    return duplicate;
  }

  const objective: StrategicObjective = {
    id: `${country.id}-O${day}-${country.objectives.length}-${input.kind}`,
    countryId: country.id,
    armyId: input.armyId ?? null,
    kind: input.kind,
    priority: input.priority,
    targetCountryId: input.targetCountryId ?? null,
    targetRegionId: input.targetRegionId ?? null,
    createdDay: day,
    status: 'active',
    note: input.note ?? '',
  };
  country.objectives.push(objective);
  // Keep the list bounded: oldest low-priority objectives fall off first.
  if (country.objectives.length > 24) {
    country.objectives.sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || a.priority - b.priority);
    country.objectives.splice(0, country.objectives.length - 24);
  }
  return objective;
};

export const activeObjectives = (country: CountryState): StrategicObjective[] =>
  country.objectives.filter((objective) => objective.status === 'active');

export const completeObjective = (
  country: CountryState,
  objectiveId: string,
): void => {
  const objective = country.objectives.find((entry) => entry.id === objectiveId);
  if (objective) objective.status = 'completed';
};

export const failObjective = (country: CountryState, objectiveId: string): void => {
  const objective = country.objectives.find((entry) => entry.id === objectiveId);
  if (objective) objective.status = 'failed';
};

/** Drops stale finished objectives so saves and AI reads stay small. */
export const pruneObjectives = (country: CountryState, day: number): void => {
  country.objectives = country.objectives.filter(
    (objective) => objective.status === 'active' || day - objective.createdDay < 60,
  );
};

/** Highest-priority active objective, optionally filtered by kind. */
export const topObjective = (
  country: CountryState,
  kinds?: ObjectiveKind[],
): StrategicObjective | undefined => {
  let best: StrategicObjective | undefined;
  for (const objective of country.objectives) {
    if (objective.status !== 'active') continue;
    if (kinds && !kinds.includes(objective.kind)) continue;
    if (!best || objective.priority > best.priority) best = objective;
  }
  return best;
};

/** Clears army assignments that reference destroyed or missing armies. */
export const reconcileObjectives = (country: CountryState): void => {
  const armyIds = new Set(country.military.armies.map((army) => army.id));
  for (const objective of country.objectives) {
    if (objective.armyId && !armyIds.has(objective.armyId)) objective.armyId = null;
  }
};
