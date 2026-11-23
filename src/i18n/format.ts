import { GAME } from '../core/config';
import { getLocaleDefinition } from './types';
import type { LocaleCode } from './types';

/**
 * Locale-aware formatting. All user-visible numbers, dates and quantities go
 * through here so the Persian interface can use Persian digits, suffixes and
 * calendar labels consistently.
 */

export type DigitStyle = 'locale' | 'latin';

export interface FormatOptions {
  /** Persian interface shows Persian digits by default; settings can override. */
  persianNumerals?: boolean;
  digits?: number;
}

const numberLocaleFor = (locale: LocaleCode, options?: FormatOptions): string => {
  if (locale === 'fa' && options?.persianNumerals === false) return 'en-US';
  return getLocaleDefinition(locale).numberLocale;
};

export const formatNumber = (
  value: number,
  locale: LocaleCode,
  options: FormatOptions & Intl.NumberFormatOptions = {},
): string => {
  const { persianNumerals: _ignored, ...intl } = options;
  return new Intl.NumberFormat(numberLocaleFor(locale, options), intl).format(value);
};

export const formatDecimal = (
  value: number,
  locale: LocaleCode,
  digits = 1,
  options?: FormatOptions,
): string =>
  formatNumber(value, locale, {
    ...options,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** 1_234_000 → "1.2M" (localized digits and suffix). */
export const formatCompact = (
  value: number,
  locale: LocaleCode,
  options?: FormatOptions,
): string => {
  const abs = Math.abs(value);
  if (abs >= 1e12) {
    return `${formatDecimal(value / 1e12, locale, 1, options)}${locale === 'fa' ? ' تریلیون' : 'T'}`;
  }
  if (abs >= 1e9) {
    return `${formatDecimal(value / 1e9, locale, 1, options)}${locale === 'fa' ? ' میلیارد' : 'B'}`;
  }
  if (abs >= 1e6) {
    return `${formatDecimal(value / 1e6, locale, 1, options)}${locale === 'fa' ? ' میلیون' : 'M'}`;
  }
  if (abs >= 1e4) {
    return `${formatDecimal(value / 1e3, locale, 0, options)}${locale === 'fa' ? ' هزار' : 'K'}`;
  }
  return formatNumber(Math.round(value), locale, options);
};

export const formatPercent = (
  ratio: number,
  locale: LocaleCode,
  digits = 0,
  options?: FormatOptions,
): string => `${formatDecimal(ratio * 100, locale, digits, options)}${locale === 'fa' ? '٪' : '%'}`;

export const formatSigned = (
  value: number,
  locale: LocaleCode,
  options?: FormatOptions & Intl.NumberFormatOptions,
): string => {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(value), locale, options)}`;
};

const MS_PER_DAY = 86_400_000;
const START_UTC = Date.UTC(GAME.startDate.year, GAME.startDate.month - 1, GAME.startDate.day);

/** Current in-game calendar date (day 1 = 1 January 2031). */
export const gameDate = (day: number): Date => new Date(START_UTC + (Math.max(1, day) - 1) * MS_PER_DAY);

export const gameYear = (day: number): number => gameDate(day).getUTCFullYear();

export const formatGameDate = (
  day: number,
  locale: LocaleCode,
  monthNames: (index: number) => string,
): string => {
  const date = gameDate(day);
  const month = monthNames(date.getUTCMonth());
  const dayOfMonth = formatNumber(date.getUTCDate(), locale, { useGrouping: false });
  const year = formatNumber(date.getUTCFullYear(), locale, { useGrouping: false });
  return locale === 'fa' ? `${dayOfMonth} ${month} ${year}` : `${month} ${dayOfMonth}, ${year}`;
};

export const formatTimestamp = (timestamp: number, locale: LocaleCode): string =>
  new Intl.DateTimeFormat(getLocaleDefinition(locale).numberLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));

/** Formats a distance in kilometres from map units (scene radii → km). */
export const formatKilometres = (km: number, locale: LocaleCode, options?: FormatOptions): string =>
  `${formatNumber(Math.round(km), locale, { ...options, maximumFractionDigits: 0 })} ${
    locale === 'fa' ? 'کیلومتر' : 'km'
  }`;
