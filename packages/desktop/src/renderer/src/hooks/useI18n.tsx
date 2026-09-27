import { useState, useCallback, createContext, useContext, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { STORAGE_KEY } from '../i18n'

export type Locale = 'en' | 'zh'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
}

function getInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {}
  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('zh')) return 'zh'
  return 'en'
}

// ─── Context ───────────────────────────────────────────────────────

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

let I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key: string) => key,
})

// Dev HMR re-executes this module (locale JSON edits propagate through
// ../i18n into here), which would mint a fresh context identity - stale
// module generations (e.g. Sidebar) keep consuming the old context and
// fall back to the identity `t`, rendering raw key names. Cache the
// context on globalThis so every module generation shares one, mirroring
// the i18next singleton in ../i18n.
{
  const g = globalThis as unknown as { __sentinelI18nCtx?: typeof I18nContext }
  if (g.__sentinelI18nCtx) I18nContext = g.__sentinelI18nCtx
  else g.__sentinelI18nCtx = I18nContext
}

// ─── Provider ──────────────────────────────────────────────────────

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)
  const { t } = useTranslation()

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    i18n.changeLanguage(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch {}
  }, [])

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useI18n() {
  return useContext(I18nContext)
}
