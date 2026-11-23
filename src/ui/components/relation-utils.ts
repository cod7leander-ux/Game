import type { DiplomacyView } from '../../game/types';
import type { RelationSummary } from './CountryDossier';

export const relationStatusOf = (view: DiplomacyView): RelationSummary => ({
  status: view.status,
  value: view.value,
  atWar: view.atWar,
  ally: view.ally,
  trade: view.trade,
});
