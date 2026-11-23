import { useMemo } from 'react';
import { translate } from '../../i18n';
import type { MessageKey } from '../../i18n/locales/en';
import {
  formatCompact,
  formatDecimal,
  formatNumber,
  formatPercent,
  formatSigned,
  formatTimestamp,
} from '../../i18n/format';
import { getLocaleDefinition } from '../../i18n/types';
import type { LocaleCode } from '../../i18n/types';
import { useSettingsStore } from '../../state/settingsStore';

export interface I18n {
  locale: LocaleCode;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  n: (value: number, options?: Intl.NumberFormatOptions) => string;
  compact: (value: number) => string;
  signed: (value: number) => string;
  percent: (ratio: number, digits?: number) => string;
  decimal: (value: number, digits?: number) => string;
  timestamp: (value: number) => string;
}

/** Localization hook: every screen renders through this. */
export const useI18n = (): I18n => {
  const locale = useSettingsStore((state) => state.locale);
  const persianNumerals = useSettingsStore((state) => state.persianNumerals);

  return useMemo(() => {
    const options = { persianNumerals };
    return {
      locale,
      dir: getLocaleDefinition(locale).dir,
      t: (key, values) => translate(locale, key, values),
      n: (value, intl) => formatNumber(value, locale, { ...options, ...intl }),
      compact: (value) => formatCompact(value, locale, options),
      signed: (value) => formatSigned(value, locale, options),
      percent: (ratio, digits = 0) => formatPercent(ratio, locale, digits, options),
      decimal: (value, digits = 1) => formatDecimal(value, locale, digits, options),
      timestamp: (value) => formatTimestamp(value, locale),
    };
  }, [locale, persianNumerals]);
};
