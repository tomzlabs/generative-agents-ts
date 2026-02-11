import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Language = 'zh' | 'en';

type I18nContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (zh: string, en: string) => string;
};

const LANG_STORAGE_KEY = 'ga:lang';

function detectInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'zh';
  const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  const navLang = window.navigator.language?.toLowerCase() ?? 'zh';
  return navLang.startsWith('zh') ? 'zh' : 'en';
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider(props: { children: ReactNode }) {
  const { children } = props;
  const [lang, setLang] = useState<Language>(() => detectInitialLanguage());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const toggleLang = useCallback(() => {
    setLang((prev) => (prev === 'zh' ? 'en' : 'zh'));
  }, []);

  const t = useCallback(
    (zh: string, en: string) => {
      return lang === 'zh' ? zh : en;
    },
    [lang],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      toggleLang,
      t,
    }),
    [lang, toggleLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
