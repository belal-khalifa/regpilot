import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'
import ExtensionBanner from './ExtensionBanner'

export default function GlobalNav() {
  const { session } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <>
    <header className="sticky top-0 z-50 flex h-11 items-center justify-between bg-surface-black px-6">
      <Link
        to="/"
        className="font-display text-[15px] font-semibold tracking-[-0.12px] text-on-dark"
      >
        RegPilot
      </Link>
      <div className="flex items-center gap-4">
      <Link to="/extension" className="font-text text-[14px] text-on-dark">
        Extension
      </Link>
      {session ? (
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-sm bg-ink px-[15px] py-2 font-text text-[14px] leading-[1.29] tracking-[-0.224px] text-on-dark active:scale-95 transition-transform"
        >
          Sign out
        </button>
      ) : (
        <Link
          to="/login"
          className="rounded-sm bg-ink px-[15px] py-2 font-text text-[14px] leading-[1.29] tracking-[-0.224px] text-on-dark active:scale-95 transition-transform"
        >
          Sign in
        </Link>
      )}
      </div>
    </header>
    {session && <ExtensionBanner />}
    </>
  )
}
