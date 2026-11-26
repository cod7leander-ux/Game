import { useState } from 'react';
import { COUNTRY_BY_ID } from '../../data/countries';
import { RESOURCES } from '../../data/resources';
import { TECHNOLOGIES } from '../../data/research';
import { UNIT_LIST, getUnit } from '../../data/units';
import { localize } from '../../i18n/types';
import type { MessageKey } from '../../i18n/locales/en';
import type { UnitDomain, UnitDefinition } from '../../gameplay/military/types';
import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

const DOMAIN_KEY: Record<UnitDomain, MessageKey> = {
  ground: 'military.domain.ground',
  air: 'military.domain.air',
  naval: 'military.domain.naval',
  support: 'military.domain.support',
};

const DOMAINS: UnitDomain[] = ['ground', 'air', 'naval', 'support'];

export function MilitaryPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, locale, n, compact, percent, decimal } = useI18n();
  const queueUnit = useAppStore((state) => state.queueUnit);
  const marchArmy = useAppStore((state) => state.marchArmy);
  const orderArmyMove = useAppStore((state) => state.orderArmyMove);
  const focusArmyCamera = useAppStore((state) => state.focusArmyCamera);
  const enterDirectControl = useAppStore((state) => state.enterDirectControl);
  const objectiveTarget = snapshot.objectives.find(
    (objective) => objective.status === 'active' && objective.target,
  )?.target;
  const [domain, setDomain] = useState<UnitDomain>('ground');
  const completed = new Set(snapshot.research.completed);
  const stockpile = new Map(snapshot.resources.map((resource) => [resource.id, resource.amount]));
  const counts = new Map(snapshot.military.formations.map((formation) => [formation.unitId, formation.count]));

  const affordable = (unit: UnitDefinition): boolean =>
    unit.cost.money <= (stockpile.get('money') ?? 0) &&
    unit.cost.steel <= (stockpile.get('steel') ?? 0) &&
    unit.cost.oil <= (stockpile.get('oil') ?? 0) &&
    unit.cost.electronics <= (stockpile.get('electronics') ?? 0) &&
    unit.cost.rare <= (stockpile.get('rare') ?? 0);

  const units = UNIT_LIST.filter((unit) => unit.domain === domain).sort((a, b) => a.tier - b.tier);

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.military')}</span>
          <h2>{tr('military.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('military.strength')}</span>
          <strong>{n(snapshot.country.strength)}</strong>
        </div>
      </header>

      {snapshot.country.occupierName && (
        <p className="hint">
          {tr('overview.occupied', { country: snapshot.country.occupierName })}
        </p>
      )}

      <div className="metric-grid">
        <div className="metric">
          <span>{tr('military.readiness')}</span>
          <strong>{percent(snapshot.military.readiness)}</strong>
        </div>
        <div className="metric">
          <span>{tr('military.formations')}</span>
          <strong>{n(snapshot.country.armyFormations)}</strong>
        </div>
        <div className="metric">
          <span>{tr('military.upkeep')}</span>
          <strong>{decimal(snapshot.military.upkeep, 1)}</strong>
        </div>
        <div className="metric">
          <span>{tr('military.manpower')}</span>
          <strong>{compact(snapshot.country.manpower * 1000)}</strong>
        </div>
      </div>

      <nav className="branch-tabs" aria-label={tr('military.domain.ground')}>
        {DOMAINS.map((entry) => (
          <button
            key={entry}
            type="button"
            className={domain === entry ? 'is-active' : ''}
            onClick={() => setDomain(entry)}
          >
            {tr(DOMAIN_KEY[entry])}
          </button>
        ))}
      </nav>

      <div className="unit-list">
        {units.map((unit) => {
          const locked = !unit.requiresTech.every((tech) => completed.has(tech));
          const requirement = unit.requiresTech
            .map((techId) => {
              const tech = TECHNOLOGIES.find((entry) => entry.id === techId);
              return tech ? localize(tech.name, locale) : techId;
            })
            .join(', ');
          const canPay = affordable(unit);
          return (
            <article key={unit.id} className={`unit-card ${locked ? 'is-locked' : ''}`}>
              <header>
                <div className="unit-card__title">
                  <h3>{localize(unit.name, locale)}</h3>
                  <span className="unit-card__tier">T{n(unit.tier)}</span>
                </div>
                <div className="unit-card__count">
                  <span>{tr('military.formations')}</span>
                  <strong>{n(counts.get(unit.id) ?? 0)}</strong>
                </div>
              </header>
              <div className="unit-card__stats">
                <span>
                  {tr('military.attack')} <strong>{n(unit.stats.attack)}</strong>
                </span>
                <span>
                  {tr('military.defence')} <strong>{n(unit.stats.defence)}</strong>
                </span>
                <span>
                  {tr('military.range')} <strong>{n(unit.stats.range)}</strong>
                </span>
              </div>
              <div className="unit-card__cost">
                <span>
                  {localize(RESOURCES.money.short, locale)} {n(unit.cost.money)}
                </span>
                <span>
                  {localize(RESOURCES.steel.short, locale)} {n(unit.cost.steel)}
                </span>
                <span>
                  {localize(RESOURCES.oil.short, locale)} {n(unit.cost.oil)}
                </span>
                <span>{tr('military.buildTime', { days: n(unit.buildDays) })}</span>
              </div>
              {locked ? (
                <span className="chip chip--muted">{tr('military.requires', { tech: requirement })}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={!canPay}
                  onClick={() => queueUnit(unit.id)}
                  title={canPay ? tr('military.recruit') : tr('military.insufficient')}
                >
                  {tr('military.recruit')}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('military.armies')}</h3>
          <span className="count">{n(snapshot.armies.length)}</span>
        </header>
        {snapshot.armies.length === 0 ? (
          <p className="muted">{tr('military.noArmies')}</p>
        ) : (
          <div className="army-list">
            {snapshot.armies.map((army) => (
              <article key={army.id} className={`army-card ${army.movement ? 'is-marching' : ''}`}>
                <header className="army-card__header">
                  <div>
                    <h4>{tr('military.armyName', { n: n(army.ordinal) })}</h4>
                    <span className="army-card__location">
                      {army.movement ? army.movement.toName : army.locationName}
                    </span>
                  </div>
                  <div className="army-card__strength">
                    <span>{tr('military.strength')}</span>
                    <strong>{n(army.strength)}</strong>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => {
                        const anchor = COUNTRY_BY_ID[army.locationId];
                        if (anchor) focusArmyCamera(anchor.label[0], anchor.label[1]);
                      }}
                    >
                      {tr('military.focusArmy')}
                    </button>
                  </div>
                </header>

                <div className="army-card__units">
                  {army.composition.slice(0, 4).map((entry) => (
                    <button
                      key={entry.unitId}
                      type="button"
                      className="army-chip army-chip--control"
                      title={tr('direct.takeControl')}
                      onClick={() => enterDirectControl(army.id, entry.unitId)}
                    >
                      {n(entry.count)}× {entry.name}
                    </button>
                  ))}
                  {army.composition.length > 4 && (
                    <span className="army-chip army-chip--more">
                      +{n(army.composition.length - 4)}
                    </span>
                  )}
                </div>
                <p className="army-card__hint muted">{tr('military.directHint')}</p>

                {army.route.length > 0 && (
                  <p className="hint">
                    {tr('military.routePending', { count: n(army.route.length) })}
                  </p>
                )}
                {!army.movement && objectiveTarget && (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() =>
                      orderArmyMove(
                        army.id,
                        objectiveTarget.regionId ?? objectiveTarget.countryId ?? '',
                      )
                    }
                  >
                    {tr('military.followObjective')}
                  </button>
                )}

                {army.movement ? (
                  <div className="army-card__march">
                    <span>{tr('military.arrivesIn', { days: n(army.movement.daysRemaining) })}</span>
                    <div className="meter meter--cyan">
                      <span style={{ width: `${Math.round(army.movement.progress * 100)}%` }} />
                    </div>
                  </div>
                ) : army.targets.length > 0 ? (
                  <div className="army-card__targets">
                    <span className="army-card__label">{tr('military.armyTargets')}</span>
                    {army.targets.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        className={`btn btn--small ${target.atWar ? 'btn--danger' : ''}`}
                        onClick={() => marchArmy(army.id, target.id)}
                        title={
                          target.atWar
                            ? tr('diplomacy.status.war')
                            : target.ally
                              ? tr('diplomacy.status.ally')
                              : undefined
                        }
                      >
                        {target.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="army-card__hint muted">{tr('military.noTargets')}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('military.queue')}</h3>
          <span className="count">{snapshot.military.queue.length}</span>
        </header>
        {snapshot.military.queue.length === 0 ? (
          <p className="muted">{tr('military.queueEmpty')}</p>
        ) : (
          <ul className="queue-list">
            {snapshot.military.queue.map((order) => (
              <li key={order.orderId}>
                <div className="queue-list__header">
                  <span>{order.name}</span>
                  <em>{tr('military.buildTime', { days: n(order.daysRemaining) })}</em>
                </div>
                <div className="meter meter--cyan">
                  <span style={{ width: `${Math.round(order.progress * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('military.formations')}</h3>
          <span className="count">{snapshot.military.formations.length}</span>
        </header>
        <div className="formation-grid">
          {snapshot.military.formations.map((formation) => {
            const unit = getUnit(formation.unitId);
            return (
              <div key={formation.unitId} className="formation">
                <span className="formation__count">{n(formation.count)}×</span>
                <span className="formation__name">
                  {unit ? localize(unit.name, locale) : formation.unitId}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
