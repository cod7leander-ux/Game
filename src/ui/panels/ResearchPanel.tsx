import { useState } from 'react';
import { BRANCH_ORDER, TECHNOLOGIES, techsByBranch } from '../../data/research';
import { getUnit } from '../../data/units';
import { localize } from '../../i18n/types';
import type { MessageKey } from '../../i18n/locales/en';
import type { ResearchBranch, ResearchEffect } from '../../gameplay/research/types';
import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n, type I18n } from '../hooks/useI18n';

const BRANCH_KEY: Record<ResearchBranch, MessageKey> = {
  industry: 'research.branch.industry',
  energy: 'research.branch.energy',
  infantry: 'research.branch.infantry',
  armor: 'research.branch.armor',
  artillery: 'research.branch.artillery',
  aviation: 'research.branch.aviation',
  helicopters: 'research.branch.helicopters',
  drones: 'research.branch.drones',
  naval: 'research.branch.naval',
  missiles: 'research.branch.missiles',
  airDefence: 'research.branch.airDefence',
  recon: 'research.branch.recon',
  electronics: 'research.branch.electronics',
  logistics: 'research.branch.logistics',
  advanced: 'research.branch.advanced',
};

const EFFECT_KEY: Record<ResearchEffect['kind'], MessageKey> = {
  production: 'effect.production',
  income: 'effect.income',
  research: 'effect.research',
  stability: 'effect.stability',
  attack: 'effect.attack',
  defence: 'effect.defence',
  manpower: 'effect.manpower',
  supply: 'effect.supply',
  detection: 'effect.detection',
  resource: 'effect.resource',
  unlockUnit: 'effect.unlockUnit',
};

const effectLabel = (effect: ResearchEffect, i18n: I18n): string => {
  if (effect.kind === 'unlockUnit') {
    const unit = effect.unitId ? getUnit(effect.unitId) : undefined;
    return i18n.t('effect.unlockUnit', {
      unit: unit ? localize(unit.name, i18n.locale) : '—',
    });
  }
  if (effect.kind === 'manpower') {
    return `${i18n.t(EFFECT_KEY.manpower)} ${i18n.signed(effect.value)}k`;
  }
  return `${i18n.t(EFFECT_KEY[effect.kind])} ${i18n.signed(Math.round(effect.value * 100))}%`;
};

export function ResearchPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const i18n = useI18n();
  const { locale, n, percent, compact } = i18n;
  const startResearch = useAppStore((state) => state.startResearch);
  const [branch, setBranch] = useState<ResearchBranch>('industry');
  const completed = new Set(snapshot.research.completed);
  const activeId = snapshot.research.activeId;

  const active = TECHNOLOGIES.find((tech) => tech.id === activeId);

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{i18n.t('panel.research')}</span>
          <h2>{i18n.t('research.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{i18n.t('research.points')}</span>
          <strong>{n(Math.round(snapshot.country.researchOutput))}</strong>
        </div>
      </header>

      <div className="research-current">
        <span className="label">{i18n.t('research.current')}</span>
        {active ? (
          <>
            <div className="research-current__title">
              <strong>{localize(active.name, locale)}</strong>
              <span>{i18n.t('research.daysLeft', { days: n(snapshot.research.daysRemaining) })}</span>
            </div>
            <div className="meter meter--cyan">
              <span style={{ width: `${Math.round(snapshot.research.ratio * 100)}%` }} />
            </div>
            <div className="research-current__meta">
              <span>
                {compact(snapshot.research.progress)} / {compact(snapshot.research.cost)}
              </span>
              <span>{percent(snapshot.research.ratio)}</span>
            </div>
          </>
        ) : (
          <p className="muted">{i18n.t('research.select')}</p>
        )}
      </div>

      <nav className="branch-tabs" aria-label={i18n.t('research.title')}>
        {BRANCH_ORDER.map((entry) => (
          <button
            key={entry}
            type="button"
            className={branch === entry ? 'is-active' : ''}
            onClick={() => setBranch(entry)}
          >
            {i18n.t(BRANCH_KEY[entry])}
          </button>
        ))}
      </nav>

      <div className="tech-list">
        {techsByBranch(branch).map((tech) => {
          const isDone = completed.has(tech.id);
          const isActive = activeId === tech.id;
          const unlocked = tech.requires.every((required) => completed.has(required));
          const requirementNames = tech.requires
            .map((required) => {
              const definition = TECHNOLOGIES.find((entry) => entry.id === required);
              return definition ? localize(definition.name, locale) : required;
            })
            .join(', ');

          return (
            <article
              key={tech.id}
              className={`tech-card ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''} ${!unlocked ? 'is-locked' : ''}`}
            >
              <header className="tech-card__header">
                <div>
                  <h3>{localize(tech.name, locale)}</h3>
                  <span className="tech-card__tier">T{n(tech.tier)}</span>
                </div>
                {isDone ? (
                  <span className="chip chip--green">{i18n.t('research.completed')}</span>
                ) : isActive ? (
                  <span className="chip chip--cyan">{i18n.t('common.active')}</span>
                ) : !unlocked ? (
                  <span className="chip chip--muted">
                    {i18n.t('research.locked', { tech: requirementNames })}
                  </span>
                ) : (
                  <span className="chip">{i18n.t('research.cost', { points: n(tech.cost) })}</span>
                )}
              </header>
              <p className="tech-card__description">{localize(tech.description, locale)}</p>
              <ul className="effect-list">
                {tech.effects.map((effect, index) => (
                  <li key={`${tech.id}-${index}`}>{effectLabel(effect, i18n)}</li>
                ))}
              </ul>
              {!isDone && !isActive && (
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={!unlocked}
                  onClick={() => startResearch(tech.id)}
                >
                  {i18n.t('research.start')}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <p className="hint">{i18n.t('research.subtitle')}</p>
    </div>
  );
}
