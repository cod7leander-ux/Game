import { useState } from 'react';
import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * Industry panel: budget split, construction queue and the project catalogue.
 * Every number comes from the snapshot; every action goes through the store.
 */
export function ProductionPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, percent, decimal } = useI18n();
  const startConstruction = useAppStore((state) => state.startConstruction);
  const cancelConstruction = useAppStore((state) => state.cancelConstruction);
  const setConstructionPriority = useAppStore((state) => state.setConstructionPriority);
  const setAllocation = useAppStore((state) => state.setAllocation);
  const [regionId, setRegionId] = useState(snapshot.regions[0]?.id ?? '');
  const allocation = snapshot.country.allocation;

  const adjust = (key: 'military' | 'infrastructure' | 'research', value: number) => {
    const next = { ...allocation, [key]: value / 100 };
    setAllocation(next);
  };

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.production')}</span>
          <h2>{tr('production.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('production.completed')}</span>
          <strong>{n(snapshot.production.completedProjects)}</strong>
        </div>
      </header>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('production.allocation')}</h3>
        </header>
        <div className="allocation">
          {(
            [
              ['military', 'production.militaryShare'],
              ['infrastructure', 'production.infrastructureShare'],
              ['research', 'production.researchShare'],
            ] as const
          ).map(([key, labelKey]) => (
            <label key={key} className="allocation__row">
              <span>{tr(labelKey)}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(allocation[key] * 100)}
                onChange={(event) => adjust(key, Number(event.target.value))}
              />
              <em>{percent(allocation[key])}</em>
            </label>
          ))}
        </div>
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('production.queue')}</h3>
          <span className="count">{snapshot.production.construction.length}</span>
        </header>
        {snapshot.production.construction.length === 0 ? (
          <p className="muted">{tr('production.emptyQueue')}</p>
        ) : (
          <ul className="stack-list">
            {snapshot.production.construction.map((order) => (
              <li key={order.id}>
                <div className="stack-list__row">
                  <strong>{order.projectName}</strong>
                  <span>{tr('production.days', { days: n(order.daysRemaining) })}</span>
                </div>
                <span className="muted">{order.regionName}</span>
                <div className="meter meter--cyan">
                  <span style={{ width: `${Math.round(order.progress * 100)}%` }} />
                </div>
                <div className="army-card__targets">
                  {(['low', 'normal', 'high'] as const).map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      className={`btn btn--small ${order.priority === priority ? 'btn--primary' : ''}`}
                      onClick={() => setConstructionPriority(order.id, priority)}
                    >
                      {tr(`construction.priority.${priority}`)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => cancelConstruction(order.id)}
                  >
                    {tr('construction.cancel')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('production.projects')}</h3>
          {snapshot.regions.length > 1 && (
            <select
              className="select"
              value={regionId}
              onChange={(event) => setRegionId(event.target.value)}
              aria-label={tr('production.region')}
            >
              {snapshot.regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          )}
        </header>
        <div className="stack-list">
          {snapshot.production.projects.map((project) => (
            <article key={project.id} className="project-card">
              <div className="stack-list__row">
                <strong>{project.name}</strong>
                <span>{tr('production.days', { days: n(project.days) })}</span>
              </div>
              <p className="muted">{project.description}</p>
              <div className="project-card__cost">
                {project.cost.map((entry) => (
                  <span
                    key={entry.id}
                    className={`chip ${entry.enough ? '' : 'chip--danger'}`}
                    title={entry.name}
                  >
                    {entry.name} {n(entry.amount)}
                  </span>
                ))}
              </div>
              {project.locked.length > 0 && (
                <span className="chip chip--muted">
                  {tr('production.requires', { tech: project.locked.join(', ') })}
                </span>
              )}
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={!project.available}
                onClick={() => startConstruction(project.id, regionId || snapshot.regions[0]?.id || '')}
              >
                {tr('production.start')}
              </button>
            </article>
          ))}
        </div>
        <p className="hint">{tr('production.subtitle')}</p>
      </section>

      <dl className="data-list">
        <div>
          <dt>{tr('economy.industry')}</dt>
          <dd>
            {decimal(snapshot.country.industrialCapacity, 1)} ·{' '}
            {tr('production.infrastructureShare')} {percent(allocation.infrastructure)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
