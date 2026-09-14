import Link from 'next/link'
import { BRAND } from '@/lib/brand'
import type { Programme } from '@/lib/chatbot/programmeRules'
import type { Promotion } from '@/lib/marketing/promotionRules'

/**
 * What somebody sees when they open a member of staff's link.
 *
 * A server component with no interactivity of its own: everything on it is a
 * link, so there is nothing to hydrate. That matters because most of these
 * arrive from WhatsApp on a phone, often on a slow connection — the page
 * should be readable the moment it lands.
 *
 * Mobile first throughout, for the same reason.
 */

function ghs(n: number | null | undefined): string | null {
  return typeof n === 'number' && n > 0 ? `GHS ${n.toLocaleString('en-GH')}` : null
}

export default function MarketingLanding({
  marketerName, promotion, programmes, programmesUnavailable, registerHref,
}: {
  marketerName: string
  promotion: Promotion | null
  programmes: Programme[]
  programmesUnavailable: boolean
  registerHref: string
}) {
  return (
    <main className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      <div className="mx-auto w-full max-w-lg px-5 py-10 sm:py-14">

        <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[var(--ink-faint)]">
          {BRAND.name}
        </p>

        {promotion ? (
          <>
            <h1 className="mt-3 text-[27px] sm:text-[32px] font-semibold leading-tight text-[var(--ink)]">
              {promotion.programme.name}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-[var(--line)]
                px-3 py-1 text-[12px] font-medium text-[var(--ink-soft)]">
                {promotion.modeLabel}
              </span>
              {promotion.cohort.startDateText && (
                <span className="inline-flex items-center rounded-full border border-[var(--line)]
                  px-3 py-1 text-[12px] font-medium text-[var(--ink-soft)]">
                  Starts {promotion.cohort.startDateText}
                </span>
              )}
            </div>

            {/*
              The fee, from the course record itself. Shown only when one is
              actually recorded — an empty space is honest, and a zero is not.
            */}
            {ghs(promotion.fee) && (
              <p className="mt-5 text-[25px] font-semibold text-[var(--ink)]">
                {ghs(promotion.fee)}
              </p>
            )}

            {promotion.programme.description && (
              <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-soft)]">
                {promotion.programme.description}
              </p>
            )}

            <dl className="mt-6 space-y-2.5 text-[14px]">
              {promotion.programme.duration && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--ink-faint)]">Duration</dt>
                  <dd className="font-medium text-[var(--ink)]">{promotion.programme.duration}</dd>
                </div>
              )}
              {promotion.cohort.schedule && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--ink-faint)]">Schedule</dt>
                  <dd className="font-medium text-[var(--ink)] text-right">{promotion.cohort.schedule}</dd>
                </div>
              )}
              {!promotion.cohort.online && promotion.cohort.venue && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--ink-faint)]">Venue</dt>
                  <dd className="font-medium text-[var(--ink)] text-right">{promotion.cohort.venue}</dd>
                </div>
              )}
            </dl>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-[27px] sm:text-[32px] font-semibold leading-tight text-[var(--ink)]">
              Professional training in Accra
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-soft)]">
              {programmesUnavailable
                /*
                 * The programme records could not be read. Somebody has
                 * followed a link a colleague shared, so they still get the
                 * centre and a way to apply — but no claim about programmes
                 * or prices that could not be checked.
                 */
                ? 'Register your interest and we will be in touch with the current programmes and fees.'
                : 'Register your interest and we will be in touch about the next intake.'}
            </p>

            {!programmesUnavailable && programmes.length > 0 && (
              <ul className="mt-6 space-y-3">
                {programmes.slice(0, 6).map(p => {
                  const fee = ghs(p.feeInPerson ?? p.feeOnline)
                  return (
                    <li key={p.id}
                      className="flex items-baseline justify-between gap-4 rounded-xl
                        border border-[var(--line)] px-4 py-3">
                      <span className="text-[14px] font-medium text-[var(--ink)]">{p.name}</span>
                      {fee && <span className="text-[13px] text-[var(--ink-soft)] whitespace-nowrap">{fee}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}

        {/*
          One action. This goes into the existing application flow on the
          existing marketer code, so the lead is created, de-duplicated and
          attributed by exactly the code that handles every other
          registration.
        */}
        <Link href={registerHref}
          className="mt-8 flex w-full items-center justify-center rounded-2xl
            bg-[var(--ink)] px-6 py-4 text-[15px] font-semibold text-[var(--canvas)]
            min-h-[52px] transition-opacity hover:opacity-90">
          Register your interest
        </Link>

        <p className="mt-4 text-center text-[13px] text-[var(--ink-soft)]">
          Shared by {marketerName}
        </p>

        {/*
          Both fees, when a programme is priced two ways and the promoted
          cohort is only one of them. Somebody deciding between attending in
          person and online should not have to ask.
        */}
        {promotion && promotion.programme.feeInPerson && promotion.programme.feeOnline
          && promotion.programme.feeInPerson !== promotion.programme.feeOnline && (
          <p className="mt-6 text-center text-[12px] text-[var(--ink-faint)]">
            {ghs(promotion.programme.feeInPerson)} in person · {ghs(promotion.programme.feeOnline)} online
          </p>
        )}
      </div>
    </main>
  )
}
