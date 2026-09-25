import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'

const STORAGE_KEY = 'sentinel-locale'

function getInitialLocale(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {}
  // Auto-detect from browser language
  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('zh')) return 'zh'
  return 'en'
}

// Dev-mode HMR re-executes this module after edits to any i18n consumer,
// which would mint a second i18next instance - components keeping the old
// one would then ignore changeLanguage calls (the "language switch does
// nothing" symptom). Cache the instance on globalThis so every module
// graph generation shares exactly one i18next.
const g = globalThis as unknown as { __sentinelI18n?: typeof i18n }
if (!g.__sentinelI18n) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: getInitialLocale(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes
    },
  })
  g.__sentinelI18n = i18n
} else {
  // Dev HMR re-execution: refresh bundles in place so locale JSON edits
  // (new keys included) hot-swap without losing the shared instance.
  g.__sentinelI18n.addResourceBundle('en', 'translation', en, true, true)
  g.__sentinelI18n.addResourceBundle('zh', 'translation', zh, true, true)
}

export { STORAGE_KEY }
// The cache is always populated by the init block above; the annotation
// keeps the exported type non-optional for consumers.
const sharedI18n: typeof i18n = g.__sentinelI18n ?? i18n
export default sharedI18n
