import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  groupByIndustry, breakdownBalances, UNSTATED, UNSTATED_LABEL,
  CONVERTED_STATUS, CLOSED_STATUSES,
} from '../lib/leads/industryStats.ts'

/**
 * A STAFF MEMBER'S LEADS, GROUPED BY WHAT THOSE PEOPLE DO.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 *
 * A marketer with thirty leads had one list of thirty names. The thing they
 * actually do is ring the eight people in construction about the same
 * programme, one after another — and sorting that out by eye, every morning,
 * was work the system was leaving to them.
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────
 *
 * The groups are shown beside a quota figure computed from the same leads. A
 * breakdown that double-counts makes the quota look wrong, and the quota is
 * the number somebody is measured against. So every lead lands in exactly one
 * group and the groups add up to the total.
 */

const lead = (industry: string | null, status = 'new', course = 'PMP') =>
  ({ industry, status, course_interest: course })

describe('counting the groups', () => {
  const leads = [
    lead('agribusiness'), lead('agribusiness', 'registered'), lead('agribusiness', 'lost'),
    lead('construction_engineering'), lead('construction_engineering', 'contacted'),
    lead('financial_services', 'registered'),
    lead(null), lead(''),
  ]
  const out = groupByIndustry(leads)

  test('every lead is in exactly one group, and they add up', () => {
    assert.equal(breakdownBalances(out), true)
    assert.equal(out.total, 8)
    assert.equal(out.groups.reduce((n, g) => n + g.total, 0), 8)
  })

  test('the counts are the real ones', () => {
    const agri = out.groups.find(g => g.code === 'agribusiness')!
    assert.equal(agri.total, 3)
    assert.equal(agri.converted, 1)
    // Registered and lost are both finished; one lead is still open.
    assert.equal(agri.pending, 1)
  })

  test('converted means what the rest of the system means by it', () => {
    /*
     * Not a second opinion. lib/analytics/leadStats.ts decides what counts as
     * a conversion, and a dashboard that disagreed with the reports would be
     * two sets of figures for one question.
     */
    assert.equal(CONVERTED_STATUS, 'registered')
    for (const closed of ['registered', 'lost', 'not_interested', 'done']) {
      assert.ok(CLOSED_STATUSES.includes(closed))
    }
  })

  test('leads with no industry are a group, not a disappearance', () => {
    const none = out.groups.find(g => g.code === UNSTATED)!
    assert.equal(none.total, 2)
    assert.equal(none.label, UNSTATED_LABEL)
    assert.equal(out.unstated, 2)
  })

  test('and they are never counted twice', () => {
    // Once in their own group AND once in a catch-all is how a breakdown
    // comes to exceed the total it breaks down.
    const codes = out.groups.map(g => g.code)
    assert.equal(new Set(codes).size, codes.length)
  })

  test('an unrecognised industry code is treated as not stated', () => {
    // A code retired from the list leaves rows behind. They are still leads.
    const stray = groupByIndustry([lead('mining_old_code'), lead('mining')])
    assert.equal(stray.total, 2)
    assert.equal(breakdownBalances(stray), true)
    assert.equal(stray.groups.find(g => g.code === UNSTATED)?.total, 1)
  })

  test('biggest first, with "not stated" always last', () => {
    /*
     * The group somebody works through first is the one with the most people
     * in it. "Not stated" is a gap to fill, not a sector to work, so it sits
     * at the end however big it gets.
     */
    const many = groupByIndustry([
      ...Array(5).fill(null).map(() => lead(null)),
      ...Array(3).fill(null).map(() => lead('mining')),
      ...Array(4).fill(null).map(() => lead('agribusiness')),
    ])
    assert.deepEqual(many.groups.map(g => g.code), ['agribusiness', 'mining', UNSTATED])
  })

  test('the courses inside an industry are kept apart', () => {
    /*
     * "PMP — Agribusiness" and "Data Analytics — Agribusiness" are the
     * distinction somebody needs when they open the group.
     */
    const mixed = groupByIndustry([
      lead('agribusiness', 'new', 'PMP'),
      lead('agribusiness', 'new', 'PMP'),
      lead('agribusiness', 'new', 'Data Analytics'),
    ])
    const agri = mixed.groups[0]
    assert.deepEqual(agri.courses, [
      { course: 'PMP', count: 2 },
      { course: 'Data Analytics', count: 1 },
    ])
    assert.equal(agri.courses.reduce((n, c) => n + c.count, 0), agri.total)
  })

  test('a lead with no course is still counted in its industry', () => {
    const out2 = groupByIndustry([lead('mining', 'new', '')])
    assert.equal(out2.groups[0].total, 1)
    assert.deepEqual(out2.groups[0].courses, [{ course: 'Not stated', count: 1 }])
  })

  test('no leads is an empty breakdown, not a crash', () => {
    const empty = groupByIndustry([])
    assert.deepEqual(empty.groups, [])
    assert.equal(empty.total, 0)
    assert.equal(breakdownBalances(empty), true)
  })
})

/* ─────────────────────────────────────────────────────────────────────────── */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('whose leads are counted', () => {
  const route = codeOf('app/api/leads/industry-summary/route.ts')

  test('your own, unless you manage other people', () => {
    assert.match(route, /query\.eq\('assigned_to', staffId \|\| session\.userId\)/)
    assert.match(route, /MANAGERS\.includes\(String\(session\.role\)\)/)
  })

  test('asking for somebody else\'s is refused, not quietly answered about yours', () => {
    /*
     * A silent substitution is how a manager comes to believe they are
     * looking at a colleague's figures.
     */
    /*
     * The guard itself, not the words inside it. `if (false) { … }` leaves
     * both the status and the sentence in the file while refusing nobody.
     */
    assert.match(route, /if \(\(staffId && staffId !== session\.userId\) \|\| scope === 'all'\) \{/)
    assert.match(route, /if \(!manager\) \{/)
    assert.match(route, /status: 403/)
    assert.match(route, /only see the industries of your own leads/)
  })

  test('the counts are taken across every lead, not one page of them', () => {
    // Counting the loaded page would say "Mining 12" meaning twelve on this
    // screen, beside a quota figure covering everything.
    assert.match(route, /from\('leads'\)\.select\('industry, status, course_interest'\)/)
  })

  test('a failed read is not an empty desk', () => {
    // "You have no leads" is a sentence somebody would act on.
    assert.match(route, /if \(failed\) return unavailable/)
  })

  test('a database without the column says so instead of failing', () => {
    assert.match(route, /await columnExists\('leads', 'industry'\)/)
    assert.match(route, /available: false/)
  })
})

describe('the screens that show the groups', () => {
  test('a marketer can open a group and get back out', () => {
    const page = codeOf('app/(portal)/marketer/leads/page.tsx')
    assert.match(page, /setIndustry\(active \? null : g\.code\)/)
    assert.match(page, /Show all leads/)
  })

  test('the status filters and the search still apply inside a group', () => {
    const page = codeOf('app/(portal)/marketer/leads/page.tsx')
    const filter = page.slice(page.indexOf('return leads.filter(lead =>'))
    const body = filter.slice(0, filter.indexOf('}, [leads'))
    assert.match(body, /if \(industry\)/)
    assert.match(body, /if \(tab !== 'all'/)
    assert.match(body, /needle/)
  })

  test('the counts come from the server, not from the rows on screen', () => {
    const page = codeOf('app/(portal)/marketer/leads/page.tsx')
    assert.match(page, /\/api\/leads\/industry-summary/)
    assert.ok(!/groups = useMemo/.test(page), 'the groups are being counted in the browser')
  })

  test('a manager sees the same grouping across the whole desk', () => {
    const page = codeOf('app/(portal)/admin/leads/page.tsx')
    assert.match(page, /industry-summary\?scope=all/)
    // The expression, not the name: `true || …` keeps the name and filters
    // nothing.
    assert.match(page, /const matchIndustry = !industryFilter \|\| \(industryFilter === UNSTATED/)
    assert.match(page, /matchSearch && matchSource && matchStatus && matchIndustry/)
  })

  test('the dashboard table is separate from the quota, and links into the list', () => {
    /*
     * Read as one block, industry totals look like progress towards a target
     * and do not add up to it. They are a breakdown of everything held; the
     * target is a period figure.
     */
    const page = codeOf('app/(portal)/marketer/page.tsx')
    assert.match(page, /Your leads by industry/)
    assert.match(page, /\/marketer\/leads\?industry=\$\{encodeURIComponent\(g\.code\)\}/)
    assert.ok(page.indexOf('Your target') < page.indexOf('Your leads by industry'),
      'the breakdown is above the target it must not be confused with')
  })

  test('arriving from the dashboard opens that industry', () => {
    const page = codeOf('app/(portal)/marketer/leads/page.tsx')
    assert.match(page, /params\.get\('industry'\)/)
    assert.match(page, /if \(industryParam\) setIndustry\(industryParam\)/)
  })
})

describe('a lead that arrives from a form keeps its industry', () => {
  test('the intake takes one and parses it onto our list', () => {
    const intake = codeOf('lib/leadIntake.ts')
    assert.match(intake, /const industryCode = parseIndustry\(input\.industry\)/)
    assert.match(intake, /columnExists\('leads', 'industry'\)/)
    /*
     * And it reaches the insert. Working it out and then not spreading it in
     * is the same as not having it — which a test for the calculation alone
     * cannot tell apart.
     */
    const insert = intake.slice(intake.indexOf("from('leads').insert({"))
    assert.match(insert.slice(0, insert.indexOf('}).select()')), /\.\.\.industryField,/)
  })

  test('the Facebook webhook passes what the form asked', () => {
    const hook = codeOf('app/api/webhooks/facebook/route.ts')
    assert.match(hook, /fields\.industry \|\| fields\.sector \|\| fields\.business_sector/)
    assert.match(hook, /education_level: education, industry,/)
  })
})
