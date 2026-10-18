import { Link, useLocation } from 'react-router-dom'
import { useExtensionStatus } from '../lib/useRegPilotExtension'

// Yellow notice on the signed-in home page, shown only while the filling tool (browser extension) is missing or out of date.
export default function ExtensionBanner() {
  const { state } = useExtensionStatus()
  const { pathname } = useLocation()
  if ((state !== 'missing' && state !== 'outdated') || pathname !== '/app') return null

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-100 px-6 py-2 font-text text-[14px] text-amber-900"
    >
      <span>
        {state === 'missing'
          ? 'To fill the Montaji form from RegPilot you need the RegPilot filling tool, a small add-on for your browser. It is not installed yet.'
          : 'Your RegPilot filling tool (browser add-on) is out of date. Update it to keep filling Montaji.'}
      </span>
      <Link to="/extension" className="font-semibold underline">
        {state === 'missing' ? 'Get the filling tool' : 'Update it'}
      </Link>
    </div>
  )
}
