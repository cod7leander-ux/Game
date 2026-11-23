/**
 * Strategic objectives.
 *
 * Objectives are the bridge between high-level AI intent and army orders: the
 * director writes them, armies consume them, and the interface explains them.
 * They are plain data so they save, migrate and test trivially.
 */
export type ObjectiveKind =
  | 'defendCapital'
  | 'defendBorder'
  | 'captureRegion'
  | 'captureCapital'
  | 'secureResource'
  | 'protectIndustry'
  | 'reinforceAlly'
  | 'prepareInvasion'
  | 'recoverTerritory';

export type ObjectiveStatus = 'active' | 'completed' | 'failed';

export interface StrategicObjective {
  id: string;
  countryId: string;
  /** Army assigned to the objective, or null for a national objective. */
  armyId: string | null;
  kind: ObjectiveKind;
  /** 0..1 importance; higher wins when armies are assigned. */
  priority: number;
  targetCountryId: string | null;
  targetRegionId: string | null;
  createdDay: number;
  status: ObjectiveStatus;
  /** Short machine-readable reason, useful for tests and the AI inspector. */
  note: string;
}
