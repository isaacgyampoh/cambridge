import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pickPromotion, feeFor, modeLabelFor } from '../lib/marketing/promotionRules.ts'
import type { Programme, Cohort } from '../lib/chatbot/programmeRules.ts'

/**
 * A PERMANENT LINK PER MEMBER OF STAFF, SHOWING WHATEVER IS CURRENT.
 *
 * The URL names a person and never changes. What sits behind it is decided
 * every time it is opened, from the cohorts the centre has actually
 * scheduled — so a printed card, a QR code or an Instagram bio stays correct
 * when the promotion moves on.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

function cohort(over: Partial<Cohort> = {}): Cohort {
  return {
    name: 'Cohort', startDate: null, startDateText: null,
    schedule: null, venue: null, online: false, running: false, ...over,
  }
}

function programme(over: Partial<Programme> = {}): Programme {
  return {
    id: 'p', name: 'Programme', code: null, description: null, duration: null,
    feeInPerson: null, feeOnline: null, registrationFee: null,
    brochureUrl: null, cohorts: [], ...over,
  }
}

// The real shape, from production: one PMP record priced two ways.
const PMP = programme({
  id: 'pmp', name: 'Projects Management Professional', code: 'PMP',
  feeInPerson: 4950, feeOnline: 3950, registrationFee: 200,
})
const PHRI = programme({
  id: 'phri', name: 'Professional in Human Resources', code: 'PHRi',
  feeInPerson: 5500, feeOnline: 5000,
})

const NOW = new Date('2026-03-01T09:00:00Z')

describe('the soonest scheduled cohort is what gets promoted', () => {
  test('the nearest start date wins', () => {
    const chosen = pickPromotion([
      { ...PHRI, cohorts: [cohort({ startDate: '2026-06-01' })] },
      { ...PMP, cohorts: [cohort({ startDate: '2026-04-01' })] },
    ], NOW)
    assert.equal(chosen?.programme.name, 'Projects Management Professional')
  })

  test('a cohort that has already started is not promoted as upcoming', () => {
    const chosen = pickPromotion([
      { ...PMP, cohorts: [cohort({ startDate: '2026-01-01' })] },
      { ...PHRI, cohorts: [cohort({ startDate: '2026-05-01' })] },
    ], NOW)
    assert.equal(chosen?.programme.name, 'Professional in Human Resources')
  })

  test('one starting later today still counts', () => {
    // The comparison is against midnight, not the current moment — otherwise
    // a cohort starting at 2pm disappears from the page at 2:01pm.
    const chosen = pickPromotion([{ ...PMP, cohorts: [cohort({ startDate: '2026-03-01' })] }], NOW)
    assert.equal(chosen?.programme.name, 'Projects Management Professional')
  })

  test('nothing scheduled means no promotion is invented', () => {
    /*
     * The page then shows the centre's programmes instead. Announcing a start
     * date nobody has set would be worse than saying nothing.
     */
    assert.equal(pickPromotion([{ ...PMP, cohorts: [] }], NOW), null)
    assert.equal(pickPromotion([], NOW), null)
    assert.equal(pickPromotion([{ ...PMP, cohorts: [cohort({ startDate: null })] }], NOW), null)
  })

  test('an unparseable date is ignored rather than crashing the page', () => {
    const chosen = pickPromotion([
      { ...PMP, cohorts: [cohort({ startDate: 'not a date' })] },
      { ...PHRI, cohorts: [cohort({ startDate: '2026-05-01' })] },
    ], NOW)
    assert.equal(chosen?.programme.name, 'Professional in Human Resources')
  })
})

describe('the fee shown is the one that applies to that cohort', () => {
  test('an in-person cohort shows the in-person fee', () => {
    const chosen = pickPromotion([
      { ...PMP, cohorts: [cohort({ startDate: '2026-04-01', online: false })] },
    ], NOW)
    assert.equal(chosen?.fee, 4950)
    assert.equal(chosen?.modeLabel, 'In person')
  })

  test('an online cohort of the SAME record shows the online fee', () => {
    /*
     * This is the whole "PMP Physical / PMP Virtual" question. They are one
     * course row with two fee columns, and the cohort decides which applies —
     * so the same permanent link shows 4,950 or 3,950 depending on what the
     * centre scheduled, with no second course record anywhere.
     */
    const chosen = pickPromotion([
      { ...PMP, cohorts: [cohort({ startDate: '2026-04-01', online: true })] },
    ], NOW)
    assert.equal(chosen?.fee, 3950)
    assert.equal(chosen?.modeLabel, 'Online')
  })

  test('a programme priced only one way still shows that price', () => {
    // Showing nothing because the exact match is missing would be worse.
    const onlyInPerson = programme({ feeInPerson: 4950, feeOnline: null })
    assert.equal(feeFor(onlyInPerson, cohort({ online: true })), 4950)
    const onlyOnline = programme({ feeInPerson: null, feeOnline: 3950 })
    assert.equal(feeFor(onlyOnline, cohort({ online: false })), 3950)
  })

  test('no fee recorded stays null rather than becoming zero', () => {
    assert.equal(feeFor(programme(), cohort()), null)
  })

  test('the mode label is the one a member of the public would use', () => {
    assert.equal(modeLabelFor(cohort({ online: true })), 'Online')
    assert.equal(modeLabelFor(cohort({ online: false })), 'In person')
  })
})

describe('changing the promotion does not change the link', () => {
  test('the same code yields the same URL whatever is scheduled', () => {
    const src = codeOf('lib/marketing/link.ts')
    assert.match(src, /\/apply\/\$\{encodeURIComponent\(code\)\}/,
      'The destination is built from the code alone.')
    // Nothing about the promotion may appear in the path itself.
    const page = codeOf('app/m/[slug]/page.tsx')
    assert.match(page, /canonical: `\/m\/\$\{marketer\.code\}`/)
  })
})

describe('attribution reuses the existing lead system', () => {
  const src = codeOf('lib/marketing/link.ts')

  test('the button goes into the existing application flow', () => {
    /*
     * /apply/{code} already resolves the marketer server-side, creates the
     * lead through the existing path, de-duplicates it and assigns it. None
     * of that is reimplemented here — the marketing page only decides where
     * to point.
     */
    assert.match(src, /export function registerHref/)
    assert.match(src, /`\/apply\//)
    assert.ok(!/from\('leads'\)/.test(src), 'The marketing module must not write leads itself.')
    assert.ok(!/intakeLead/.test(src), 'Lead creation stays where it already is.')
  })

  test('the registration is tagged so it can be told apart', () => {
    assert.match(src, /utm_source: 'marketing_link'/)
    assert.match(src, /utm_medium: 'staff_link'/)
    assert.match(src, /utm_content: code/, 'The code identifies which link produced it.')
  })

  test('and `source` is left alone rather than invented', () => {
    /*
     * LEAD_SOURCES is a fixed enum. Adding a value would mean a database
     * migration to record something the UTM columns already carry, and a
     * marketer's link genuinely is a referral.
     */
    // \b matters: `utm_source` must not match, only a bare `source:` key.
    assert.ok(!/\bsource: 'marketing/.test(src))
    assert.match(src, /utm_source: 'marketing_link'/, 'the UTM tag is still the mechanism')
  })

  test('the apply form already reads those parameters', () => {
    // The reason this needs no change at the other end, asserted rather than
    // assumed — if the form stops forwarding UTM, attribution goes quiet.
    const form = codeOf('app/apply/[marketerId]/page.tsx')
    assert.match(form, /utm_source/)
    assert.match(form, /marketer_code: marketerId/)
  })
})

describe('a public marketing page leaks nothing internal', () => {
  const src = codeOf('lib/marketing/link.ts')

  test('the profile id is never selected', () => {
    /*
     * The page does not need it: attribution happens at submit time, where
     * the code is resolved server-side. Selecting a column is how it ends up
     * in a payload later.
     */
    const select = src.match(/\.select\('([^']*)'\)/)
    assert.ok(select, 'the profile select must still be there')
    for (const forbidden of ['id', 'role', 'phone', 'email', 'portals', 'pin_hash']) {
      assert.ok(!select[1].split(',').map(c => c.trim()).includes(forbidden),
        `${forbidden} is selected on a public marketing page.`)
    }
  })

  test('what reaches the page is only a name and the code already in the URL', () => {
    assert.match(src, /export type PublicMarketer = \{[\s\S]*?\}/)
    const type = src.slice(src.indexOf('export type PublicMarketer'), src.indexOf('export async function loadMarketerByCode'))
    assert.ok(!/\bid\b/.test(type), 'PublicMarketer must not carry an id.')
  })

  test('a deactivated member of staff’s link stops working', () => {
    // Leads arriving on it would be assigned to somebody who has left — which
    // reads to the enquirer as being ignored.
    assert.match(src, /if \(row\.is_active === false\) return null/)
  })

  test('the page is not indexed', () => {
    const page = codeOf('app/m/[slug]/page.tsx')
    assert.match(page, /robots: \{ index: false, follow: false \}/)
  })
})

describe('the link previews properly when shared', () => {
  test('the page is rendered on the server, for crawlers that run no JavaScript', () => {
    const page = codeOf('app/m/[slug]/page.tsx')
    assert.match(page, /export async function generateMetadata/)
    assert.ok(!page.includes("'use client'"))
  })

  test('the card is generated from the same data as the page', () => {
    /*
     * A fixed image would be wrong as soon as the promotion moved on, which
     * is the failure a permanent link exists to avoid.
     */
    const og = codeOf('app/m/[slug]/opengraph-image.tsx')
    assert.match(og, /loadMarketingPage\(slug\)/)
    assert.match(og, /size = \{ width: 1200, height: 630 \}/)
  })

  test('and a card that cannot be built still produces a card', () => {
    const og = codeOf('app/m/[slug]/opengraph-image.tsx')
    assert.match(og, /catch \{/, 'A failed read must not leave WhatsApp with nothing.')
  })

  test('metadata does not override the generated image', () => {
    const page = codeOf('app/m/[slug]/page.tsx')
    const ogBlock = page.slice(page.indexOf('openGraph: {'), page.indexOf('robots:'))
    assert.ok(!ogBlock.includes('images'),
      'Naming an image here replaces the generated card with a fixed file.')
  })
})

describe('the flyer preview still works', () => {
  test('the flyer image is still the flyer preview', () => {
    // /m uses a generated card; /f must keep using the actual flyer.
    const flyer = codeOf('app/f/[id]/page.tsx')
    assert.match(flyer, /const image = flyer\.imageUrl/)
    assert.match(flyer, /summary_large_image/)
  })

  test('staff can send a flyer to WhatsApp without building a URL', () => {
    const page = codeOf('app/(portal)/marketer/flyers/page.tsx')
    assert.match(page, /wa\.me\/\?text=/)
    assert.match(page, /linkFor\(f\.id\)/, 'The WhatsApp message must carry the flyer link.')
  })

  test('and so can they for their marketing links', () => {
    const share = codeOf('components/shared/ShareLink.tsx')
    assert.match(share, /wa\.me\/\?text=/)
    // An anchor, not a button behind a feature check — navigator.share does
    // not exist on most desktop browsers, which is where this was missing.
    assert.match(share, /href=\{whatsappHref\}/)
  })
})

/**
 * ─── VISITS ARE COUNTED WITHOUT KNOWING WHO ANYBODY IS ──────────────────────
 */
describe('an open is recorded, a person is not', () => {
  const beacon = codeOf('app/m/[slug]/VisitBeacon.tsx')
  const api = codeOf('app/api/marketing/visit/route.ts')
  const sql = readFileSync('supabase/migrations/0019_marketing_visits.sql', 'utf8')

  test('the session value dies with the browser session', () => {
    /*
     * It must survive a refresh — or reloading is a second visitor — and must
     * NOT survive the browser closing, or it becomes a way of recognising
     * somebody weeks later. sessionStorage is exactly that window.
     */
    assert.match(beacon, /sessionStorage/)
    assert.ok(!/localStorage/.test(beacon), 'localStorage would outlive the visit.')
    assert.ok(!/document\.cookie/.test(beacon))
  })

  test('nothing identifying is accepted by the endpoint', () => {
    const schema = api.slice(api.indexOf('const Body ='), api.indexOf('function hostOf'))
    for (const field of ['name', 'phone', 'email', 'ip']) {
      assert.ok(!schema.includes(`${field}:`), `${field} must not be accepted by a visit beacon.`)
    }
  })

  test('the referrer is reduced to a hostname before storage', () => {
    // A full referring URL can itself carry personal information.
    assert.match(api, /new URL\(referrer\)\.hostname/)
    assert.match(sql, /referrer_host/)
  })

  test('no IP or user agent is stored', () => {
    assert.ok(!/ip_address|user_agent/i.test(sql))
  })

  test('the link is stored by its public code, not a profile id', () => {
    assert.match(sql, /marketer_code TEXT NOT NULL/)
    assert.ok(!/marketer_id UUID/.test(sql),
      'An anonymous write must not carry an internal identifier.')
  })

  test('a refresh is not a second visit', () => {
    assert.match(sql, /CREATE UNIQUE INDEX[\s\S]{0,200}marketer_code, session_id/)
  })

  test('the beacon never interrupts the visitor', () => {
    assert.match(beacon, /return null/)
    assert.match(beacon, /\.catch\(\(\) => \{\}\)/)
  })
})

describe('"nothing counted yet" is never shown as zero', () => {
  /*
   * The reason visitsForCode returns a shape rather than a number. A marketer
   * who reads "0 opened" concludes their link does not work and stops sharing
   * it — the worst possible response to a counter that is simply not switched
   * on yet.
   */
  const visits = codeOf('lib/marketing/visits.ts')

  test('a missing table is a distinct state, not an empty count', () => {
    assert.match(visits, /counting: false/)
    assert.match(visits, /does not exist\|could not find\|schema cache/)
    assert.match(visits, /0019/, 'The reason must name the migration to run.')
  })

  test('the marketer screen says so in words', () => {
    const page = codeOf('app/(portal)/marketer/link/page.tsx')
    assert.match(page, /Opens are not being counted yet/)
    assert.match(page, /marketing\.visits\?\.counting \? marketing\.visits\.sessions : '—'/,
      'An uncounted state must render as a dash, never a zero.')
  })

  test('and the admin screen does too', () => {
    const page = codeOf('app/(portal)/admin/marketers/page.tsx')
    assert.match(page, /Opens not counted yet/)
    assert.match(page, /r\.visits === null \? '—' : r\.visits/)
  })

  test('the overview reports null rather than zero when nothing is counted', () => {
    const api = codeOf('app/api/marketing/overview/route.ts')
    assert.match(api, /visits === null \? null :/)
    assert.match(api, /countingVisits: visits !== null/)
  })
})

describe('a marketer sees only their own figures', () => {
  const api = codeOf('app/api/marketing/me/route.ts')

  test('the code comes from their session, not the request', () => {
    // There is no parameter to change, so there is no colleague to ask about.
    assert.match(api, /\.eq\('id', ctx\.session\.userId!\)/)
    assert.ok(!/searchParams/.test(api), 'A code from the query would let one marketer read another.')
  })

  test('it returns counts, never the leads themselves', () => {
    assert.match(api, /head: true/, 'Counts only.')
    assert.ok(!/\.select\('\*'\)/.test(api))
  })

  test('the admin view is gated on the existing marketers portal', () => {
    const overview = codeOf('app/api/marketing/overview/route.ts')
    assert.match(overview, /portals: \['marketers'\]/,
      'Reuse the permission that already governs this screen, not a new rule.')
  })
})

describe('the marketing routes do not run at build time', () => {
  /*
   * A regression this actually caused: with `revalidate` alone, adding these
   * routes put two more programme reads into build-time page collection. On a
   * machine that could not reach the database each held a worker for its full
   * timeout, until an unrelated page — /welcome — ran out of time and the
   * whole build failed.
   *
   * There is no finite set of staff codes to prerender, and a marketing link
   * must be current anyway: a cached fee from a previous cohort is the one
   * thing this page cannot afford to show.
   */
  for (const file of ['app/m/[slug]/page.tsx', 'app/m/[slug]/opengraph-image.tsx']) {
    test(`${file.split('/').pop()} is request-time only`, () => {
      const src = codeOf(file)
      assert.match(src, /export const dynamic = 'force-dynamic'/)
      assert.ok(!/export const revalidate/.test(src),
        'revalidate here makes the build fetch programmes for a page nobody asked for.')
    })
  }
})
