import type { PlayerSnapshot } from '../../game/types';
import type { MessageKey } from '../../i18n/locales/en';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * Province inspector.
 *
 * The list is the authoritative way to select a region: it works at any camera
 * distance and on small screens, while the map markers show where the selected
 * province is. Region state is data, so a future polygon map can replace the
 * markers without touching this panel.
 */
export function TerritoryPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, percent, decimal, compact } = useI18n();
  const selectRegion = useAppStore((state) => state.selectRegion);
  const focusCountryCamera = useAppStore((state) => state.focusCountryCamera);
  const selected = snapshot.regions.find((region) => region.selected) ?? snapshot.regions[0];

  const inspect = (regionId: string) => {
    selectRegion(regionId);
    focusCountryCamera(snapshot.country.id);
  };

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.territory')}</span>
          <h2>{tr('territory.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('overview.regions')}</span>
          <strong>{n(snapshot.regions.length)}</strong>
        </div>
      </header>

      <div className="region-list">
        {snapshot.regions.map((region) => (
          <button
            key={region.id}
            type="button"
            className={`region-row ${region.selected ? 'is-active' : ''}`}
            onClick={() => inspect(region.id)}
          >
            <span className="region-row__dot" style={{ background: region.terrainColor }} />
            <span className="region-row__name">
              {region.name}
              {region.isCapital && <em className="chip chip--muted">{tr('territory.capital')}</em>}
            </span>
            <span className="region-row__terrain">{region.terrain}</span>
            <span className="region-row__value">{percent(region.strategicValue)}</span>
          </button>
        ))}
      </div>

      {selected ? (
        <section className="sub-section">
          <header className="sub-section__header">
            <h3>{selected.name}</h3>
            <span className="chip">{selected.terrain}</span>
          </header>

          <div className="meter-block">
            <div className="meter-row">
              <span>{tr('territory.infrastructure')}</span>
              <div className="meter meter--cyan">
                <span style={{ width: `${Math.round(selected.infrastructure * 100)}%` }} />
              </div>
              <em>{percent(selected.infrastructure)}</em>
            </div>
            <div className="meter-row">
              <span>{tr('territory.unrest')}</span>
              <div className="meter meter--amber">
                <span style={{ width: `${Math.round(selected.unrest * 100)}%` }} />
              </div>
              <em>{percent(selected.unrest)}</em>
            </div>
            <div className="meter-row">
              <span>{tr('territory.damage')}</span>
              <div className="meter meter--red">
                <span style={{ width: `${Math.round(selected.damage * 100)}%` }} />
              </div>
              <em>{percent(selected.damage)}</em>
            </div>
          </div>

          <dl className="data-list">
            <div>
              <dt>{tr('territory.population')}</dt>
              <dd>{compact(selected.population)}</dd>
            </div>
            <div>
              <dt>{tr('territory.strategicValue')}</dt>
              <dd>{percent(selected.strategicValue)}</dd>
            </div>
            <div>
              <dt>{tr('territory.control')}</dt>
              <dd>{tr(`territory.control.${selected.control}` as MessageKey)}</dd>
            </div>
            <div>
              <dt>{tr('territory.port')}</dt>
              <dd>{selected.hasPort ? tr('common.active') : '—'}</dd>
            </div>
            <div>
              <dt>{tr('territory.airport')}</dt>
              <dd>{selected.hasAirport ? tr('common.active') : '—'}</dd>
            </div>
          </dl>

          {selected.output.length > 0 && (
            <>
              <h4 className="sub-title">{tr('territory.output')}</h4>
              <div className="project-card__cost">
                {selected.output.map((entry) => (
                  <span key={entry.id} className="chip">
                    {entry.name} {decimal(entry.amount, 2)}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <p className="muted">{tr('territory.none')}</p>
      )}

      <p className="hint">{tr('territory.subtitle')}</p>
    </div>
  );
}
