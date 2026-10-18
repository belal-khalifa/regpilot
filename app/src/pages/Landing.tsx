import { Link } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import HeroGraphic from '../components/HeroGraphic'

function PrimaryButton({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-full bg-primary px-[22px] py-[11px] font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-on-primary active:scale-95 transition-transform"
    >
      {children}
    </Link>
  )
}

function SecondaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-full border border-primary px-[22px] py-[11px] font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-primary active:scale-95 transition-transform"
    >
      {children}
    </a>
  )
}

export default function Landing() {
  return (
    <div>
      <GlobalNav />

      {/* Hero — product-tile-light */}
      <section className="bg-canvas px-6 py-20 md:py-[80px]">
        <div className="mx-auto flex max-w-[980px] flex-col items-center gap-8 text-center">
          <p className="font-display text-[14px] font-semibold tracking-[0.231px] text-primary">
            Cosmetics regulatory, simplified
          </p>
          <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink sm:text-[40px] md:text-[56px]">
            Montaji-ready in minutes, not weeks.
          </h1>
          <p className="max-w-[640px] font-text text-[19px] font-normal leading-[1.4] text-ink-muted-80 md:text-[21px]">
            Upload your product documents. RegPilot reads them, fills out the Dubai Municipality
            Montaji form, and hands it back to you to review and submit — no new passwords for
            us to hold, no re-typing.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <PrimaryButton to="/login">Get started</PrimaryButton>
            <SecondaryButton href="#how-it-works">See how it works</SecondaryButton>
          </div>
          <div className="mt-6 w-full flex justify-center">
            <HeroGraphic />
          </div>
        </div>
      </section>

      {/* Dark tile — reading documents */}
      <section id="how-it-works" className="bg-surface-tile-1 px-6 py-16 md:py-[80px]">
        <div className="mx-auto flex max-w-[980px] flex-col items-center gap-4 text-center">
          <h2 className="font-display text-[28px] font-semibold leading-[1.1] text-on-dark md:text-[40px]">
            Upload once. Let RegPilot do the reading.
          </h2>
          <p className="max-w-[620px] font-text text-[17px] leading-[1.47] text-body-muted">
            Drop in the product formula and ingredient list, the Certificate of Free Sale and
            manufacturer documents, and the label artwork. RegPilot's AI reads every page and
            drafts the product record for you — ingredients, manufacturer details, and label
            claims, all in one place.
          </p>
        </div>
      </section>

      {/* Parchment tile — review + extension */}
      <section className="bg-canvas-parchment px-6 py-16 md:py-[80px]">
        <div className="mx-auto flex max-w-[980px] flex-col items-center gap-4 text-center">
          <h2 className="font-display text-[28px] font-semibold leading-[1.1] text-ink md:text-[40px]">
            You review it, then fill Montaji in one click.
          </h2>
          <p className="max-w-[620px] font-text text-[17px] leading-[1.47] text-ink-muted-80">
            Nothing goes to Dubai Municipality without you checking it first. Once a product
            looks right, our browser extension types it straight into your own, already-logged-in
            Montaji session — you click the final Submit yourself. RegPilot never sees or stores
            your Montaji password, and never submits on your behalf.
          </p>
          <Link to="/extension" className="font-text text-[17px] text-primary underline">
            Get the filling tool
          </Link>
        </div>
      </section>

      {/* Dark tile 2 — teams & consultants */}
      <section className="bg-surface-tile-2 px-6 py-16 md:py-[80px]">
        <div className="mx-auto flex max-w-[980px] flex-col items-center gap-4 text-center">
          <h2 className="font-display text-[28px] font-semibold leading-[1.1] text-on-dark md:text-[40px]">
            Built for brand teams and consultants.
          </h2>
          <p className="max-w-[620px] font-text text-[17px] leading-[1.47] text-body-muted">
            A brand's whole team can work from one shared list of products. Consultants managing
            several client companies get a clean switcher between them, with each company's data
            kept separate. Every product shows exactly where it stands — Draft, Ready to Fill,
            Submitted, Approved, or Rejected.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-canvas-parchment px-6 py-16">
        <div className="mx-auto max-w-[980px] text-center">
          <p className="font-text text-[12px] leading-[1.0] tracking-[-0.12px] text-ink-muted-48">
            © 2026 RegPilot. Not affiliated with Dubai Municipality.
          </p>
        </div>
      </footer>
    </div>
  )
}
