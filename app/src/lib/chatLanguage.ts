// Shared by the public chat (REG-276) and the logged-in chat (REG-275): one remembered language choice.
export type Lang = 'en' | 'ar'
export type Source = { label: string; title: string; version: string; url: string | null }

const LANG_KEY = 'regpilot-chat-lang'

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'en' || saved === 'ar') return saved
  } catch {
    // storage may be blocked; fall back to the browser language
  }
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

export function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    // not essential
  }
}
