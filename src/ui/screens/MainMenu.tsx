import { useEffect, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';
import { GAME } from '../../core/config';
import { COUNTRY_BY_ID } from '../../data/countries';
import { localize } from '../../i18n/types';
import { useSettingsStore } from '../../state/settingsStore';

export function MainMenu() {
  const { t: tr, locale, n } = useI18n();
  const goToNationSelect = useAppStore((state) => state.goToNationSelect);
  const openDialog = useAppStore((state) => state.openDialog);
  const refreshSaves = useAppStore((state) => state.refreshSaves);
  const continueLatest = useAppStore((state) => state.continueLatest);
  const savesLoaded = useAppStore((state) => state.savesLoaded);
  const saves = useAppStore((state) => state.saves);
  const setLocale = useSettingsStore((state) => state.setLocale);
  const [hasSave, setHasSave] = useState(false);

  useEffect(() => {
    void refreshSaves().then(() => setHasSave(true));
  }, [refreshSaves]);

  const latest = saves[0];
  const latestCountry = latest
    ? (COUNTRY_BY_ID[latest.file.meta.countryId]?.name ?? { en: latest.file.meta.countryName, fa: latest.file.meta.countryName })
    : null;

  return (
    <div className="menu">
      <header className="menu__locale">
        <div className="locale-switch" role="group" aria-label={tr('menu.language')}>
          <button
            type="button"
            className={locale === 'en' ? 'is-active' : ''}
            onClick={() => setLocale('en')}
          >
            EN
          </button>
          <button
            type="button"
            className={locale === 'fa' ? 'is-active' : ''}
            onClick={() => setLocale('fa')}
          >
            فا
          </button>
        </div>
      </header>

      <section className="menu__content">
        <div className="menu__brand">
          <div className="menu__sigil" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="menu__eyebrow">{tr('menu.solo')}</div>
          <h1 className="menu__title">{tr('app.name')}</h1>
          <p className="menu__tagline">{tr('app.tagline')}</p>
          <div className="menu__rule" />
          <p className="menu__brief">{tr('menu.briefing')}</p>
        </div>

        <nav className="menu__actions">
          <button type="button" className="btn btn--primary" onClick={goToNationSelect}>
            <span>{tr('menu.newGame')}</span>
            <span className="btn__hint">01</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void continueLatest()}
            disabled={!savesLoaded || !latest}
          >
            <span>{tr('menu.continue')}</span>
            <span className="btn__hint">02</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              openDialog('load');
            }}
            disabled={!savesLoaded || !hasSave || saves.length === 0}
          >
            <span>{tr('menu.load')}</span>
            <span className="btn__hint">03</span>
          </button>
          <button type="button" className="btn" onClick={() => openDialog('settings')}>
            <span>{tr('menu.settings')}</span>
            <span className="btn__hint">04</span>
          </button>
        </nav>

        {latest && (
          <div className="menu__continue-card">
            <span className="menu__continue-label">{tr('menu.continue')}</span>
            <strong>{latestCountry ? localize(latestCountry, locale) : latest.file.meta.countryName}</strong>
            <span className="menu__continue-meta">
              {tr('time.year', { year: n(latest.file.meta.year, { useGrouping: false }) })} ·{' '}
              {tr('common.day')} {n(latest.file.meta.day)}
            </span>
          </div>
        )}
      </section>

      <footer className="menu__footer">
        <span>{tr('menu.footer')}</span>
        <span className="menu__version">{tr('app.version', { version: GAME.version })}</span>
      </footer>
    </div>
  );
}
