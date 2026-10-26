import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  INDUSTRIES, INDUSTRY_CODES, parseIndustry, industryLabel, isIndustryCode,
} from '../lib/leads/industry.ts'

/**
 * WHAT INDUSTRY A LEAD IS IN.
 *
 * ── WHY IT IS A LIST AND NOT A TEXT BOX ────────────────────────────────────
 *
 * The point of recording it is to be able to count it: a purchased list of
 * five hundred names is worth far more when the mix is known, because PMP
 * sells into construction and the public sector while the HR qualifications
 * sell into banking and telecoms.
 *
 * Typed free-hand, "Oil & Gas" arrives as "oil and gas", "O&G", "Oil/Gas" and
 * "petroleum" — five industries on a chart where there is one, and the chart
 * is the whole reason the field exists. So every value is parsed onto a fixed
 * list before it is stored, and these are the rules for doing that.
 */

describe('the list itself', () => {
  test('every code is unique, lowercase and snake_case', () => {
    // They are written into a text column and read back by string match; a
    // duplicate or a stray capital is a second industry nobody can find.
    assert.equal(new Set(INDUSTRY_CODES).size, INDUSTRIES.length)
    for (const code of INDUSTRY_CODES) {
      assert.match(code, /^[a-z][a-z0-9_]*$/, `"${code}" is not a usable code`)
    }
  })

  test('every entry has a label and at least one alias', () => {
    for (const i of INDUSTRIES) {
      assert.ok(i.label.trim().length > 1, `${i.code} has no label`)
      assert.ok(i.aliases.length > 0, `${i.code} cannot be matched from a spreadsheet`)
    }
  })

  test('no alias belongs to two industries', () => {
    /*
     * An alias in two lists makes the result depend on the order of the
     * array, which is exactly the kind of bug that shows up as "the figures
     * changed and nobody touched anything".
     */
    const seen = new Map<string, string>()
    for (const i of INDUSTRIES) {
      for (const alias of i.aliases) {
        const already = seen.get(alias)
        assert.equal(already, undefined, `"${alias}" is claimed by both ${already} and ${i.code}`)
        seen.set(alias, i.code)
      }
    }
  })

  test('there is a way to say "none of these"', () => {
    // A list that cannot say it gets filled in with the nearest wrong answer.
    assert.ok(INDUSTRY_CODES.includes('other'))
  })
})

describe('reading what a spreadsheet says', () => {
  test('the code itself, and the label as printed', () => {
    assert.equal(parseIndustry('oil_gas'), 'oil_gas')
    assert.equal(parseIndustry('Oil & Gas'), 'oil_gas')
    assert.equal(parseIndustry('  OIL AND GAS  '), 'oil_gas')
  })

  test('the spellings a real list actually arrives in', () => {
    const cases: Array<[string, string]> = [
      ['O&G', 'oil_gas'],
      ['Petroleum Services', 'oil_gas'],
      ['GCB Bank', 'banking_finance'],
      ['microfinance', 'banking_finance'],
      ['Ghana Revenue Authority', 'government'],
      ['Ministry of Trade', 'government'],
      ['non-profit', 'ngo'],
      ['NGO / Development', 'ngo'],
      ['ICT Services', 'it_software'],
      ['construction & civil works', 'construction'],
      ['Law Chambers', 'legal'],
      ['Nursing', 'health'],
      ['Cocoa Board', 'agriculture'],
      ['NSS', 'student'],
      ['real estate', 'real_estate'],
      ['estate developer', 'real_estate'],
    ]
    for (const [raw, expected] of cases) {
      assert.equal(parseIndustry(raw), expected, `"${raw}" was read as ${parseIndustry(raw)}`)
    }
  })

  test('a two-letter alias does not match inside a longer word', () => {
    /*
     * The one that would quietly ruin the figures. 'it' is an alias of
     * IT & Software, and a substring match reads "Hospitality", "Unit Trust"
     * and "Capital" as IT — which is not a rare edge case, it is most of a
     * list. Aliases match whole words only.
     */
    assert.equal(parseIndustry('Hospitality'), 'hospitality_tourism')
    assert.equal(parseIndustry('Unit Trust'), null)
    assert.equal(parseIndustry('Capital Holdings'), null)
    assert.equal(parseIndustry('IT'), 'it_software')
    assert.equal(parseIndustry('IT Support'), 'it_software')
  })

  test('a longer alias wins over a shorter one inside it', () => {
    // "real estate" must not be decided by "estate", nor "non-profit" by a
    // word inside it.
    assert.equal(parseIndustry('Real Estate Developers Ltd'), 'real_estate')
    assert.equal(parseIndustry('non-profit organisation'), 'ngo')
  })

  test('nothing recognisable is null, never a guess', () => {
    /*
     * Null means nobody has said, which the caller fills in from the batch's
     * own answer or leaves alone. Returning 'other' would be recording an
     * answer nobody gave — and 'other' is a real answer somebody can choose.
     */
    for (const nothing of ['', '   ', null, undefined, 'Blacksmithing', 'ZZZ', '12345']) {
      assert.equal(parseIndustry(nothing as string), null, `"${nothing}" was guessed at`)
    }
  })

  test('every alias in the list resolves to its own industry', () => {
    // The list is data, and data goes stale. This is the check that an entry
    // added later is actually reachable.
    for (const i of INDUSTRIES) {
      for (const alias of i.aliases) {
        assert.equal(parseIndustry(alias), i.code, `alias "${alias}" does not reach ${i.code}`)
      }
    }
  })

  test('and every label resolves to its own code', () => {
    for (const i of INDUSTRIES) {
      assert.equal(parseIndustry(i.label), i.code, `label "${i.label}" does not reach ${i.code}`)
    }
  })
})

describe('showing it back', () => {
  test('a code becomes its label', () => {
    assert.equal(industryLabel('oil_gas'), 'Oil & Gas')
    assert.equal(industryLabel('banking_finance'), 'Banking & Finance')
  })

  test('nothing recorded shows as a dash, not as blank or "null"', () => {
    assert.equal(industryLabel(null), '—')
    assert.equal(industryLabel(undefined), '—')
    assert.equal(industryLabel(''), '—')
  })

  test('an unknown code shows itself rather than vanishing', () => {
    // If a code is ever retired from the list, the rows holding it must still
    // show something — a blank column reads as "no industry", which is a
    // different fact.
    assert.equal(industryLabel('zzz_retired'), 'zzz_retired')
  })

  test('only a real code passes validation', () => {
    assert.equal(isIndustryCode('oil_gas'), true)
    for (const bad of ['Oil & Gas', 'oil gas', '', null, 42, {}, 'DROP TABLE leads']) {
      assert.equal(isIndustryCode(bad), false, `${JSON.stringify(bad)} was accepted as a code`)
    }
  })
})

/* ─────────────────────────────────────────────────────────────────────────── */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the upload asks, and the answer is used', () => {
  const importer = codeOf('lib/leads/import.ts')
  const route = codeOf('app/api/leads/import/route.ts')
  const page = codeOf('app/(portal)/admin/leads/import/page.tsx')

  test('a row that names its own industry wins over the batch', () => {
    /*
     * A file that names it per row is being more specific than the person
     * uploading it, and a mixed list is exactly when that matters.
     */
    assert.match(importer, /const industry = parseIndustry\(row\.industry\) \|\| batchIndustry/)
  })

  test('the batch answer is validated, not trusted', () => {
    // It reaches a text column. A code nobody recognises would be stored,
    // counted as its own industry on every report, and impossible to find.
    assert.match(importer, /isIndustryCode\(opts\.defaultIndustry\)/)
    assert.match(route, /refine\(isIndustryCode/)
  })

  test('a row is never rejected over its industry', () => {
    /*
     * A real person with an unrecognised sector label is still a lead. The
     * validator decides who becomes a lead, and it has nothing to say about
     * industry at all.
     */
    const validation = codeOf('lib/leads/importValidation.ts')
    assert.ok(!/industry/i.test(validation),
      'the row validator now has an opinion about industry')
  })

  test('the screen asks before the import, and says how much is untagged', () => {
    assert.match(page, /What industry is this list\?/)
    assert.match(page, /defaultIndustry: industry \|\| null/)
    assert.match(page, /untaggedCount/)
  })

  test('the template and the column hint both mention it', () => {
    // A column nobody knows about is a column nobody fills in.
    assert.match(page, /notes,industry/)
    assert.match(page, /Columns: full_name, phone, email, course_interest, source, city, notes, industry/)
  })

  test('industry is the LAST column, so old files still import', () => {
    /*
     * The parser reads columns by position. Putting the new one anywhere but
     * the end would silently shift every field after it — a file written
     * against the old template would import phone numbers as emails.
     */
    const header = page.match(/const TEMPLATE_CSV = `([^\n]+)/)?.[1] ?? ''
    assert.ok(header.endsWith('industry'), `the template header is "${header}"`)
    const destructure = page.match(/const \[full_name='',[^\]]+\]/)?.[0] ?? ''
    assert.match(destructure, /industryCol=''\]$/)
  })
})

describe('a database without the column yet', () => {
  const importer = codeOf('lib/leads/import.ts')
  const create = codeOf('app/api/leads/create/route.ts')
  const probe = codeOf('lib/db/hasColumn.ts')

  test('the field is dropped, not the import', () => {
    /*
     * PostgREST refuses the WHOLE statement when an insert names a column
     * that does not exist. This project has paid for that: an insert named
     * lead_assign_pending.last_sms_at before the column existed and every
     * assignment notification stopped, silently.
     *
     * So shipping this before migration 0028 runs costs the industry field,
     * never the leads.
     */
    assert.match(importer, /await columnExists\('leads', 'industry'\)/)
    assert.match(importer, /\.\.\.\(industryColumn && industry \? \{ industry \} : \{\}\)/)
    assert.match(create, /await columnExists\('leads', 'industry'\)/)
  })

  test('it is asked once per import, not once per row', () => {
    // 200 rows is 200 probes otherwise.
    const inner = importer.slice(importer.indexOf('for (const'))
    assert.ok(!/columnExists/.test(inner), 'the probe is inside the row loop')
  })

  test('and the operator is told the field was not recorded', () => {
    assert.match(importer, /industryRecorded: industryColumn/)
    const page = codeOf('app/(portal)/admin/leads/import/page.tsx')
    assert.match(page, /industryRecorded === false/)
    assert.match(page, /no industry column yet/)
  })

  test('a failed probe is not read as a missing column', () => {
    /*
     * An outage or a key problem would otherwise be read as "the schema is
     * old", and the field would be dropped from every write for as long as
     * the fault lasted — silently, which is the failure this file exists to
     * avoid. It must not be cached either.
     */
    assert.match(probe, /does not exist\|42703\|could not find/)
    assert.match(probe, /could not establish whether/)

    /*
     * Checked by position rather than by a window of characters: comments are
     * stripped to blank lines before this runs, so a fixed-size slice from
     * the branch reaches past the statement it was aiming at.
     */
    const lines = probe.split('\n')
    const branch = lines.findIndex(l => /\} else if/.test(l))
    assert.ok(branch > -1, 'the inconclusive case is no longer distinguished')

    /*
     * Scoped to the branch itself, by its own indentation. Searching the rest
     * of the file for "return false" finds the one in the catch block, which
     * is a different question — and the version of this test that did so
     * passed against a branch with no bail-out at all.
     */
    const closes = lines.findIndex((l, i) => i > branch && /^\s{4}\}\s*$/.test(l))
    assert.ok(closes > branch, 'the branch does not close')
    const body = lines.slice(branch, closes).join('\n')
    assert.match(body, /return false/, 'an inconclusive probe falls through to the cache')
    assert.ok(!/cache\.set/.test(body), 'an inconclusive probe is cached as a missing column')
  })

  test('a positive answer is kept, a negative one is re-checked', () => {
    // Somebody is about to run the migration; an instance that cached "no"
    // for ever would keep dropping the field long after it existed.
    assert.match(probe, /if \(cached\?\.present\) return true/)
    /*
     * The USE of the window, not its declaration. A test for the constant
     * alone passes against `if (cached) return false`, which is the bug.
     */
    assert.match(probe, /if \(cached && Date\.now\(\) - cached\.checkedAt < RECHECK_MISSING_AFTER_MS\) return false/)
  })
})

describe('a lead entered by hand is counted the same way', () => {
  test('the create route takes an industry and validates it', () => {
    const create = codeOf('app/api/leads/create/route.ts')
    assert.match(create, /industry: z\.string\(\)[\s\S]{0,120}refine\(isIndustryCode/)
  })

  test('both manual forms offer the same list', () => {
    /*
     * Otherwise the industry figures describe the imports and nothing else,
     * and a field that is blank for every lead staff type in is a field
     * nobody trusts.
     */
    for (const path of [
      'app/(portal)/admin/leads/new/page.tsx',
      'app/(portal)/marketer/leads/new/page.tsx',
    ]) {
      const form = codeOf(path)
      assert.match(form, /INDUSTRIES\.map/, `${path} does not offer the list`)
      assert.match(form, /industry: form\.industry \|\| null/, `${path} does not send it`)
    }
  })
})

describe('it is visible once captured', () => {
  const leads = codeOf('app/(portal)/admin/leads/page.tsx')

  test('on the lead, as a label rather than a code', () => {
    /*
     * On the line that renders it. The label is also used by the search and
     * the exports, so a file-wide match passes while the lead card itself
     * shows "banking_finance" — which is what the version of this test that
     * searched the whole file allowed.
     */
    const rendered = leads.split('\n').filter(l => /\{l\.industry/.test(l))
    assert.ok(rendered.length > 0, 'the industry is not shown on the lead at all')
    for (const line of rendered) {
      assert.match(line, /industryLabel\(l\.industry\)/,
        `a raw code is being rendered: ${line.trim()}`)
    }
  })

  test('searchable by the words a person would type', () => {
    // Nobody types "banking_finance" into a search box.
    const search = leads.slice(leads.indexOf('const matchSearch'))
    assert.match(search.slice(0, 300), /industryLabel\(l\.industry\)/)
  })

  test('and in both exports, which is where the mix is worked with', () => {
    assert.match(leads, /Industry: industryLabel\(l\.industry\)/)
    assert.match(leads, /Course,Industry,Assigned To,Date/)
  })
})
