import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Platform-wide settings (contact details, pricing line, chat limits), stored once in the
// site_settings table so they are changed in one place.
export type SiteSettings = {
  contact_email: string
  whatsapp_number: string
  pricing_en: string
  pricing_ar: string
  chat_max_question_chars: number
}

let cached: Promise<SiteSettings | null> | null = null

function loadSiteSettings(): Promise<SiteSettings | null> {
  cached ??= Promise.resolve(
    supabase
      .from('site_settings')
      .select('contact_email, whatsapp_number, pricing_en, pricing_ar, chat_max_question_chars')
      .eq('id', 1)
      .single(),
  ).then(({ data, error }) => {
    if (error) {
      cached = null // try again next time
      return null
    }
    return data as SiteSettings
  })
  return cached
}

export function useSiteSettings(): SiteSettings | null {
  const [settings, setSettings] = useState<SiteSettings | null>(null)
  useEffect(() => {
    let active = true
    loadSiteSettings().then((s) => {
      if (active) setSettings(s)
    })
    return () => {
      active = false
    }
  }, [])
  return settings
}

export function whatsappLink(number: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}`
}
