import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { BRAND } from '@/lib/brand'
import { loadProgrammes, nextCohort } from '@/lib/chatbot/programme'
import { ghs } from '@/lib/chatbot/format'

export const runtime = 'nodejs'
/** Programmes and dates change rarely; a visitor should not wait on a query. */
export const revalidate = 300

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
}

/**
 * The public front page.
 *
 * ── WHAT WAS HERE BEFORE ───────────────────────────────────────────────────
 *
 * A redirect to /login. Every visitor to the centre's own domain — somebody
 * who had just clicked an advert, been sent a referral link, or simply
 * searched for the place — was shown a staff sign-in box asking for a PIN they
 * do not have. The institution had no public presence at its own address.
 *
 * It also called supabase.auth.getUser() first, which this application does
 * not use: authentication is a PIN cookie, so that call returned null every
 * time and both branches redirected to the same place. A round trip on every
 * hit to decide something already decided.
 *
 * ── WHAT IT SAYS, AND WHAT IT REFUSES TO SAY ───────────────────────────────
 *
 * Everything on this page comes from a record. The programmes are the real
 * ones, with the fees and durations actually stored against them; the dates
 * are cohorts genuinely scheduled.
 *
 * What is NOT here is the usual furniture of an education landing page —
 * pass rates, student numbers, years established, accreditation badges,
 * testimonials, partner logos. Not because they would not help, but because
 * this repository has no record of any of them, and the one discipline the
 * whole system is built on is that a fact nobody recorded does not get
 * written down and shown to a stranger. When the centre records them, they
 * can appear here.
 */

export default async function Home() {
  const loaded = await loadProgrammes()
  const programmes = loaded.ok ? loaded.data : []

  /*
   * A failed read is not an empty prospectus. If the programmes cannot be
   * loaded the section is left out entirely rather than telling a visitor the
   * centre runs no courses — see lib/chatbot/programme for why the two are
   * kept distinct everywhere.
   */
  const showProgrammes = loaded.ok && programmes.length > 0

  const upcoming = programmes
    .map(p => ({ programme: p, cohort: nextCohort(p) }))
    .filter((x): x is { programme: typeof programmes[number]; cohort: NonNullable<ReturnType<typeof nextCohort>> } =>
      Boolean(x.cohort?.startDateText))
    .slice(0, 3)

  return (
    <div className="min-h-[100dvh] bg-[var(--canvas)]">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-[var(--paper)]/95 backdrop-blur border-b border-[var(--line)]">
        <div className="mx-auto max-w-5xl px-5 h-16 flex items-center justify-between gap-4">
          <Link href="/welcome" className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[var(--paper)] ring-1 ring-[var(--line)] grid place-items-center p-1 flex-shrink-0">
              <Image src={BRAND.logo} alt="" width={36} height={36} className="w-full h-full object-contain" priority />
            </span>
            <span className="font-semibold text-[15px] text-[var(--ink)] truncate">{BRAND.shortName}</span>
          </Link>
          <nav className="flex items-center gap-1.5">
            <Link href="#programmes"
              className="hidden sm:inline-flex h-10 items-center px-3.5 rounded-xl text-[14px] font-medium
                text-[var(--ink-soft)] hover:bg-[var(--line-soft)] transition-colors">
              Programmes
            </Link>
            <Link href="/apply"
              className="inline-flex h-10 items-center px-4 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)]
                text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2">
              Enquire
            </Link>
          </nav>
        </div>
      </header>

      {/* ── What this is ───────────────────────────────────────────────── */}
      <section className="bg-[var(--brand)]">
        <div className="mx-auto max-w-5xl px-5 py-16 sm:py-24">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/60">
            Accra, Ghana
          </p>
          <h1 className="mt-4 font-display text-white text-[32px] sm:text-[44px] leading-[1.1]
            font-semibold tracking-[-0.02em] max-w-[18ch]">
            {BRAND.name}
          </h1>
          <p className="mt-5 text-[16px] sm:text-[17px] text-white/75 leading-relaxed max-w-[52ch]">
            Professional and executive certification training. We prepare working people
            for the credentials their field actually recognises, and stay with them
            through the process.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/apply"
              className="inline-flex h-12 items-center px-6 rounded-2xl bg-[var(--paper)] text-[var(--brand)]
                text-[15px] font-semibold hover:bg-white transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand)]">
              Enquire about a programme
            </Link>
            {showProgrammes && (
              <Link href="#programmes"
                className="inline-flex h-12 items-center px-6 rounded-2xl border border-white/25 text-white
                  text-[15px] font-semibold hover:bg-white/10 transition-colors">
                See what we run
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ── Who it is for ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-5 py-14 sm:py-16">
        <h2 className="font-display text-[22px] sm:text-[26px] font-semibold text-[var(--ink)] tracking-[-0.01em]">
          Who these programmes are for
        </h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-3">
          {[
            {
              title: 'People already doing the work',
              body: 'You run projects, manage people or handle budgets, and the certification is what your CV is missing.',
            },
            {
              title: 'People being passed over',
              body: 'Experience alone is often not recognised. A credential makes the work you already do legible to a recruiter.',
            },
            {
              title: 'People changing direction',
              body: 'Moving into project management, HR or monitoring and evaluation, and wanting a recognised way in.',
            },
          ].map(card => (
            <div key={card.title}
              className="rounded-2xl bg-[var(--paper)] border border-[var(--line)] p-5">
              <h3 className="text-[15px] font-semibold text-[var(--ink)]">{card.title}</h3>
              <p className="mt-2 text-[14px] text-[var(--ink-soft)] leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The programmes, from the records ───────────────────────────── */}
      {showProgrammes && (
        <section id="programmes" className="border-y border-[var(--line)] bg-[var(--paper)]">
          <div className="mx-auto max-w-5xl px-5 py-14 sm:py-16">
            <h2 className="font-display text-[22px] sm:text-[26px] font-semibold text-[var(--ink)] tracking-[-0.01em]">
              Programmes
            </h2>
            <p className="mt-2 text-[15px] text-[var(--ink-soft)]">
              {programmes.length} {programmes.length === 1 ? 'programme' : 'programmes'} currently running.
            </p>

            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {programmes.map(p => {
                /*
                 * BOTH fees, where both are recorded.
                 *
                 * A programme is run in person and online at different prices
                 * — course_fee and course_fee_online — and this showed only
                 * the first. Somebody reading the page saw one number and had
                 * no way to learn that the online cohort costs less, which is
                 * the difference most likely to decide whether they enquire.
                 */
                const inPerson = ghs(p.feeInPerson)
                const online = ghs(p.feeOnline)
                const bothDiffer = inPerson && online && p.feeInPerson !== p.feeOnline
                const cohort = nextCohort(p)
                return (
                  <li key={p.id}
                    className="rounded-2xl border border-[var(--line)] bg-[var(--canvas)] p-5 flex flex-col">
                    <h3 className="text-[16px] font-semibold text-[var(--ink)] leading-snug">{p.name}</h3>
                    {p.description && (
                      <p className="mt-2 text-[14px] text-[var(--ink-soft)] leading-relaxed line-clamp-3">
                        {p.description}
                      </p>
                    )}

                    {/*
                      Only what the record holds. A programme with no fee shows
                      no fee — it does not show "from GHS …", an estimate, or a
                      dash where a number should be.
                    */}
                    <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                      {bothDiffer ? (
                        <>
                          <div className="flex gap-1.5">
                            <dt className="text-[var(--ink-faint)]">In person</dt>
                            <dd className="font-semibold text-[var(--ink)]">{inPerson}</dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt className="text-[var(--ink-faint)]">Online</dt>
                            <dd className="font-semibold text-[var(--ink)]">{online}</dd>
                          </div>
                        </>
                      ) : (inPerson || online) ? (
                        <div className="flex gap-1.5">
                          <dt className="text-[var(--ink-faint)]">Fee</dt>
                          <dd className="font-semibold text-[var(--ink)]">{inPerson || online}</dd>
                        </div>
                      ) : null}
                      {p.duration && (
                        <div className="flex gap-1.5">
                          <dt className="text-[var(--ink-faint)]">Duration</dt>
                          <dd className="font-medium text-[var(--ink)]">{p.duration}</dd>
                        </div>
                      )}
                      {cohort?.startDateText && (
                        <div className="flex gap-1.5">
                          <dt className="text-[var(--ink-faint)]">Next intake</dt>
                          <dd className="font-medium text-[var(--ink)]">{cohort.startDateText}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="mt-5 pt-4 border-t border-[var(--line)] flex items-center gap-4">
                      <Link href="/apply"
                        className="text-[14px] font-semibold text-[var(--accent)] hover:underline">
                        Enquire
                      </Link>
                      {p.brochureUrl && (
                        <a href={p.brochureUrl} target="_blank" rel="noopener noreferrer"
                          className="text-[14px] font-medium text-[var(--ink-soft)] hover:text-[var(--ink)]">
                          Brochure
                        </a>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ── Dates, only where a cohort is genuinely scheduled ───────────── */}
      {upcoming.length > 0 && (
        <section className="mx-auto max-w-5xl px-5 py-14 sm:py-16">
          <h2 className="font-display text-[22px] sm:text-[26px] font-semibold text-[var(--ink)] tracking-[-0.01em]">
            Starting soon
          </h2>
          <ul className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--paper)] overflow-hidden">
            {upcoming.map(({ programme, cohort }) => (
              <li key={programme.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1
                  px-5 py-4 border-b border-[var(--line-soft)] last:border-0">
                <span className="text-[15px] font-semibold text-[var(--ink)]">{programme.name}</span>
                <span className="text-[14px] text-[var(--ink-soft)]">
                  {cohort.startDateText}
                  {cohort.online ? ' · online' : cohort.venue ? ` · ${cohort.venue}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── How joining works ──────────────────────────────────────────── */}
      <section className="border-t border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:py-16">
          <h2 className="font-display text-[22px] sm:text-[26px] font-semibold text-[var(--ink)] tracking-[-0.01em]">
            How joining works
          </h2>
          <ol className="mt-7 grid gap-5 sm:grid-cols-3">
            {[
              ['Tell us what you do', 'Send an enquiry. We ask about your work first, because the right programme depends on it.'],
              ['Get the details', 'Fees, dates and what the programme covers, from an advisor who knows the field.'],
              ['Register and start', 'Complete your registration and join the next cohort.'],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3.5">
                <span aria-hidden="true"
                  className="flex-shrink-0 w-7 h-7 rounded-full bg-[var(--brand-soft)] text-[var(--brand)]
                    grid place-items-center text-[13px] font-bold">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--ink)]">{title}</h3>
                  <p className="mt-1 text-[14px] text-[var(--ink-soft)] leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-9">
            <Link href="/apply"
              className="inline-flex h-12 items-center px-6 rounded-2xl bg-[var(--accent)] text-[var(--accent-ink)]
                text-[15px] font-semibold hover:bg-[var(--accent-hover)] transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2">
              Start an enquiry
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-5xl px-5 py-10">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div>
              <div className="font-semibold text-[15px] text-[var(--ink)]">{BRAND.name}</div>
              <a href={`mailto:${BRAND.supportEmail}`}
                className="mt-1.5 inline-block text-[14px] text-[var(--accent)] hover:underline">
                {BRAND.supportEmail}
              </a>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
              <Link href="/apply" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">Enquire</Link>
              <Link href="/public-alumni" className="text-[var(--ink-soft)] hover:text-[var(--ink)]">Alumni</Link>
              {/* Staff sign-in is a footer link, not the front door. */}
              <Link href="/login" className="text-[var(--ink-faint)] hover:text-[var(--ink)]">Staff sign in</Link>
            </nav>
          </div>
          <p className="mt-8 text-[13px] text-[var(--ink-faint)]">
            © {new Date().getFullYear()} {BRAND.name}
          </p>
        </div>
      </footer>
    </div>
  )
}
