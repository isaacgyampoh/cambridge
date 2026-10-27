import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FIELDS, guessMapping, readRow, cellToText, rowIsEmpty, unmappedHeaders, missingFields,
} from '../lib/leads/importMapping.ts'
import { parseIndustry } from '../lib/leads/industry.ts'
import { validateRow, canonicalPhone } from '../lib/leads/importValidation.ts'

/**
 * READING SOMEBODY ELSE'S SPREADSHEET.
 *
 * ── WHAT WENT WRONG BEFORE ─────────────────────────────────────────────────
 *
 * The importer read columns BY POSITION: first a name, second a phone, third
 * an email. That is correct for a file made from our own template and wrong
 * for every other file — and the files that actually arrive are Google Sheets
 * exported from Facebook lead forms, and lists bought from somebody else, in
 * whatever order their columns happen to be.
 *
 * A file whose second column held emails imported every email as a phone
 * number and every phone number as a name, and nobody found out until a
 * marketer tried to ring one of them.
 */

const header = (...names: string[]) => names

describe('working out which column is which', () => {
  test('a Google Sheet exported from a lead form', () => {
    const mapping = guessMapping(header('Name', 'Phone', 'Course of Interest', 'Industry'))
    assert.deepEqual(mapping, {
      0: 'full_name', 1: 'phone', 2: 'course_interest', 3: 'industry',
    })
  })

  test('the header spellings these files actually use', () => {
    const cases: Array<[string, string]> = [
      ['Full Name', 'full_name'], ['FULL_NAME', 'full_name'], ['Client Name', 'full_name'],
      ['Mobile', 'phone'], ['Phone Number', 'phone'], ['Contact Number', 'phone'], ['WhatsApp', 'phone'],
      ['E-mail', 'email'], ['Email Address', 'email'],
      ['Course', 'course_interest'], ['Programme of Interest', 'course_interest'],
      ['Sector', 'industry'], ['Business Sector', 'industry'], ['Industry/Sector', 'industry'],
      ['Organisation', 'company'], ['Employer', 'company'],
      ['Lead Source', 'source'], ['Town', 'city'], ['Remarks', 'notes'],
      ['Assigned To', 'assigned_to'], ['Marketer', 'assigned_to'],
    ]
    for (const [text, expected] of cases) {
      assert.equal(guessMapping([text])[0], expected, `"${text}" was read as ${guessMapping([text])[0]}`)
    }
  })

  test('a course column is never read as an industry', () => {
    /*
     * The confusion that matters. They arrive side by side — "PMP" and
     * "Agriculture" — and they are different facts about the same person.
     * Putting one in the other's field produces a lead recorded as wanting to
     * study Agriculture, filed under the industry PMP, found by neither.
     */
    const mapping = guessMapping(header('Name', 'Course of Interest', 'Industry'))
    assert.equal(mapping[1], 'course_interest')
    assert.equal(mapping[2], 'industry')
    assert.notEqual(mapping[1], 'industry')
    assert.notEqual(mapping[2], 'course_interest')
  })

  test('and neither is decided by the less specific header', () => {
    // "Course" and "Course of Interest" in one file must not race.
    const mapping = guessMapping(header('Course of Interest', 'Course'))
    assert.equal(mapping[0], 'course_interest')
    assert.equal(mapping[1], undefined, 'the second course column was also claimed')
  })

  test('an exact header beats a looser match on another column', () => {
    /*
     * This is what actually settles the hard cases, and it has to run across
     * EVERY column before any looser matching starts.
     *
     * "Contact Name" is exactly a name; "Contact Number" is exactly a phone.
     * Both contain 'contact', which on its own means a phone number — so
     * without an exact pass first, whichever column came first would take the
     * phone field and the other would be left to a guess. Every row would
     * then carry a name where its number belongs.
     */
    assert.deepEqual(guessMapping(['Contact Name', 'Contact Number']),
      { 0: 'full_name', 1: 'phone' })
    assert.deepEqual(guessMapping(['Contact Number', 'Contact Name']),
      { 0: 'phone', 1: 'full_name' })
  })

  test('a header that contains an alias is matched too', () => {
    const mapping = guessMapping(header('Lead Phone Number', 'Industry (sector)'))
    assert.equal(mapping[0], 'phone')
    assert.equal(mapping[1], 'industry')
  })

  test('one field per column, and one column per field', () => {
    /*
     * A file with "Phone" and "Mobile" means the same thing twice. The first
     * takes it; the second is left alone rather than silently overwriting it
     * with whatever that column happens to hold.
     */
    const mapping = guessMapping(header('Name', 'Phone', 'Mobile'))
    assert.equal(mapping[1], 'phone')
    assert.equal(mapping[2], undefined)
    assert.equal(Object.values(mapping).filter(v => v === 'phone').length, 1)
  })

  test('a column nobody recognises is left unmapped, not guessed', () => {
    const headers = header('Name', 'Phone', 'Date of Birth', 'Referred By A Friend')
    const mapping = guessMapping(headers)
    assert.equal(mapping[2], undefined)
    assert.deepEqual(unmappedHeaders(headers, mapping), ['Date of Birth', 'Referred By A Friend'])
  })

  test('what the file does not supply is listed', () => {
    const mapping = guessMapping(header('Name', 'Phone'))
    const missing = missingFields(mapping)
    assert.ok(missing.includes('industry'))
    assert.ok(missing.includes('course_interest'))
    assert.ok(!missing.includes('full_name'))
  })

  test('every field is reachable from at least one header', () => {
    // A field with no alias anybody writes is a field nobody can import into.
    for (const field of FIELDS) {
      for (const alias of field.aliases) {
        assert.equal(guessMapping([alias])[0], field.key,
          `"${alias}" does not reach ${field.key}`)
      }
    }
  })
})

describe('reading the cells', () => {
  test('a phone number that Excel ate the zero from still works', () => {
    /*
     * Excel reads 0240000001 as the number 240000001 and drops the zero. The
     * cell therefore arrives as a NUMBER, and String() on a large float gives
     * "240000001" here but scientific notation elsewhere — so the conversion
     * is explicit.
     *
     * Nine digits is a local Ghanaian number, which the phone rule already
     * understands, so the zero is recovered rather than the row rejected.
     */
    assert.equal(cellToText(240000001), '240000001')
    assert.equal(canonicalPhone(cellToText(240000001)), '233240000001')
    assert.equal(canonicalPhone(cellToText('0240000001')), '233240000001')
    // And the two spellings are the same person.
    assert.equal(canonicalPhone('0240000001'), canonicalPhone('240000001'))
  })

  test('a number is never turned into an exponent or a decimal tail', () => {
    assert.equal(cellToText(233240000001), '233240000001')
    /*
     * The case that separates this from a plain String(): JavaScript switches
     * to exponent notation at 1e21, and a cell holding a long reference
     * number would arrive as "1e+21" — which is not a number anybody can
     * ring, type or match.
     */
    assert.equal(cellToText(1e21), '1000000000000000000000')
    for (const n of [233240000001, 1e21, 240000001]) {
      assert.ok(!cellToText(n).includes('e'), `${n} became an exponent`)
      assert.ok(!cellToText(n).includes('.'), `${n} kept a decimal tail`)
    }
  })

  test('empty cells are empty strings, not "null" or "undefined"', () => {
    for (const nothing of [null, undefined, '', '   ']) {
      assert.equal(cellToText(nothing), '')
    }
  })

  test('a blank row is recognised so it can be skipped, not failed', () => {
    assert.equal(rowIsEmpty(['', null, undefined, '  ']), true)
    assert.equal(rowIsEmpty(['', 'Kwame']), false)
  })

  test('a row is read through the mapping, in the file\'s own order', () => {
    // Industry first, name last — a real export does this.
    const mapping = guessMapping(header('Industry', 'Course', 'Phone', 'Full Name'))
    const row = readRow(['Mining', 'PMP', '0240000001', 'Kwame Mensah'], mapping)
    assert.deepEqual(row, {
      industry: 'Mining', course_interest: 'PMP', phone: '0240000001', full_name: 'Kwame Mensah',
    })
  })
})

describe('a whole file, end to end', () => {
  /** The example from the brief, with the columns in that order. */
  const sheet = [
    ['Name', 'Phone', 'Course of Interest', 'Industry'],
    ['John Mensah', '0240000001', 'PMP', 'Agribusiness'],
    ['Ama Boateng', '0240000002', 'PMP', 'Construction/Engineering'],
    ['Kofi Asare', '0240000003', 'PMP', 'agribusiness'],
    ['Mary Owusu', '0240000004', 'Data Analytics', 'Financial Services'],
  ]

  const mapping = guessMapping(sheet[0])
  const read = sheet.slice(1).map(cells => {
    const v = readRow(cells, mapping)
    return { ...v, industryCode: parseIndustry(v.industry), check: validateRow(v) }
  })

  test('every row is usable', () => {
    for (const r of read) assert.equal(r.check.ok, true, `${r.full_name} was rejected`)
  })

  test('the industry on each row is kept, not flattened to one', () => {
    /*
     * The requirement in one line: a mixed file keeps its mix. Applying one
     * industry to every row is exactly what the operator is trying to avoid
     * by having the column in the first place.
     */
    assert.deepEqual(read.map(r => r.industryCode), [
      'agribusiness', 'construction_engineering', 'agribusiness', 'financial_services',
    ])
  })

  test('different spellings of one industry land in the same group', () => {
    // "Agribusiness" and "agribusiness" are one industry, not two.
    assert.equal(read[0].industryCode, read[2].industryCode)
  })

  test('and the course stays the course', () => {
    assert.deepEqual(read.map(r => r.course_interest), ['PMP', 'PMP', 'PMP', 'Data Analytics'])
    for (const r of read) {
      assert.notEqual(r.course_interest, r.industry, 'course and industry hold the same value')
    }
  })

  test('mixed courses inside one industry are all preserved', () => {
    const mixed = [
      ['Name', 'Course', 'Sector'],
      ['A', 'PMP', 'Agribusiness'],
      ['B', 'Data Analytics', 'Agribusiness'],
    ]
    const m = guessMapping(mixed[0])
    const rows = mixed.slice(1).map(c => readRow(c, m))
    assert.deepEqual(rows.map(r => r.course_interest), ['PMP', 'Data Analytics'])
    assert.deepEqual(rows.map(r => parseIndustry(r.industry)), ['agribusiness', 'agribusiness'])
  })

  test('a blank or unreadable industry is flagged, never invented', () => {
    /*
     * The rule the brief is explicit about: if the column is there and the
     * value cannot be read, that row is for the operator to answer — it is
     * not filed under a guess, and never under something inferred from the
     * person's name or number.
     */
    const m = guessMapping(['Name', 'Phone', 'Industry'])
    for (const value of ['', '   ', 'Blacksmithing', 'ZZZ']) {
      const v = readRow(['Kwame', '0240000001', value], m)
      assert.equal(parseIndustry(v.industry), null, `"${value}" was given an industry`)
    }
  })

  test('nothing about a person implies their industry', () => {
    // Not from the name, not from the number, not from the course.
    const m = guessMapping(['Name', 'Phone', 'Course'])
    const v = readRow(['Kwame Mining', '0240000001', 'PMP'], m)
    assert.equal(v.industry, undefined)
    assert.equal(parseIndustry(v.industry), null)
  })
})

/* ─────────────────────────────────────────────────────────────────────────── */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the screen that does the importing', () => {
  const page = codeOf('app/(portal)/admin/leads/import/page.tsx')

  test('it opens a real spreadsheet, not only pasted text', () => {
    assert.match(page, /accept="\.xlsx,\.xls,\.csv/)
    assert.match(page, /await import\('xlsx'\)/)
  })

  test('one parser for all three formats', () => {
    // A CSV read by a hand-rolled comma splitter is a second code path with
    // its own quoting bugs, which is what this replaced.
    assert.match(page, /XLSX\.read\(input, \{ type: 'string'/)
    assert.match(page, /XLSX\.read\(new Uint8Array\(input\), \{ type: 'array'/)
  })

  test('cells are read as formatted text, so a leading zero survives', () => {
    /*
     * Asserted on the sheet_to_json options, not on the file: `raw: false`
     * also appears in the string-parsing call above it, so a file-wide match
     * passes while the rows themselves are read raw.
     */
    const opts = page.slice(page.indexOf('sheet_to_json'))
    assert.match(opts.slice(0, opts.indexOf('})')), /raw: false/)
  })

  test('the columns are guessed and then shown for correction', () => {
    assert.match(page, /guessMapping\(head\)/)
    assert.match(page, /onChange=\{e => setColumn\(i, e\.target\.value\)\}/)
  })

  test('the preview uses the same validator the import uses', () => {
    /*
     * Otherwise the screen says a row will import and the server disagrees,
     * which is the worst kind of preview: one that is confidently wrong.
     */
    assert.match(page, /validateRow\(\{ full_name: v\.full_name, phone: v\.phone, email: v\.email \}\)/)
  })

  test('duplicates are shown before the import, not counted after it', () => {
    assert.match(page, /\/api\/leads\/import\/check/)
    assert.match(page, /already on file/)
  })

  test('a failed duplicate check is not shown as "no duplicates"', () => {
    // That is the answer that makes somebody import a list they would
    // otherwise have stopped to look at.
    assert.match(page, /setCheckedDuplicates\(false\)/)
    assert.match(page, /Existing leads could not be checked/)
  })

  test('the industry sent is the one the screen showed', () => {
    assert.match(page, /industry: p\.industry \|\| null/)
  })

  test('overriding the file\'s industries is a deliberate tick', () => {
    assert.match(page, /overruling what the file says/)
    assert.match(page, /checked=\{overrideRowIndustry\}/)
  })

  test('a staff list is only fetched by somebody who may assign', () => {
    // An ordinary marketer has no business holding a list of their
    // colleagues' ids.
    assert.match(page, /if \(!mayAssign\) return/)
    assert.match(page, /const mayAssign = mayNameAnotherOwner\(me\?\.role, me\?\.portals \|\| \[\]\)/)
    // And the id is only ever sent by somebody who may name an owner.
    assert.match(page, /assignedTo: mayAssign \? match\?\.id \?\? null : null/)
  })

  test('an unmatched colleague is flagged, not silently ignored', () => {
    assert.match(page, /assignee_unknown/)
    assert.match(page, /could not be\s*\n?\s*matched/)
  })

  test('the rows that cannot be used can be taken away as a file', () => {
    assert.match(page, /downloadProblemRows/)
    assert.match(page, /rows-needing-attention/)
  })
})
