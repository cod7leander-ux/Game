import { useMemo, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { previewNations } from '../../game/preview';
import { localize } from '../../i18n/types';
import type { CampaignDifficulty } from '../../game/types';
import type { MessageKey } from '../../i18n/locales/en';
import { useI18n } from '../hooks/useI18n';
import { useSettingsStore } from '../../state/settingsStore';
import { Flag } from '../components/Flag';
import { CountryDossier } from '../components/CountryDossier';

const DIFFICULTIES: CampaignDifficulty[] = ['relaxed', 'standard', 'hardened'];

export function NationSelect() {
  const { t: tr, locale, compact } = useI18n();
  const nations = useMemo(() => previewNations(), []);
  const selectedCountryId = useAppStore((state) => state.selectedCountryId);
  const brief = useAppStore((state) => state.inspectedBrief);
  const selectCountry = useAppStore((state) => state.selectCountry);
  const startCampaign = useAppStore((state) => state.startCampaign);
  const goToMenu = useAppStore((state) => state.goToMenu);
  const [query, setQuery] = useState('');
  const defaultDifficulty = useSettingsStore((state) => state.defaultDifficulty);
  const [difficulty, setDifficulty] = useState<CampaignDifficulty>(defaultDifficulty);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return nations;
    return nations.filter(({ definition }) => {
      return (
        definition.name.en.toLowerCase().includes(needle) ||
        definition.name.fa.includes(needle) ||
        definition.id.toLowerCase().includes(needle) ||
        (definition.iso2 ?? '').toLowerCase() === needle
      );
    });
  }, [nations, query]);

  return (
    <div className="nation-screen">
      <header className="nation-screen__bar panel">
        <button type="button" className="btn btn--ghost" onClick={goToMenu}>
          ← {tr('nation.back')}
        </button>
        <div className="nation-screen__titles">
          <h1>{tr('nation.title')}</h1>
          <p>{tr('nation.subtitle')}</p>
        </div>
        <label className="search-field">
          <span className="search-field__icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr('nation.searchPlaceholder')}
            aria-label={tr('nation.search')}
          />
        </label>
      </header>

      <aside className="nation-screen__list panel">
        <div className="panel__heading">
          <span>{tr('nation.search')}</span>
          <em>{filtered.length}</em>
        </div>
        <div className="nation-list" role="listbox" aria-label={tr('nation.title')}>
          {filtered.map(({ definition, brief: entry }) => {
            const name = localize(definition.name, locale);
            const active = selectedCountryId === definition.id;
            return (
              <button
                key={definition.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`nation-row ${active ? 'is-active' : ''}`}
                onClick={() => selectCountry(definition.id, false)}
                onDoubleClick={() => selectCountry(definition.id, true)}
              >
                <Flag iso2={definition.iso2} seed={definition.id} size={24} title={name} />
                <span className="nation-row__body">
                  <span className="nation-row__name">{name}</span>
                  <span className="nation-row__meta">
                    {definition.continent} · {compact(entry.definition.baseGdp)} {tr('units.credits')}
                  </span>
                </span>
                <span
                  className={`strength-dot strength-${entry.strengthClass}`}
                  title={tr(`country.strength.${entry.strengthClass}` as MessageKey)}
                />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="empty-state">
              <span>{tr('common.none')}</span>
            </div>
          )}
        </div>
      </aside>

      <aside className="nation-screen__dossier">
        {brief ? (
          <div className="panel panel--dossier">
            <CountryDossier brief={brief}>
              <div className="difficulty">
                <span className="label">{tr('nation.difficulty')}</span>
                <div className="segmented">
                  {DIFFICULTIES.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      className={difficulty === entry ? 'is-active' : ''}
                      onClick={() => setDifficulty(entry)}
                    >
                      {tr(`nation.difficulty.${entry}` as MessageKey)}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--primary btn--wide"
                onClick={() => startCampaign(brief.definition.id, difficulty)}
              >
                {tr('nation.start')}
              </button>
              <p className="dossier__hint">{tr('nation.brief')}</p>
            </CountryDossier>
          </div>
        ) : (
          <div className="panel panel--placeholder">
            <div className="placeholder-glyph" aria-hidden="true">
              ◈
            </div>
            <strong>{tr('nation.pickPrompt')}</strong>
            <span>{tr('nation.subtitle')}</span>
          </div>
        )}
      </aside>

      <div className="nation-screen__tip panel">
        <span>{tr('nation.tip')}</span>
      </div>
    </div>
  );
}
