import { en, type MessageKey, type Messages } from './locales/en';
import { fa } from './locales/fa';
import { DEFAULT_LOCALE, getLocaleDefinition, isLocaleCode, LOCALES, localize } from './types';
import type { LocaleCode, LocalizedText } from './types';

export type { MessageKey, Messages, LocaleCode, LocalizedText };
export { DEFAULT_LOCALE, getLocaleDefinition, isLocaleCode, LOCALES, localize };

export const catalogs: Record<LocaleCode, Messages> = { en, fa };

export type InterpolationValues = Record<string, string | number>;

/**
 * Translates a key, interpolating {placeholders}. Missing keys degrade to the
 * English string and finally to the key itself so a missed translation is
 * visible but never crashes a screen.
 */
export const translate = (
  locale: LocaleCode,
  key: MessageKey,
  values?: InterpolationValues,
): string => {
  const template = catalogs[locale]?.[key] ?? en[key] ?? key;
  return interpolate(template, values);
};

export const interpolate = (template: string, values?: InterpolationValues): string => {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
};

export const dirFor = (locale: LocaleCode): 'ltr' | 'rtl' => getLocaleDefinition(locale).dir;

export const availableLocales = LOCALES;
