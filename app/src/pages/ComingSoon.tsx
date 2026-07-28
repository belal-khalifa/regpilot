import { Link } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'

export default function ComingSoon() {
  return (
    <div>
      <GlobalNav />
      <section className="bg-canvas px-6 py-24">
        <div className="mx-auto flex max-w-[600px] flex-col items-center gap-6 text-center">
          <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
            Sign-in is coming next.
          </h1>
          <p className="font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-ink-muted-80">
            We're wiring up Google sign-in and company accounts right now. Check back shortly.
          </p>
          <Link
            to="/"
            className="rounded-full bg-primary px-[22px] py-[11px] font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-on-primary active:scale-95 transition-transform"
          >
            Back home
          </Link>
        </div>
      </section>
    </div>
  )
}
