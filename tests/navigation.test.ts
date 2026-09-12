import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { navFor, portalGroups } from '../lib/nav/model.ts'
import { ROLE_DEFAULTS, resolvePortals, PORTAL_PATHS, PORTAL_EXACT_PATHS } from '../lib/access/portals.ts'

/**
 * EVERY ROLE CAN REACH THE WORK IT WAS GIVEN.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * navFor builds the menu by walking SECTION_ORDER. A section missing from that
 * list is not merely untitled — every item in it is dropped from navigation
 * entirely, silently, with nothing anywhere to say so.
 *
 * `ops` was missing, and `ops` is where the receptionist's front desk lives.
 * A receptionist signed in and the only screen their role really has was not
 * in the menu. They would have had to know the URL.
 *
 * Two catalogue entries also pointed nowhere: `notifications` had no page and
 * no portal, and `sequences` had a real page that no portal granted, so it
 * could not be opened by anybody — including a super admin.
 */

const source = readFileSync('lib/nav/model.ts', 'utf8')

/** Sections the catalogue actually uses. */
const usedSections = new Set(
  [...source.matchAll(/section: '(\w+)'/g)].map(m => m[1]),
)

describe('no section is silently dropped from the menu', () => {
  test('every section the catalogue uses is ordered', () => {
    const order = source.match(/const SECTION_ORDER = \[([^\]]+)\]/)
    assert.ok(order, 'SECTION_ORDER could not be found')
    const ordered = new Set(order[1].split(',').map(s => s.trim().replace(/'/g, '')))

    const dropped = [...usedSections].filter(s => !ordered.has(s))
    assert.deepEqual(dropped, [],
      'items in these sections are removed from every menu, with nothing to ' +
      'say so:\n  ' + dropped.join('\n  '))
  })

  test('and every ordered section has a title decided for it', () => {
    const titles = source.match(/const SECTION_TITLES: Record<string, string \| null> = \{([\s\S]*?)\n\}/)
    assert.ok(titles, 'SECTION_TITLES could not be found')
    const titled = new Set([...titles[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1]))

    const untitled = [...usedSections].filter(s => !titled.has(s))
    assert.deepEqual(untitled, [],
      'these render without a heading:\n  ' + untitled.join('\n  '))
  })
})

describe('every menu entry goes somewhere a person can open', () => {
  /*
   * A link to a page no portal grants is worse than no link: it is visible,
   * it looks like a feature, and it bounces whoever clicks it.
   */
  const grantedPaths = new Set([
    ...Object.values(PORTAL_PATHS).flat(),
    ...Object.values(PORTAL_EXACT_PATHS).flat(),
  ])

  test('no catalogue entry points at an ungranted path', () => {
    const entries = [...source.matchAll(/\{ id: '([\w]+)'[^}]*href: '([^']+)'/g)]
      .map(m => ({ id: m[1], href: m[2] }))
      .filter(e => e.id !== 'home')

    const orphans = entries.filter(e => {
      // A path is reachable if some portal grants it, or grants a prefix of it.
      for (const p of grantedPaths) {
        if (e.href === p || e.href.startsWith(p + '/')) return false
      }
      return true
    })

    assert.deepEqual(orphans.map(o => `${o.id} → ${o.href}`), [],
      'these appear in the menu and no portal grants them, so whoever clicks ' +
      'is bounced:\n  ' + orphans.map(o => `${o.id} → ${o.href}`).join('\n  '))
  })
})

describe('each role can reach its own work', () => {
  test('a receptionist sees the front desk', () => {
    // The bug this file was written for.
    const nav = navFor('receptionist', resolvePortals('receptionist', null))
    const labels = nav.flatMap(s => s.items.map(i => i.label))
    assert.ok(labels.includes('Front desk'),
      'a receptionist cannot reach the only screen their role really has')
  })

  test('a marketer sees their leads', () => {
    const nav = navFor('marketing_officer', resolvePortals('marketing_officer', null))
    const labels = nav.flatMap(s => s.items.map(i => i.label))
    assert.ok(labels.includes('My leads'))
  })

  test('nobody with a default role gets an empty menu', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      const nav = navFor(role, resolvePortals(role, null))
      const count = nav.reduce((n, s) => n + s.items.length, 0)
      assert.ok(count > 0, `${role} signs in to a menu with nothing in it`)
    }
  })

  test('a portal held by a role produces something to click', () => {
    /*
     * The inverse of the orphan check: a granted portal that appears in no
     * menu is access somebody has and cannot find.
     */
    const grantable = new Set(portalGroups().flatMap(g => g.portals.map(p => p.id)))
    const unreachable: string[] = []

    for (const [role, portals] of Object.entries(ROLE_DEFAULTS)) {
      const nav = navFor(role, resolvePortals(role, null))
      const shown = new Set(nav.flatMap(s => s.items.map(i => i.id)))
      for (const p of portals) {
        if (p === 'dashboard' || !grantable.has(p)) continue
        // A portal may legitimately show as a child of a group rather than a
        // top-level item, so children count too.
        const asChild = nav.some(s => s.items.some(i =>
          (i.children || []).length > 0 && i.id === p))
        if (!shown.has(p) && !asChild) unreachable.push(`${role}: ${p}`)
      }
    }

    assert.deepEqual(unreachable, [],
      'these roles hold a portal with nothing in the menu to reach it:\n  '
      + unreachable.join('\n  '))
  })
})
