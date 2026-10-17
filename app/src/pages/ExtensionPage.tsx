import GlobalNav from '../components/GlobalNav'
import {
  EXTENSION_DOWNLOAD_URL,
  useExtensionStatus,
  type ExtensionState,
} from '../lib/useRegPilotExtension'

function StatusCard({
  state,
  installed,
  latest,
}: {
  state: ExtensionState
  installed: string | null
  latest: string
}) {
  if (state === 'checking') return null
  const styles =
    state === 'ready'
      ? 'border-green-300 bg-green-50 text-green-900'
      : 'border-amber-300 bg-amber-100 text-amber-900'
  const text =
    state === 'ready'
      ? `Installed and up to date (version ${installed}).`
      : state === 'outdated'
        ? `Installed, but out of date (${installed ? `you have ${installed}` : 'an old version'}, latest is ${latest}). Follow "Update" below.`
        : 'Not detected in this browser. Follow "Install" below, then refresh this page.'
  return (
    <p role="status" className={`rounded-lg border px-4 py-3 font-text text-[15px] ${styles}`}>
      {text}
    </p>
  )
}

function Steps({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[24px] font-semibold text-ink">{title}</h2>
      <ol className="flex list-decimal flex-col gap-2 pl-6 font-text text-[16px] leading-[1.47] text-ink-muted-80">
        {children}
      </ol>
    </section>
  )
}

const code = 'rounded bg-canvas-parchment px-1.5 py-0.5 text-[14px]'

export default function ExtensionPage() {
  const { state, installedVersion, latestVersion } = useExtensionStatus()

  return (
    <div>
      <GlobalNav />
      <main className="mx-auto flex max-w-[760px] flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-4">
          <h1 className="font-display text-[34px] font-semibold leading-[1.1] text-ink md:text-[44px]">
            RegPilot browser extension
          </h1>
          <p className="font-text text-[17px] leading-[1.47] text-ink-muted-80">
            Fills your reviewed product into the Montaji form. You stay signed in to Montaji
            yourself and press Submit yourself; the extension never sees your Montaji password.
            Works in Chrome, Edge and Brave on a computer.
          </p>
          <StatusCard state={state} installed={installedVersion} latest={latestVersion} />
          <div className="flex flex-wrap items-center gap-4">
            <a
              href={EXTENSION_DOWNLOAD_URL}
              download="regpilot-extension.zip"
              className="rounded-full bg-primary px-[22px] py-[11px] font-text text-[17px] text-on-primary active:scale-95 transition-transform"
            >
              Download extension
            </a>
            <span className="font-text text-[14px] text-ink-muted-48">
              Version {latestVersion} · zip file
            </span>
          </div>
        </header>

        <Steps title="Install">
          <li>Download the zip above and unzip it. You get a folder called <code className={code}>regpilot-extension</code>. Put it somewhere permanent, such as Documents.</li>
          <li>In your browser, open <code className={code}>chrome://extensions</code> (Edge: <code className={code}>edge://extensions</code>).</li>
          <li>Switch on <strong>Developer mode</strong> (top right).</li>
          <li>Click <strong>Load unpacked</strong> and choose the <code className={code}>regpilot-extension</code> folder.</li>
          <li>Refresh this page. The status above should turn green.</li>
        </Steps>

        <p className="rounded-lg bg-canvas-parchment px-4 py-3 font-text text-[14px] leading-[1.47] text-ink-muted-80">
          Good to know: the browser reads the extension from that folder, so do not move or delete
          it while you use it. After a restart, the browser may show a "Disable developer mode
          extensions" notice. It is expected for extensions installed this way: choose
          Keep, or ignore it.
        </p>

        <Steps title="Update">
          <li>Download the zip again and unzip it over your existing <code className={code}>regpilot-extension</code> folder, replacing the files.</li>
          <li>Open <code className={code}>chrome://extensions</code> and click the circular <strong>reload</strong> arrow on the RegPilot card.</li>
          <li>Refresh this page and any open Montaji tab.</li>
        </Steps>

        <Steps title="Uninstall">
          <li>Open <code className={code}>chrome://extensions</code>.</li>
          <li>On the RegPilot card click <strong>Remove</strong> and confirm. Anything queued for Montaji is deleted with it.</li>
          <li>Only now delete the <code className={code}>regpilot-extension</code> folder and the zip from your computer.</li>
        </Steps>
      </main>
    </div>
  )
}
