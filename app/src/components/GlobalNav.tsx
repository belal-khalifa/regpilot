import { Link } from 'react-router-dom'

export default function GlobalNav() {
  return (
    <header className="sticky top-0 z-50 flex h-11 items-center justify-between bg-surface-black px-6">
      <Link
        to="/"
        className="font-display text-[15px] font-semibold tracking-[-0.12px] text-on-dark"
      >
        RegPilot
      </Link>
      <Link
        to="/login"
        className="rounded-sm bg-ink px-[15px] py-2 font-text text-[14px] leading-[1.29] tracking-[-0.224px] text-on-dark active:scale-95 transition-transform"
      >
        Sign in
      </Link>
    </header>
  )
}
