import type { MessageKey } from '../../i18n/locales/en';
import type { PlayerSnapshot } from '../../game/types';
import { useI18n } from '../hooks/useI18n';

/** Reconnaissance, radar and foreign contacts. */
export function IntelPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, percent } = useI18n();
  const intel = snapshot.intelligence;

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.intel')}</span>
          <h2>{tr('intel.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('intel.confidence')}</span>
          <strong>{percent(intel.confidence)}</strong>
        </div>
      </header>

      <p className="hint">{tr('intel.subtitle')}</p>

      <div className="meter-block">
        {[
          ['intel.coverage', intel.coverage, 'meter--cyan'],
          ['intel.confidence', intel.confidence, 'meter--green'],
          ['intel.detection', intel.detection, 'meter'],
          ['intel.radar', intel.radarCoverage, 'meter--amber'],
        ].map(([key, value, tone]) => (
          <div key={key as string} className="meter-row">
            <span>{tr(key as MessageKey)}</span>
            <div className={`meter ${tone as string}`}>
              <span style={{ width: `${Math.round(Number(value) * 100)}%` }} />
            </div>
            <em>{percent(Number(value))}</em>
          </div>
        ))}
      </div>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('intel.contacts')}</h3>
          <span className="count">{n(intel.contacts.length)}</span>
        </header>
        {intel.contacts.length === 0 ? (
          <p className="muted">{tr('intel.noContacts')}</p>
        ) : (
          <ul className="stack-list">
            {intel.contacts.map((contact) => (
              <li key={contact.countryId}>
                <div className="stack-list__row">
                  <strong>{contact.name}</strong>
                  <span className={contact.confidence < 0.4 ? 'is-negative' : 'is-positive'}>
                    {percent(contact.confidence)}
                  </span>
                </div>
                <div className="war-card__stats">
                  <span>{tr('intel.army')} {n(contact.estimatedArmyStrength)}</span>
                  <span>{tr('intel.navy')} {n(contact.estimatedNavalStrength)}</span>
                  <span>{tr('intel.air')} {n(contact.estimatedAirStrength)}</span>
                  <span>{tr('intel.formations')} {n(contact.detectedFormations)}</span>
                </div>
                <span className="muted">
                  {tr(`intel.source.${contact.source}` as MessageKey)} · {tr('intel.lastSeen')}{' '}
                  {tr('common.day')} {n(contact.lastSeenDay)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
