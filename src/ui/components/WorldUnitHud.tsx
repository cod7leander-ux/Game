import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';
import { Flag } from './Flag';
import './direct-control.css';

const DOMAIN_KEY = {
  air: 'direct.domain.air',
  ground: 'direct.domain.ground',
  naval: 'direct.domain.naval',
} as const;

/**
 * Selected world unit card.
 *
 * Selecting a 3D unit token on the globe opens this compact card; taking control
 * hands the same unit to the direct-control layer without touching its
 * strategic army.
 */
export function WorldUnitHud({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, percent } = useI18n();
  const unit = snapshot.selectedMapUnit;
  const enterDirectControl = useAppStore((state) => state.enterDirectControl);
  const selectMapUnit = useAppStore((state) => state.selectMapUnit);
  const focusArmyCamera = useAppStore((state) => state.focusArmyCamera);

  if (!unit || snapshot.direct) return null;

  return (
    <aside className="world-unit-hud panel" dir="auto">
      <div className="world-unit-hud__head">
        <Flag iso2={snapshot.country.iso2} seed={snapshot.country.id} size={20} />
        <div>
          <span className="eyebrow">{tr('worldUnit.title')}</span>
          <h4>{unit.name}</h4>
          <span className="world-unit-hud__meta">
            {unit.armyName} · {unit.countryName}
          </span>
        </div>
        <button
          type="button"
          className="world-unit-hud__close"
          onClick={() => selectMapUnit(null)}
          aria-label={tr('common.close')}
        >
          ×
        </button>
      </div>
      <dl className="world-unit-hud__stats">
        <div>
          <dt>{tr('worldUnit.type')}</dt>
          <dd>{tr(DOMAIN_KEY[unit.domain])}</dd>
        </div>
        <div>
          <dt>{tr('direct.health')}</dt>
          <dd>{percent(unit.health)}</dd>
        </div>
      </dl>
      <div className="world-unit-hud__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => enterDirectControl(unit.armyId, unit.unitId)}
        >
          {tr('direct.takeControl')}
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => focusArmyCamera(unit.lon, unit.lat)}
        >
          {tr('worldUnit.focus')}
        </button>
      </div>
      <p className="world-unit-hud__hint">{tr('direct.selectHint')}</p>
    </aside>
  );
}
