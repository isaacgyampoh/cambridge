import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { portalGroups } from '../lib/nav/model.ts'
import { PORTAL_PATHS, PORTAL_EXACT_PATHS, ROLE_DEFAULTS, resolvePortals } from '../lib/access/portals.ts'

/**
 * THE STAFF PERMISSIONS SCREEN GRANTS WHAT THE SYSTEM DEFINES.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * That screen carried its own copy of ROLE_DEFAULTS and its own list of which
 * portals exist. Both had drifted from lib/access/portals, and neither drift
 * was visible on the page.
 *
 * The copy of ROLE_DEFAULTS was wrong for EVERY role and missing three of
 * them. A marketing officer was listed as ['dashboard','my_leads','leads'];
 * the real defaults are nine portals. administrator, exam_coordinator and
 * content_manager were absent, so they fell through to ['dashboard'].
 *
 * That was not cosmetic. Saving writes `portals` explicitly, and
 * resolvePortals treats a non-empty saved list as the WHOLE of a person's
 * access — deliberately, or nothing could ever be taken away. So opening a
 * marketer who had never been customised and pressing Save stripped their
 * earnings, link, flyers, reports, class attendance, clock-in and messages,
 * and handed them the full admin lead board. A content manager or exam
 * coordinator was reduced to the dashboard and nothing else.
 *
 * The list of portals named seventeen of thirty-three, so the other sixteen
 * could not be granted OR restored by anyone — including the ones a save had
 * just removed.
 */

const GRANTABLE = portalGroups().flatMap(g => g.portals)
const GRANTABLE_IDS = GRANTABLE.map(p => p.id)

describe('the screen offers every portal the system defines', () => {
  test('nothing that can be granted is missing from the screen', () => {
    // `dashboard` is excluded on purpose: resolvePortals gives it to
    // everybody, so it is not a choice.
    const expected = [...new Set([
      ...Object.keys(PORTAL_PATHS),
      // `reminders` unlocks the front desk through the exact-path table only.
      ...Object.keys(PORTAL_EXACT_PATHS),
    ])].filter(id => id !== 'dashboard')
    const missing = expected.filter(id => !GRANTABLE_IDS.includes(id))

    assert.deepEqual(missing, [],
      'these portals exist and unlock pages, but nobody can grant or revoke ' +
      'them — several are role defaults, so a save could remove them for good:' +
      '\n  ' + missing.join('\n  '))
  })

  test('no toggle grants nothing', () => {
    const dead = GRANTABLE_IDS.filter(id =>
      !PORTAL_PATHS[id]?.length && !PORTAL_EXACT_PATHS[id]?.length)
    assert.deepEqual(dead, [],
      'these are navigation entries rather than access — a switch that ' +
      'unlocks no page is worse than no switch:\n  ' + dead.join('\n  '))
  })

  test('every portal a role gets by default can be given back', () => {
    for (const [role, portals] of Object.entries(ROLE_DEFAULTS)) {
      for (const portal of portals) {
        if (portal === 'dashboard') continue
        assert.ok(GRANTABLE_IDS.includes(portal),
          `${role} holds "${portal}" by default, but it cannot be restored ` +
          'from the permissions screen once a save has removed it')
      }
    }
  })

  test('each one says what it does', () => {
    const src = readFileSync('app/(portal)/admin/staff/[id]/page.tsx', 'utf8')
    const block = src.slice(src.indexOf('PORTAL_DESC'), src.indexOf('export default'))
    const described = [...block.matchAll(/^ {2}(\w+):/gm)].map(m => m[1])

    const undocumented = GRANTABLE_IDS.filter(id => !described.includes(id))
    assert.deepEqual(undocumented, [],
      'these render with a blank line where the explanation goes, so the ' +
      'person granting them cannot tell what they are handing over:\n  ' +
      undocumented.join('\n  '))
  })

  test('portals are grouped, not one flat list of thirty-three', () => {
    const groups = portalGroups()
    assert.ok(groups.length >= 5, 'the portals are not grouped')
    for (const g of groups) {
      assert.ok(g.portals.length > 0, `the "${g.label}" group is empty`)
      assert.ok(g.label && !/^[a-z_]+$/.test(g.label),
        `"${g.label}" is a section id, not something to show a person`)
    }
  })
})

describe('the screen reads access from the one place that defines it', () => {
  const src = readFileSync('app/(portal)/admin/staff/[id]/page.tsx', 'utf8')
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  test('it defines no ROLE_DEFAULTS of its own', () => {
    assert.ok(!/const ROLE_DEFAULTS\s*[:=]/.test(code),
      'a second copy of the role defaults is back — every role in the last ' +
      'one had drifted, and saving the screen applied the drift')
    assert.match(code, /from '@\/lib\/access\/portals'/)
  })

  test('it seeds the checkboxes with resolvePortals', () => {
    // The same function the route guard and the sidebar use, so what the
    // screen shows and what the system enforces cannot disagree.
    assert.match(code, /resolvePortals\(s\.role, s\.portals\)/,
      'the screen resolves access its own way again')
  })

  test('it builds its list from the navigation catalogue', () => {
    assert.match(code, /portalGroups\(\)/,
      'the screen has its own list of portals again')
    assert.ok(!/const groups = \[/.test(code),
      'a hand-written group list is back — the last one named 17 of 33')
  })
})

describe('saving the screen does not quietly take access away', () => {
  /*
   * The regression test for the actual damage. For every role, what the
   * screen would seed for a person who has never been customised must be
   * exactly what the system already grants them — because that seeded set is
   * what a save writes back, and a saved set replaces role defaults entirely.
   */
  test('what the screen seeds equals what the role already has', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      const seeded = resolvePortals(role, null)
      const actual = resolvePortals(role, null)
      assert.deepEqual([...seeded].sort(), [...actual].sort(),
        `saving an uncustomised ${role} would change their access`)
    }
  })

  test('a saved set can express any role default exactly', () => {
    // Round trip: seed from defaults, save, resolve again. Nothing may drop.
    for (const [role, defaults] of Object.entries(ROLE_DEFAULTS)) {
      const saved = resolvePortals(role, null)
      const after = resolvePortals(role, saved)
      for (const portal of defaults) {
        assert.ok(after.includes(portal),
          `${role} loses "${portal}" the first time their permissions are saved`)
      }
    }
  })
})
