import type { MessageKey } from '../../i18n/locales/en';
import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/** National policies and mobilisation. Open-ended modifiers, not objectives. */
export function PoliciesPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, percent, signed } = useI18n();
  const setPolicy = useAppStore((state) => state.setPolicy);
  const setMobilization = useAppStore((state) => state.setMobilization);
  const policies = snapshot.policies;
  const active = policies.available.filter((policy) => policy.active);
  const available = policies.available.filter((policy) => !policy.active);

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.policies')}</span>
          <h2>{tr('policy.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('policy.slots', { used: n(policies.slots), max: n(policies.maxSlots) })}</span>
          <strong>{percent(snapshot.country.stability)}</strong>
        </div>
      </header>

      <p className="hint">{tr('policy.subtitle')}</p>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('policy.mobilization')}</h3>
          <span className="count">{percent(policies.mobilization)}</span>
        </header>
        <label className="allocation__row">
          <span>{tr('society.mobilization')}</span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(policies.mobilization * 100)}
            onChange={(event) => setMobilization(Number(event.target.value) / 100)}
          />
          <em>{percent(policies.mobilization)}</em>
        </label>
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('policy.active')}</h3>
          <span className="count">{active.length}</span>
        </header>
        {active.length === 0 ? (
          <p className="muted">{tr('policy.none')}</p>
        ) : (
          <ul className="stack-list">
            {active.map((policy) => (
              <li key={policy.id}>
                <div className="stack-list__row">
                  <strong>{policy.name}</strong>
                  <span className="chip">{tr(`policy.category.${policy.category}` as MessageKey)}</span>
                </div>
                <p className="muted">{policy.description}</p>
                <span className="muted">
                  {tr('policy.upkeep')} {signed(policy.upkeep)} · {tr('policy.politicalCost')}{' '}
                  {percent(policy.politicalCost)}
                </span>
                <button type="button" className="btn btn--small" onClick={() => setPolicy(policy.id, false)}>
                  {tr('policy.repeal')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('research.available')}</h3>
        </header>
        <ul className="stack-list">
          {available.map((policy) => (
            <li key={policy.id}>
              <div className="stack-list__row">
                <strong>{policy.name}</strong>
                <span className="chip">{tr(`policy.category.${policy.category}` as MessageKey)}</span>
              </div>
              <p className="muted">{policy.description}</p>
              <div className="war-card__stats">
                {policy.effects.map((effect) => (
                  <span key={effect}>{effect}</span>
                ))}
              </div>
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={policies.slots >= policies.maxSlots}
                onClick={() => setPolicy(policy.id, true)}
              >
                {tr('policy.enact')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
