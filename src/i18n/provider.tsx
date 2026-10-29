"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { htmlLang, isLocale, LOCALE_STORAGE_KEY, localeFromLanguage, type Locale } from "@/i18n/locale";
import { messages, type Messages } from "@/i18n/messages";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  m: Messages;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    const next = isLocale(saved) ? saved : localeFromLanguage(navigator.language);
    setLocaleState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
    document.title = messages[locale].meta.title;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale(next) {
        setLocaleState(next);
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      },
      m: messages[locale],
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useI18n must be used inside LocaleProvider");
  }
  return value;
}
