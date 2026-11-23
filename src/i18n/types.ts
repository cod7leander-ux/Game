/**
 * Localization primitives.
 *
 * Two kinds of localizable content exist:
 *  - UI chrome, which uses the typed message catalog in ./locales (keys are
 *    compile-time checked so no screen can ship with a missing string).
 *  - Content (countries, units, technologies, traits), which carries a
 *    LocalizedText record so a new language can be added without touching code.
 */

export type LocaleCode = 'en' | 'fa';

export type Direction = 'ltr' | 'rtl';

export interface LocaleDefinition {
  code: LocaleCode;
  /** Name in the language itself. */
  nativeLabel: string;
  englishLabel: string;
  dir: Direction;
  /** Number formatting locale (Persian uses its own digits). */
  numberLocale: string;
  /** Short sub-line shown on the language picker. */
  sample: string;
}

export const LOCALES: readonly LocaleDefinition[] = [
  {
    code: 'en',
    nativeLabel: 'English',
    englishLabel: 'English',
    dir: 'ltr',
    numberLocale: 'en-US',
    sample: 'Command a nation. Shape the world.',
  },
  {
    code: 'fa',
    nativeLabel: 'فارسی',
    englishLabel: 'Persian',
    dir: 'rtl',
    numberLocale: 'fa-IR',
    sample: 'فرماندهی یک کشور. شکل‌دهی به جهان.',
  },
];

export const DEFAULT_LOCALE: LocaleCode = 'en';

export const getLocaleDefinition = (code: LocaleCode): LocaleDefinition =>
  LOCALES.find((locale) => locale.code === code) ?? LOCALES[0];

/** Text that can be rendered in any supported locale, with English as fallback. */
export type LocalizedText = Record<LocaleCode, string> & Partial<Record<LocaleCode, string>>;

export const localize = (text: LocalizedText, locale: LocaleCode): string =>
  text[locale] ?? text.en;

export const isLocaleCode = (value: unknown): value is LocaleCode =>
  value === 'en' || value === 'fa';
