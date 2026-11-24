import type { PlayerSnapshot } from '../../game/types';
import type { MessageKey } from '../../i18n/locales/en';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * Region inspector.
 *
 * Shows the province selected on the map — including foreign occupied or allied
 * territory — with terrain, owner, population, industry, resources, supply,
 * cities, airports, ports, neighbours and military presence. The list remains
 * the accessible way to select a home province at any camera distance.
 */
export function TerritoryPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, percent, decimal, compact } = useI18n();
  const selectRegion = useAppStore((state) => state.selectRegion);
  const focusRegionCamera = useAppStore((state) => state.focusRegionCamera);
  const selected =
    snapshot.inspectedRegion ??
    snapshot.regions.find((region) => region.selected) ??
    snapshot.regions[0];

  const inspect = (regionId: string) => {
    selectRegion(regionId);
    focusRegionCamera(regionId);
  };

  const isForeign = selected ? selected.countryId !== snapshot.country.id : false;

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
            {selected.isCapital && <span className="chip chip--muted">{tr('territory.capital')}</span>}
          </header>

          {isForeign && (
            <p className="hint">{tr('territory.foreign', { owner: selected.ownerName })}</p>
          )}

          <dl className="data-list">
            <div>
              <dt>{tr('territory.owner')}</dt>
              <dd>{selected.ownerName}</dd>
            </div>
            <div>
              <dt>{tr('territory.population')}</dt>
              <dd>{compact(selected.population)}</dd>
            </div>
            <div>
              <dt>{tr('territory.industry')}</dt>
              <dd>{percent(selected.industryShare)}</dd>
            </div>
            <div>
              <dt>{tr('territory.strategicValue')}</dt>
              <dd>{percent(selected.strategicValue)}</dd>
            </div>
            <div>
              <dt>{tr('territory.control')}</dt>
              <dd>{tr(`territory.control.${selected.control}` as MessageKey)}</dd>
            </div>
            {selected.occupiedBy && (
              <div>
                <dt>{tr('territory.occupied')}</dt>
                <dd>{selected.occupiedBy}</dd>
              </div>
            )}
            <div>
              <dt>{tr('territory.supply')}</dt>
              <dd>{percent(selected.supplyLevel)}</dd>
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

          <div className="meter-block">
            <div className="meter-row">
              <span>{tr('territory.infrastructure')}</span>
              <div className="meter meter--cyan">
                <span style={{ width: `${Math.round(selected.infrastructure * 100)}%` }} />
              </div>
              <em>{percent(selected.infrastructure)}</em>
            </div>
            <div className="meter-row">
              <span>{tr('territory.supply')}</span>
              <div className="meter meter--green">
                <span style={{ width: `${Math.round(selected.supplyLevel * 100)}%` }} />
              </div>
              <em>{percent(selected.supplyLevel)}</em>
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

          <button type="button" className="button button--ghost" onClick={() => focusRegionCamera(selected.id)}>
            {tr('territory.inspectOnMap')}
          </button>

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

          <h4 className="sub-title">{tr('territory.cities')}</h4>
          {selected.cities.length === 0 ? (
            <p className="muted">{tr('territory.noCities')}</p>
          ) : (
            <ul className="alert-list">
              {selected.cities.map((city) => (
                <li key={city.id}>
                  {city.name}
                  <span className="muted">
                    {' '}
                    · {compact(city.population)}
                    {city.hasAirport ? ` · ${tr('territory.airport')}` : ''}
                    {city.hasPort ? ` · ${tr('territory.port')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(selected.airports.length > 0 || selected.ports.length > 0) && (
            <>
              <h4 className="sub-title">{tr('territory.infrastructurePoints')}</h4>
              <div className="project-card__cost">
                {selected.airports.map((airport) => (
                  <span key={airport.id} className="chip">
                    {airport.name} · L{n(airport.level)}
                  </span>
                ))}
                {selected.ports.map((port) => (
                  <span key={port.id} className="chip">
                    {port.name} · L{n(port.level)}
                  </span>
                ))}
              </div>
            </>
          )}

          {selected.armies.length > 0 && (
            <>
              <h4 className="sub-title">{tr('territory.armies')}</h4>
              <ul className="alert-list">
                {selected.armies.map((army) => (
                  <li key={army.id}>
                    {army.name} · {n(army.units)} {tr('military.formations')}
                  </li>
                ))}
              </ul>
            </>
          )}

          {selected.neighbours.length > 0 && (
            <>
              <h4 className="sub-title">{tr('territory.neighbours')}</h4>
              <p className="muted">{selected.neighbours.join(' · ')}</p>
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
