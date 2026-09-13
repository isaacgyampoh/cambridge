import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A PUBLIC FORM TELLS A STRANGER NOTHING ABOUT THE INSIDE.
 *
 * /refer and the flyer landing page are posted by people who are not signed
 * in and never will be. Both used to answer with:
 *
 *     { success: true, leadId, assignedTo, duplicate }
 *
 * `leadId` is the row's database id. `assignedTo` is a member of staff's
 * profile id. Neither caller has ever read them — both check `success` and
 * nothing else — so they were internal identifiers handed to anybody who
 * posted the form, for no purpose at all.
 *
 * `duplicate` is worse in a quieter way. It answers "is this phone number
 * already in your system?" for whoever asks, about somebody who is not the
 * person asking.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The unauthenticated intake forms. */
const PUBLIC_INTAKE = [
  'app/api/referrals/submit/route.ts',
  'app/api/flyers/submit/route.ts',
]

describe('no database id reaches an unauthenticated caller', () => {
  for (const file of PUBLIC_INTAKE) {
    test(`${file.split('/').slice(-2)[0]} returns only whether it worked`, () => {
      const src = codeOf(file)
      const success = src.match(/return NextResponse\.json\(\{ success: true[^}]*\}\)/)
      assert.ok(success, 'the success response must still be there')
      for (const leak of ['leadId', 'assignedTo', 'duplicate']) {
        assert.ok(!success[0].includes(leak),
          `${leak} is returned to a public caller — it is internal and no client reads it.`)
      }
    })
  }

  test('and the clients genuinely do not need them', () => {
    /*
     * The reason this is safe to remove, checked rather than assumed: if a
     * page ever starts reading d.leadId, this test says so before somebody
     * "fixes" it by putting the id back.
     */
    for (const page of ['app/refer/page.tsx', 'app/f/[id]/FlyerLanding.tsx']) {
      const src = codeOf(page)
      for (const leak of ['d.leadId', 'd.assignedTo', 'd.duplicate']) {
        assert.ok(!src.includes(leak), `${page} reads ${leak}; removing it from the response broke this page.`)
      }
    }
  })

  test('a lead that could not be created is reported as a failure, not a success', () => {
    // intakeLead returns leadId: null when it fails closed. Answering
    // `success: true` to that tells somebody their details were taken when
    // they were not, and nobody ever calls them.
    for (const file of PUBLIC_INTAKE) {
      assert.match(codeOf(file), /if \(!leadId\)[\s\S]{0,220}status: 503/,
        `${file} reports success even when no lead was created.`)
    }
  })
})

describe('a counter is never rebuilt from a failed read', () => {
  /*
   * `update({ n: (row?.n || 0) + 1 })` does not lose a count when the read
   * fails — it DESTROYS one. The optional chain turns an unreadable row into
   * 0, and a flyer on three hundred clicks is written back as having one.
   *
   * A click leaves no other record, so the number cannot be rebuilt. This is
   * a public route, so a spell of failed reads flattens every flyer being
   * shared — and what a marketer sees is their campaign reporting that it did
   * nothing.
   */
  for (const file of ['app/api/flyers/public/route.ts', 'app/api/flyers/submit/route.ts']) {
    test(`${file.split('/').slice(-2)[0]} skips the write rather than resetting the total`, () => {
      const src = codeOf(file)
      assert.ok(!/update\(\{\s*\w+:\s*\(\w+\?\.\w+\s*\|\|\s*0\)\s*\+/.test(src),
        'A counter is being written from an optional chain; a failed read resets it.')
      assert.match(src, /else if \(f\)/,
        'The increment must only happen when the row was actually read.')
    })
  }
})

describe('a referral is credited to the person whose link was used', () => {
  test('an unresolvable marketer code stops instead of falling to the lottery', () => {
    /*
     * This failed open: `m` came back null on a blip exactly as it does for
     * an unknown code, so the lead went to the weighted lottery and was
     * credited to somebody who had nothing to do with it. Nothing looks wrong
     * afterwards — the lead is assigned, the source says referral, and the
     * commission is simply on the wrong name.
     */
    const src = codeOf('app/api/referrals/submit/route.ts')
    const marketerBlock = src.slice(src.indexOf('if (marketerCode)'))
    assert.match(marketerBlock.slice(0, 400), /if \(failed\) return unavailable\(/,
      'A failed lookup must not be treated as "no such marketer".')
  })

  test('nothing has been created at that point, so stopping loses nobody', () => {
    const src = codeOf('app/api/referrals/submit/route.ts')
    const guard = src.indexOf('if (marketerCode)')
    const creates = src.indexOf('await intakeLead(')
    assert.ok(guard > 0 && guard < creates,
      'The guard must run before the lead is created, or stopping strands a real enquiry.')
  })
})
