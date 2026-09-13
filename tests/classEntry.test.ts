import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A SINGLE-USE LINK IS ONLY SPENT ON A JOURNEY THAT ARRIVES.
 *
 * /class/[token] is how a student actually gets into their class: the link
 * arrives by WhatsApp, it works once, and it drops them into Zoom. Everything
 * about it is invisible when it goes wrong — there is no screen, no error, no
 * support inbox. There is a student looking at the portal wondering why the
 * link "did nothing", and nothing anywhere recording that they tried.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const src = codeOf('app/class/[token]/route.ts')

describe('the token is not spent when the class cannot be reached', () => {
  test('the Zoom link is resolved before the token is marked used', () => {
    /*
     * It was marked used immediately after the validity check. A class whose
     * Zoom link nobody had set yet therefore burned the token on the way to
     * the portal — and the second click landed on the portal too, because the
     * token was now `used`. The student had no way back in.
     */
    const resolved = src.indexOf("target = b?.zoom_link")
    const spent = src.indexOf("update({ used: true })")
    assert.ok(resolved > 0 && spent > 0, 'both steps must still be present')
    assert.ok(resolved < spent,
      'The link must be resolved first, or a class with no link spends every student’s token.')
  })

  test('no link means the student is sent home with the token intact', () => {
    const noTarget = src.indexOf('if (!target) return NextResponse.redirect(home')
    const spent = src.indexOf("update({ used: true })")
    assert.ok(noTarget > 0 && noTarget < spent,
      'The bail-out must come before the token is spent.')
  })
})

describe('and it really is single use', () => {
  test('spending it is a conditional claim, not a blind update', () => {
    /*
     * Read-then-update left a window: two people holding the same forwarded
     * URL could both pass the `t.used` check before either wrote, and both
     * got in — the one thing the token exists to prevent.
     */
    assert.match(src, /update\(\{ used: true \}\)\.eq\('token', token\)\.eq\('used', false\)/,
      'The update must only match a token that is still unspent.')
    assert.match(src, /\.select\('id'\)/,
      'It must ask for the row back, or there is no way to know which caller won.')
  })

  test('losing the race sends you home rather than into the class', () => {
    assert.match(src, /if \(!claimed\?\.length\)[\s\S]{0,200}redirect\(home/)
  })

  test('an unresolvable claim refuses rather than admits', () => {
    // Not knowing whether a token was spent is not a reason to let someone in.
    assert.match(src, /if \(claimErr\)[\s\S]{0,300}redirect\(home/)
  })
})

describe('attendance is not counted twice', () => {
  test('a failed sign-in check skips the write instead of duplicating it', () => {
    /*
     * Read as "not signed in yet", a failed read inserts a second attendance
     * row for the same student on the same day — and attendance is what the
     * completion gate and the certificate are decided on.
     */
    assert.match(src, /const \{ row: seen, failed: seenFailed \} = await lookup\(/)
    assert.match(src, /if \(seenFailed\)[\s\S]{0,200}else if \(!seen\)/,
      'The insert must be skipped on a failed read, not attempted.')
  })

  test('the student still gets into the class either way', () => {
    // Attendance is bookkeeping. It must never stand between a paid student
    // and the lesson they are trying to join.
    const attendance = src.indexOf('class_signins')
    const redirect = src.lastIndexOf('NextResponse.redirect(target')
    assert.ok(attendance > 0 && attendance < redirect,
      'The redirect to Zoom must come after, and unconditionally.')
    assert.match(src, /\} catch \{\}/,
      'Attendance recording stays best-effort and cannot throw the student out.')
  })
})

describe('an unreadable token is refused, and recorded', () => {
  test('entry fails closed', () => {
    assert.match(src, /if \(failed \|\| !t \|\| t\.used/,
      'A token that could not be read is not an admitted student.')
  })

  test('but the failure is logged, because the student sees nothing', () => {
    assert.match(src, /console\.error\('\[class\/token\] token read failed:'/)
  })
})
