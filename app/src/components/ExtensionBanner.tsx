import { Link, useLocation } from 'react-router-dom'
import { useExtensionStatus } from '../lib/useRegPilotExtension'

// Yellow notice shown only while the browser extension is missing or out of date.
export default function ExtensionBanner() {
  const { state } = useExtensionStatus()
  const { pathname } = useLocation()
  if ((state !== 'missing' && state !== 'outdated') || pathname === '/extension') return null

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-100 px-6 py-2 font-text text-[14px] text-amber-900"
    >
      <span>
        {state === 'missing'
          ? 'The RegPilot browser extension is not installed, so you cannot fill Montaji yet.'
          : 'Your RegPilot browser extension is out of date. Update it to keep filling Montaji.'}
      </span>
      <Link to="/extension" className="font-semibold underline">
        {state === 'missing' ? 'Install it' : 'Update it'}
      </Link>
    </div>
  )
}
