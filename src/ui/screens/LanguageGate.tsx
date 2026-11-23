import { useState } from 'react';
import { LOCALES, type LocaleCode } from '../../i18n/types';
import { useSettingsStore } from '../../state/settingsStore';
import { useI18n } from '../hooks/useI18n';

/** First-launch language selection. Also reachable later from Settings. */
export function LanguageGate() {
  const setLocale = useSettingsStore((state) => state.setLocale);
  const [choice, setChoice] = useState<LocaleCode>('en');
  const { t: tr, dir } = useI18n();

  return (
    <div className="gate" dir="ltr">
      <div className="gate__panel">
        <div className="gate__eyebrow">TERRA DOMINION</div>
        <h1 className="gate__title">Choose your language</h1>
        <p className="gate__subtitle" dir="rtl">
          زبان خود را انتخاب کنید
        </p>

        <div className="language-grid">
          {LOCALES.map((locale) => (
            <button
              key={locale.code}
              type="button"
              className={`language-card ${choice === locale.code ? 'is-active' : ''}`}
              onClick={() => setChoice(locale.code)}
              onDoubleClick={() => setLocale(locale.code)}
              dir={locale.dir}
            >
              <span className="language-card__code">{locale.code.toUpperCase()}</span>
              <span className="language-card__name">{locale.nativeLabel}</span>
              <span className="language-card__sample">{locale.sample}</span>
              <span className="language-card__meta">{locale.englishLabel}</span>
            </button>
          ))}
        </div>

        <button type="button" className="btn btn--primary btn--wide" onClick={() => setLocale(choice)}>
          {choice === 'fa' ? 'ادامه' : tr('language.continue')}
        </button>
        <p className="gate__note" dir={dir}>
          {choice === 'fa'
            ? 'این انتخاب را هر زمان در تنظیمات می‌توانید تغییر دهید.'
            : tr('language.note')}
        </p>
      </div>
    </div>
  );
}
