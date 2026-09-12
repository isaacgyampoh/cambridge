import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE STAFF PORTAL IS THE PRODUCT.
 *
 * This application is the centre's ERP. The portal is not one feature of it,
 * it is the thing itself: eighty-one pages across sixteen sections, and the
 * daily work of every marketer, administrator, trainer and receptionist.
 *
 * `/` was briefly given to a public marketing page. Not one portal route was
 * deleted — every page stayed exactly where it was — but the front door was
 * gone, and staff opening the centre's address were shown a page about
 * courses instead of the sign-in box. From where they stood the portal had
 * disappeared, and that is the only measure that counts.
 *
 * A public page is welcome to exist. It is not welcome to stand in the
 * doorway. These tests keep that arrangement in place.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

function pagesUnder(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) pagesUnder(full, out)
    else if (entry === 'page.tsx') out.push(full)
  }
  return out
}

describe('the root belongs to the staff portal', () => {
  const root = codeOf('app/page.tsx')

  test('/ sends people to the staff sign-in', () => {
    assert.match(root, /redirect\('\/login'\)/,
      'The root route is how staff reach the ERP. It must lead to the portal.')
  })

  test('/ is not a public marketing page', () => {
    // The tells of the page that replaced it: programme loading, fees, metadata
    // for search engines. None of those belong on the door to a staff system.
    for (const marketing of ['loadProgrammes', 'nextCohort', 'ghs(', 'revalidate']) {
      assert.ok(!root.includes(marketing),
        `app/page.tsx contains "${marketing}" — the front page is being used as a public site again.`)
    }
  })

  test('the staff sign-in page still exists', () => {
    assert.ok(existsSync('app/(auth)/login/page.tsx'),
      'The portal sign-in is what / now points at; it has to be there.')
  })
})

describe('the public page coexists rather than replaces', () => {
  test('it still exists, at /welcome', () => {
    assert.ok(existsSync('app/welcome/page.tsx'),
      'The public front page was moved, not deleted — it is real work and people link to it.')
  })

  test('and /welcome is reachable without signing in', () => {
    const proxy = codeOf('proxy.ts')
    assert.match(proxy, /'\/welcome'/,
      'A public page behind the session guard is not a public page.')
  })
})

describe('the ERP is all still here', () => {
  /*
   * A count, not a list of names. The point is not which pages exist — that
   * changes as the business changes — but that a refactor cannot quietly take
   * a section of the company's operations with it.
   */
  const SECTIONS = [
    'admin', 'marketer', 'pm', 'receptionist', 'trainer', 'student',
    'finance', 'reports', 'classes', 'content', 'coordinator',
    'admission', 'links', 'messages', 'notifications', 'clock-in',
  ]

  for (const section of SECTIONS) {
    test(`the ${section} portal has its pages`, () => {
      const dir = join('app/(portal)', section)
      assert.ok(existsSync(dir), `app/(portal)/${section} is gone.`)
      assert.ok(pagesUnder(dir).length > 0, `app/(portal)/${section} has no pages left in it.`)
    })
  }

  test('the portal as a whole has not shrunk', () => {
    const total = pagesUnder('app/(portal)').length
    assert.ok(total >= 75,
      `The staff portal is down to ${total} pages. It had 81. Something removed a section — ` +
      'restore it rather than adjusting this number.')
  })
})
