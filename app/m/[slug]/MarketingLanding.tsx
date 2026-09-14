import Link from 'next/link'
import Image from 'next/image'
import { BRAND } from '@/lib/brand'
import type { Programme } from '@/lib/chatbot/programmeRules'
import type { Promotion } from '@/lib/marketing/promotionRules'
import type { CampaignImage } from '@/lib/marketing/link'
import { RemoteImage } from '@/components/shared/RemoteImage'

/**
 * A Cambridge campaign, as somebody opening it from WhatsApp sees it.
 *
 * ── WHAT WAS WRONG WITH THE FIRST VERSION ──────────────────────────────────
 *
 * It was a heading, a list of three programmes with prices, and a button. No
 * picture, no explanation of who the centre is, nothing about the programme
 * itself, and one action — register — aimed only at people who had already
 * decided. It read as generated, because structurally it was: a shape that
 * would suit any training provider anywhere.
 *
 * ── WHAT AN ADVERTISEMENT ACTUALLY NEEDS ───────────────────────────────────
 *
 * The flyer first, because that is the thing the centre designed and the only
 * part anybody looks at before deciding whether to keep reading. Then what
 * the programme is and who it is for, then the facts that answer the first
 * questions — when it starts, how it is taught, what it costs — and then two
 * actions rather than one, because most people arriving from a shared link
 * have not decided yet.
 *
 * ── NOTHING HERE IS INVENTED ───────────────────────────────────────────────
 *
 * Every fact on this page comes from the ERP: the programme name, its
 * description, its duration, the cohort's start date, venue and schedule, and
 * the fee that applies to that cohort. Where a record is empty the line is
 * absent. There are no testimonials, no student counts, no pass rates and no
 * accreditation claims, because the ERP does not hold any and a marketing
 * page is the worst possible place to start making them up.
 *
 * Flat surfaces, one accent, real type. No gradients, no glass, no icon per
 * line — the flyer carries the visual weight and everything else gets out of
 * its way.
 */

function ghs(n: number | null | undefined): string | null {
  return typeof n === 'number' && n > 0 ? `GHS ${n.toLocaleString('en-GH')}` : null
}

/** One fact. Rendered only when the ERP actually holds it. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5
      border-b border-[var(--line-soft)] last:border-0">
      <dt className="text-[13px] text-[var(--ink-faint)] shrink-0">{label}</dt>
      <dd className="text-[14px] font-medium text-[var(--ink)] text-right">{value}</dd>
    </div>
  )
}

export default function MarketingLanding({
  marketerName, image, promotion, programmes, programmesUnavailable, registerHref, EnquiryForm,
}: {
  marketerName: string
  image: CampaignImage | null
  promotion: Promotion | null
  programmes: Programme[]
  programmesUnavailable: boolean
  registerHref: string
  EnquiryForm: React.ReactNode
}) {
  const programme = promotion?.programme ?? null
  const fee = ghs(promotion?.fee)

  return (
    <main className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      {/* ── Who this is from. Plain, above everything. ── */}
      <header className="border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto flex max-w-xl items-center gap-2.5 px-5 py-3.5">
          <Image
            src={BRAND.logo} alt="" width={28} height={28}
            className="h-7 w-7 object-contain" priority
          />
          <span className="text-[13px] font-semibold tracking-tight text-[var(--ink)]">
            {BRAND.name}
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-5 pb-14">

        {/*
          The flyer.
          Unoptimised because it is a Cloudinary URL the marketer uploaded, and
          sized 4:5 — the shape a flyer designed on a phone actually is.
        */}
        {image?.url && (
          <div className="mt-5 overflow-hidden rounded-lg border border-[var(--line)]
            bg-[var(--paper)]">
            <RemoteImage
              src={image.url}
              alt={image.title || (programme ? `${programme.name} at ${BRAND.name}` : BRAND.name)}
              className="w-full object-cover"
              eager
            />
          </div>
        )}

        {promotion && programme ? (
          <>
            <h1 className="mt-6 text-[26px] sm:text-[30px] font-semibold leading-[1.15]
              tracking-tight text-[var(--ink)]">
              {programme.name}
            </h1>

            <p className="mt-2 text-[14px] font-medium text-[var(--ink-soft)]">
              {promotion.modeLabel}
              {promotion.cohort.startDateText && <> · Starts {promotion.cohort.startDateText}</>}
            </p>

            {fee && (
              <p className="mt-4 text-[28px] font-semibold tracking-tight text-[var(--ink)]">
                {fee}
              </p>
            )}

            {programme.description && (
              <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-soft)]">
                {programme.description}
              </p>
            )}

            <dl className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-4">
              <Fact label="Programme" value={programme.name} />
              <Fact label="Delivery" value={promotion.modeLabel} />
              <Fact label="Starts" value={promotion.cohort.startDateText} />
              <Fact label="Duration" value={programme.duration} />
              <Fact label="Schedule" value={promotion.cohort.schedule} />
              <Fact label="Venue" value={promotion.cohort.online ? null : promotion.cohort.venue} />
              <Fact label="Fee" value={fee} />
              <Fact label="Registration" value={ghs(programme.registrationFee)} />
            </dl>

            {/*
              Both prices, when the programme is taught two ways and this
              cohort is only one of them. Somebody weighing attending in person
              against online should not have to ask.
            */}
            {programme.feeInPerson && programme.feeOnline
              && programme.feeInPerson !== programme.feeOnline && (
              <p className="mt-2.5 text-[13px] text-[var(--ink-faint)]">
                {ghs(programme.feeInPerson)} in person · {ghs(programme.feeOnline)} online
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="mt-6 text-[26px] sm:text-[30px] font-semibold leading-[1.15]
              tracking-tight text-[var(--ink)]">
              Professional certification training
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-soft)]">
              {BRAND.description}
            </p>

            {!programmesUnavailable && programmes.length > 0 && (
              <dl className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-4">
                {programmes.slice(0, 8).map(p => (
                  <Fact key={p.id} label={p.name} value={ghs(p.feeInPerson ?? p.feeOnline)} />
                ))}
              </dl>
            )}

            <p className="mt-4 text-[14px] text-[var(--ink-soft)]">
              {programmesUnavailable
                /*
                 * The programme records could not be read. They still get the
                 * centre, the person who invited them and a way to make
                 * contact — but no claim about programmes or prices that could
                 * not be checked.
                 */
                ? 'Leave your details and we will be in touch with the current programmes and fees.'
                : 'Leave your details and we will tell you when the next intake opens.'}
            </p>
          </>
        )}

        {/* ── The two actions. ── */}
        <div className="mt-7 space-y-2.5">
          {/*
            Register goes into the existing application flow on this
            marketer's code, so the lead is created, de-duplicated and
            attributed by the same code that handles every other registration.
          */}
          <Link
            href={registerHref}
            className="flex w-full min-h-[52px] items-center justify-center rounded-lg
              bg-[var(--ink)] px-6 py-3.5 text-[15px] font-semibold text-[var(--paper)]
              transition-opacity hover:opacity-90">
            Register now
          </Link>

          {EnquiryForm}
        </div>

        <p className="mt-7 text-center text-[13px] text-[var(--ink-soft)]">
          Shared by {marketerName}
        </p>

        <footer className="mt-10 border-t border-[var(--line)] pt-5 text-center">
          <p className="text-[12px] text-[var(--ink-faint)]">
            {BRAND.name} · Accra, Ghana
          </p>
          <a
            href={`mailto:${BRAND.supportEmail}`}
            className="mt-1 inline-block text-[12px] text-[var(--ink-soft)] underline underline-offset-2">
            {BRAND.supportEmail}
          </a>
        </footer>
      </div>
    </main>
  )
}
