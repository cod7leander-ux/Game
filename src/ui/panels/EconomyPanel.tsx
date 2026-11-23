import { RESOURCES } from '../../data/resources';
import { localize } from '../../i18n/types';
import type { PlayerSnapshot } from '../../game/types';
import { useI18n } from '../hooks/useI18n';

export function EconomyPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, compact, signed, percent, locale, decimal } = useI18n();
  const country = snapshot.country;

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.economy')}</span>
          <h2>{tr('economy.gdp')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('economy.treasury')}</span>
          <strong>{compact(country.treasury)}</strong>
        </div>
      </header>

      <div className="metric-grid">
        <div className="metric">
          <span>{tr('economy.income')}</span>
          <strong className="is-positive">+{n(country.income)}</strong>
        </div>
        <div className="metric">
          <span>{tr('economy.expenses')}</span>
          <strong className="is-negative">−{n(country.expenses)}</strong>
        </div>
        <div className="metric">
          <span>{tr('economy.net')}</span>
          <strong className={country.netIncome >= 0 ? 'is-positive' : 'is-negative'}>
            {signed(Math.round(country.netIncome))}
          </strong>
        </div>
        <div className="metric">
          <span>{tr('economy.taxRate')}</span>
          <strong>{percent(country.taxRate)}</strong>
        </div>
      </div>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('economy.resources')}</h3>
          <span className="count">{snapshot.resources.length}</span>
        </header>
        <div className="resource-grid">
          {snapshot.resources.map((resource) => (
            <div key={resource.id} className="resource">
              <span className="resource__dot" style={{ background: resource.color }} />
              <div className="resource__body">
                <span className="resource__name">{resource.name}</span>
                <span className="resource__hint">
                  {localize(RESOURCES[resource.id].description, locale)}
                </span>
              </div>
              <strong className="resource__value">{compact(resource.amount)}</strong>
            </div>
          ))}
        </div>
      </section>

      <dl className="data-list">
        <div>
          <dt>{tr('economy.industry')}</dt>
          <dd>{decimal(country.industrialCapacity, 1)}</dd>
        </div>
        <div>
          <dt>{tr('research.points')}</dt>
          <dd>{decimal(country.researchOutput, 1)} {tr('common.perDay')}</dd>
        </div>
        <div>
          <dt>{tr('military.upkeep')}</dt>
          <dd>{decimal(snapshot.military.upkeep, 1)} {tr('common.perDay')}</dd>
        </div>
      </dl>

      <p className="hint">{tr('economy.productionHint')}</p>
    </div>
  );
}
