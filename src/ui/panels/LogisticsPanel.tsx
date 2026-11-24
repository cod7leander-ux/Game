import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * Supply and strategic objectives.
 *
 * Supply is shown per army with its source, because the interesting decision is
 * whether a force can keep operating where it stands. Objectives explain what
 * the AI (or the player's own plan) is trying to achieve.
 */
export function LogisticsPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, percent } = useI18n();
  const focusRegionCamera = useAppStore((state) => state.focusRegionCamera);
  const focusArmyCamera = useAppStore((state) => state.focusArmyCamera);
  const supply = snapshot.logistics;

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.logistics')}</span>
          <h2>{tr('logistics.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('logistics.averageSupply')}</span>
          <strong className={supply.averageSupply < 0.45 ? 'is-negative' : 'is-positive'}>
            {percent(supply.averageSupply)}
          </strong>
        </div>
      </header>

      <div className="metric-grid">
        <div className="metric">
          <span>{tr('logistics.supplyHubs')}</span>
          <strong>{n(supply.supplyHubs)}</strong>
        </div>
        <div className="metric">
          <span>{tr('logistics.armies')}</span>
          <strong>{n(supply.armies.length)}</strong>
        </div>
        <div className="metric">
          <span>{tr('overview.objectives')}</span>
          <strong>{n(snapshot.objectives.filter((entry) => entry.status === 'active').length)}</strong>
        </div>
      </div>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('logistics.armies')}</h3>
        </header>
        {supply.armies.length === 0 ? (
          <p className="muted">{tr('logistics.noArmies')}</p>
        ) : (
          <ul className="stack-list">
            {supply.armies.map((army) => (
              <li key={army.id}>
                <div className="stack-list__row">
                  <strong>{tr('military.armyName', { n: army.ordinal })}</strong>
                  <span className={army.supply < 0.45 ? 'is-negative' : 'is-positive'}>
                    {percent(army.supply)}
                  </span>
                </div>
                <div className="meter meter--green">
                  <span style={{ width: `${Math.round(army.supply * 100)}%` }} />
                </div>
                <span className="muted">
                  {tr('logistics.source')}: {army.sourceName ?? tr('logistics.unsupported')}
                  {army.daysLowSupply > 0
                    ? ` · ${tr('logistics.lowSupply', { days: n(army.daysLowSupply) })}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('logistics.objectives')}</h3>
          <span className="count">{snapshot.objectives.length}</span>
        </header>
        {snapshot.objectives.length === 0 ? (
          <p className="muted">{tr('logistics.noObjectives')}</p>
        ) : (
          <ul className="stack-list">
            {snapshot.objectives.map((objective) => (
              <li key={objective.id}>
                <div className="stack-list__row">
                  <strong>{objective.kind}</strong>
                  <span className={`chip ${objective.status === 'completed' ? 'chip--green' : ''}`}>
                    {tr(`objective.status.${objective.status}` as never)}
                  </span>
                </div>
                <span className="muted">
                  {objective.targetName ?? '—'} · {percent(objective.priority)}
                </span>
                {objective.target && (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                      const target = objective.target;
                      if (!target) return;
                      if (target.regionId) focusRegionCamera(target.regionId);
                      else focusArmyCamera(target.lon, target.lat);
                    }}
                  >
                    {tr('territory.inspectOnMap')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="hint">{tr('logistics.subtitle')}</p>
    </div>
  );
}
