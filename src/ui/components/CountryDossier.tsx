import type { ReactNode } from 'react';
import { getGovernment } from '../../data/governments';
import { PERSONALITIES } from '../../data/personalities';
import { localize } from '../../i18n/types';
import type { MessageKey } from '../../i18n/locales/en';
import type { RelationStatus } from '../../gameplay/diplomacy/types';
import type { CountryBrief } from '../../game/types';
import { useI18n } from '../hooks/useI18n';
import { Flag } from './Flag';

export interface RelationSummary {
  status: RelationStatus;
  value: number;
  atWar: boolean;
  ally: boolean;
  trade: boolean;
}

interface CountryDossierProps {
  brief: CountryBrief;
  relation?: RelationSummary;
  isPlayer?: boolean;
  children?: ReactNode;
  compactHeader?: boolean;
}

/** Shared national dossier used by the selector and the in-game inspector. */
export function CountryDossier({ brief, relation, isPlayer, children, compactHeader }: CountryDossierProps) {
  const { t: tr, locale, n, compact, percent, decimal, signed } = useI18n();
  const { definition, state } = brief;
  const government = getGovernment(state.governmentId);
  const personality = PERSONALITIES[state.ai.personalityId] ?? PERSONALITIES.balanced;
  const name = localize(definition.name, locale);

  return (
    <article className="dossier">
      <header className={`dossier__header ${compactHeader ? 'is-compact' : ''}`}>
        <Flag iso2={definition.iso2} seed={definition.id} size={compactHeader ? 30 : 42} title={name} />
        <div className="dossier__identity">
          <h2 className="dossier__name">{name}</h2>
          <span className="dossier__meta">
            {definition.iso2 ?? definition.id} · {definition.continent}
          </span>
        </div>
        <div className="dossier__badges">
          {isPlayer && <span className="chip chip--gold">{tr('country.player')}</span>}
          <span className={`chip chip--strength strength-${brief.strengthClass}`}>
            {tr(`country.strength.${brief.strengthClass}` as MessageKey)}
          </span>
        </div>
      </header>

      <div className="dossier__grid">
        <div className="dossier__stat">
          <span className="label">{tr('nation.population')}</span>
          <strong>{compact(state.population)}</strong>
        </div>
        <div className="dossier__stat">
          <span className="label">{tr('nation.gdp')}</span>
          <strong>{compact(state.economy.gdp)}</strong>
          <span className="sub">{tr('units.credits')}</span>
        </div>
        <div className="dossier__stat">
          <span className="label">{tr('nation.capital')}</span>
          <strong>{brief.capital ? localize(brief.capital.name, locale) : tr('common.unknown')}</strong>
        </div>
        <div className="dossier__stat">
          <span className="label">{tr('overview.armyStrength')}</span>
          <strong>{n(state.military.strengthIndex)}</strong>
        </div>
        <div className="dossier__stat dossier__stat--wide">
          <span className="label">{tr('overview.government')}</span>
          <strong>{localize(government.name, locale)}</strong>
          <span className="sub">{localize(government.description, locale)}</span>
        </div>
        <div className="dossier__stat dossier__stat--wide">
          <span className="label">{tr('nation.personality')}</span>
          <strong>{localize(personality.name, locale)}</strong>
          <span className="sub">{localize(personality.description, locale)}</span>
        </div>
      </div>

      <div className="dossier__meters">
        <div className="meter-row">
          <span>{tr('overview.stability')}</span>
          <div className="meter">
            <span style={{ width: `${Math.round(state.stability * 100)}%` }} />
          </div>
          <em>{percent(state.stability)}</em>
        </div>
        <div className="meter-row">
          <span>{tr('overview.techLevel')}</span>
          <div className="meter meter--cyan">
            <span style={{ width: `${Math.min(100, state.techLevel * 38)}%` }} />
          </div>
          <em>{decimal(state.techLevel, 1)}</em>
        </div>
        <div className="meter-row">
          <span>{tr('military.readiness')}</span>
          <div className="meter meter--green">
            <span style={{ width: `${Math.round(state.military.readiness * 100)}%` }} />
          </div>
          <em>{percent(state.military.readiness)}</em>
        </div>
      </div>

      {relation && (
        <div className={`relation-banner relation-${relation.status}`}>
          <span className="relation-banner__label">{tr('diplomacy.status')}</span>
          <strong>{tr(`diplomacy.status.${relation.status}` as MessageKey)}</strong>
          <span className="relation-banner__value">{signed(relation.value)}</span>
          <div className="relation-banner__flags">
            {relation.atWar && <span className="chip chip--danger">{tr('diplomacy.status.war')}</span>}
            {relation.ally && <span className="chip chip--green">{tr('diplomacy.status.ally')}</span>}
            {relation.trade && <span className="chip">{tr('diplomacy.trade')}</span>}
          </div>
        </div>
      )}

      {brief.cities.length > 0 && (
        <div className="dossier__cities">
          <span className="label">{tr('panel.territory')}</span>
          <div className="dossier__city-list">
            {brief.cities.slice(0, 6).map((city) => (
              <span key={city.id} className="city-chip">
                {localize(city.name, locale)}
              </span>
            ))}
          </div>
        </div>
      )}

      {children && <div className="dossier__footer">{children}</div>}
    </article>
  );
}
