import { createServiceClient } from '@/lib/supabase/server'
import { GraduationCap, Briefcase, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { BRAND } from '@/lib/brand'
import type { Alumnus } from '@/types'

/**
 * The public alumni page.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * A full-bleed green banner filled the first screen, and under it sat three
 * figures: "0+ Graduates", "100% Certified", "5 Rating". Only the first came
 * from anything — and it read "0+" because nobody has been published yet. The
 * other two were typed in. A prospective student arriving here was shown a
 * wall of colour and two numbers the institution had not earned.
 *
 * It is a light page now. Green appears on the course a person completed and
 * on nothing else, so the eye goes to the people rather than to the
 * decoration, and the count is stated only when there is a real one.
 */

/** "Manager at Acme", and nothing at all when neither is recorded. */
function role(a: Alumnus): string | null {
  // This was .join('at ') — no leading space — so it rendered "Managerat Acme".
  const parts = [a.current_job_title, a.current_company].filter(Boolean)
  if (!parts.length) return null
  return parts.join(' at ')
}

function Portrait({ a, size }: { a: Alumnus; size: number }) {
  return (
    <span
      className="rounded-full overflow-hidden flex-shrink-0 grid place-items-center
        bg-[var(--brand-soft)] text-[var(--accent)] font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
    >
      {a.photo_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={a.photo_url} alt="" className="w-full h-full object-cover" />
        : (a.full_name || '?').charAt(0)}
    </span>
  )
}

function Person({ a, featured }: { a: Alumnus; featured?: boolean }) {
  const job = role(a)
  return (
    <article className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
      <div className="flex items-center gap-3.5">
        <Portrait a={a} size={featured ? 56 : 44} />
        <div className="min-w-0">
          <h3 className="font-semibold text-[var(--ink)] truncate
            text-[16px] leading-snug">
            {a.full_name}
          </h3>
          {a.course_completed && (
            <p className="flex items-center gap-1.5 text-[13px] text-[var(--accent)] mt-0.5">
              <GraduationCap size={13} aria-hidden="true" className="flex-shrink-0" />
              <span className="truncate">{a.course_completed}</span>
            </p>
          )}
        </div>
      </div>

      {job && (
        <p className="flex items-center gap-1.5 text-[13px] text-[var(--ink-soft)] mt-3">
          <Briefcase size={13} aria-hidden="true" className="flex-shrink-0" />
          <span className="truncate">{job}</span>
        </p>
      )}

      {a.testimonial && (
        <blockquote className="text-[14px] text-[var(--ink-soft)] mt-3.5 leading-relaxed">
          “{a.testimonial}”
        </blockquote>
      )}
    </article>
  )
}

export default async function PublicAlumniPage() {
  const sb = createServiceClient()
  const { data } = await sb.from('alumni')
    .select('*')
    .eq('is_published', true)
    .order('is_featured', { ascending: false })
    .order('graduation_date', { ascending: false })

  const alumni = (data || []) as Alumnus[]
  const featured = alumni.filter(a => a.is_featured)
  const rest = alumni.filter(a => !a.is_featured)

  return (
    <div className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      <header className="px-5 pt-14 pb-10 sm:pt-20 sm:pb-12">
        <div className="max-w-3xl mx-auto text-center">
          <p className="t-overline mb-3">{BRAND.shortName}</p>
          <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.015em]
            leading-tight text-[var(--ink)]">
            Where our graduates are now
          </h1>
          <p className="text-[15px] sm:text-[16px] text-[var(--ink-soft)] mt-3
            max-w-[46ch] mx-auto leading-relaxed">
            Real people, real results — the people who studied here and what they
            went on to do.
          </p>

          {/* Stated only when there is something true to state. */}
          {alumni.length > 0 && (
            <p className="text-[13px] text-[var(--ink-faint)] mt-6">
              <span className="numeric font-semibold text-[var(--ink)]">{alumni.length}</span>
              {' '}{alumni.length === 1 ? 'story' : 'stories'} published
            </p>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 pb-20">
        {alumni.length === 0 ? (
          <div className="text-center py-16">
            <span aria-hidden="true"
              className="w-12 h-12 rounded-2xl border border-[var(--line)] bg-[var(--paper)]
                grid place-items-center mx-auto mb-4 text-[var(--ink-faint)]">
              <GraduationCap size={20} strokeWidth={1.5} />
            </span>
            <p className="text-[15px] font-semibold text-[var(--ink)]">
              Alumni stories are on their way
            </p>
            <p className="t-sub mt-1.5 max-w-[36ch] mx-auto">
              As our first cohorts complete their programmes, their stories will
              appear here.
            </p>
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <section className="mb-12">
                <h2 className="t-overline mb-4">Featured</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {featured.map(a => <Person key={a.id} a={a} featured />)}
                </div>
              </section>
            )}

            {rest.length > 0 && (
              <section>
                <h2 className="t-overline mb-4">
                  {featured.length > 0 ? 'More graduates' : 'Our graduates'}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {rest.map(a => <Person key={a.id} a={a} />)}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="px-5 pb-10 text-center">
        {/*
          /refer, not /apply.

          /apply only exists as /apply/[marketerId] — a link belonging to a
          particular member of staff. Bare /apply matches no route, so the
          proxy sent it to /login: a prospective student who pressed
          "Start your application" on a public page landed on a staff PIN
          screen. /refer is the public route for somebody with no marketer,
          and a course advisor picks the enquiry up from there.

          Link rather than <a>, so it navigates in the app instead of
          reloading the whole page.
        */}
        <Link href="/refer"
          className="inline-flex items-center gap-2 h-12 px-6 rounded-xl
            bg-[var(--accent)] text-[var(--accent-ink)] text-[15px] font-semibold
            hover:bg-[var(--accent-hover)] transition-colors">
          Enquire about a programme
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <p className="text-[12px] text-[var(--ink-faint)] mt-6">
          {BRAND.name}
        </p>
      </footer>
    </div>
  )
}
