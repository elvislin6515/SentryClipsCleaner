export const LOCALES = ["en", "zh-Hant"] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "sentryclips.locale";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "zh-Hant";
}

export function localeFromLanguage(language: string | null | undefined): Locale {
  return language?.toLowerCase().startsWith("zh") ? "zh-Hant" : "en";
}

export function htmlLang(locale: Locale): string {
  return locale === "zh-Hant" ? "zh-Hant" : "en";
}

export function intlTag(locale: Locale): string {
  return locale === "zh-Hant" ? "zh-TW" : "en";
}
