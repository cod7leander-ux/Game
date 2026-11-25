import type { PlayerSnapshot } from '../../game/types';
import type { MessageKey } from '../../i18n/locales/en';
import { useI18n } from '../hooks/useI18n';

export function OverviewPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, compact, percent, decimal, signed } = useI18n();
  const country = snapshot.country;

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.overview')}</span>
          <h2>{tr('overview.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('overview.armyStrength')}</span>
          <strong>{n(country.strength)}</strong>
        </div>
      </header>

      <div className="diplomacy-summary">
        <div>
          <span>{tr('society.population')}</span>
          <strong>{compact(snapshot.society.population)}</strong>
        </div>
        <div>
          <span>{tr('society.manpowerPool')}</span>
          <strong>{compact(snapshot.society.manpowerPool * 1000)}</strong>
        </div>
        <div>
          <span>{tr('trade.routes')}</span>
          <strong>{n(snapshot.trade.routes.length)}</strong>
        </div>
        <div>
          <span>{tr('situation.active')}</span>
          <strong>{n(snapshot.situations.filter((entry) => entry.active).length)}</strong>
        </div>
      </div>

      <dl className="data-list">
        <div>
          <dt>{tr('overview.government')}</dt>
          <dd>{country.governmentName}</dd>
        </div>
        <div>
          <dt>{tr('overview.trait')}</dt>
          <dd>{country.personalityName}</dd>
        </div>
        <div>
          <dt>{tr('overview.focus')}</dt>
          <dd>{tr(`focus.${country.focus}` as MessageKey)}</dd>
        </div>
        <div>
          <dt>{tr('overview.techLevel')}</dt>
          <dd>{decimal(country.techLevel, 1)}</dd>
        </div>
        <div>
          <dt>{tr('overview.industry')}</dt>
          <dd>{decimal(country.industrialCapacity, 1)}</dd>
        </div>
        <div>
          <dt>{tr('overview.regions')}</dt>
          <dd>{n(country.regionCount)}</dd>
        </div>
        <div>
          <dt>{tr('overview.objectives')}</dt>
          <dd>{n(snapshot.objectives.filter((entry) => entry.status === 'active').length)}</dd>
        </div>
        <div>
          <dt>{tr('overview.income')}</dt>
          <dd className={country.netIncome >= 0 ? 'is-positive' : 'is-negative'}>
            {signed(Math.round(country.netIncome))} {tr('common.perDay')}
          </dd>
        </div>
      </dl>

      <div className="meter-block">
        <div className="meter-row">
          <span>{tr('overview.stability')}</span>
          <div className="meter">
            <span style={{ width: `${Math.round(country.stability * 100)}%` }} />
          </div>
          <em>{percent(country.stability)}</em>
        </div>
        <div className="meter-row">
          <span>{tr('military.readiness')}</span>
          <div className="meter meter--green">
            <span style={{ width: `${Math.round(snapshot.military.readiness * 100)}%` }} />
          </div>
          <em>{percent(snapshot.military.readiness)}</em>
        </div>
        <div className="meter-row">
          <span>{tr('overview.unrest')}</span>
          <div className="meter meter--amber">
            <span style={{ width: `${Math.round(country.unrest * 100)}%` }} />
          </div>
          <em>{percent(country.unrest)}</em>
        </div>
        <div className="meter-row">
          <span>{tr('overview.warExhaustion')}</span>
          <div className="meter meter--red">
            <span style={{ width: `${Math.round(country.warExhaustion * 100)}%` }} />
          </div>
          <em>{percent(country.warExhaustion)}</em>
        </div>
        <div className="meter-row">
          <span>{tr('research.current')}</span>
          <div className="meter meter--cyan">
            <span style={{ width: `${Math.round(snapshot.research.ratio * 100)}%` }} />
          </div>
          <em>{percent(snapshot.research.ratio)}</em>
        </div>
      </div>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('overview.warnings')}</h3>
          <span className="count">{snapshot.warnings.length}</span>
        </header>
        {snapshot.warnings.length === 0 ? (
          <p className="muted">{tr('overview.noWarnings')}</p>
        ) : (
          <ul className="alert-list">
            {snapshot.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('situation.title')}</h3>
          <span className="count">
            {snapshot.situations.filter((entry) => entry.active).length}
          </span>
        </header>
        {snapshot.situations.length === 0 ? (
          <p className="muted">{tr('situation.none')}</p>
        ) : (
          <ul className="stack-list">
            {snapshot.situations.map((entry) => (
              <li key={entry.id}>
                <div className="stack-list__row">
                  <strong>{entry.name}</strong>
                  <span className={`chip ${entry.active ? 'chip--danger' : 'chip--muted'}`}>
                    {tr(`situation.severity.${entry.severity}` as MessageKey)}
                  </span>
                </div>
                <p className="muted">{entry.description}</p>
                <span className="muted">
                  {entry.active
                    ? tr('situation.ends', { day: n(entry.endDay) })
                    : `${tr('common.day')} ${n(entry.startDay)} → ${n(entry.endDay)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('notifications.title')}</h3>
          <span className="count">{snapshot.notifications.length}</span>
        </header>
        {snapshot.notifications.length === 0 ? (
          <p className="muted">{tr('notifications.empty')}</p>
        ) : (
          <ul className="dispatch-list">
            {snapshot.notifications
              .slice(-4)
              .reverse()
              .map((entry) => (
                <li key={entry.id} className={`dispatch dispatch--${entry.severity}`}>
                  <span className="dispatch__day">{tr('common.day')} {n(entry.day)}</span>
                  <span className="dispatch__text">{entry.message}</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      <div className="stat-strip">
        <div>
          <span>{tr('hud.manpower')}</span>
          <strong>{compact(country.manpower * 1000)}</strong>
        </div>
        <div>
          <span>{tr('economy.treasury')}</span>
          <strong>{compact(country.treasury)}</strong>
        </div>
        <div>
          <span>{tr('hud.army')}</span>
          <strong>{n(country.armyFormations)}</strong>
        </div>
      </div>
    </div>
  );
}
