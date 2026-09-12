import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { navFor, tabsFor, allDestinations } from '../lib/nav/model.ts'
import { canReachPage } from '../lib/access/pageAccess.ts'
import { resolvePortals, ROLE_DEFAULTS, ROLE_HOME } from '../lib/access/portals.ts'
import { readFileSync } from 'node:fs'

/**
 * Navigation must never offer a link that access control refuses.
 *
 * ── WHAT THIS CAUGHT ───────────────────────────────────────────────────────
 *
 * Navigation was defined in three places: ALL_PORTALS and NAV_BY_ROLE inside
 * PortalLayout.tsx, tabsFor() inside MobileTabBar.tsx, and PORTAL_PATHS in
 * lib/access/portals.ts. The first two decided what to show; only the third
 * decided what could be opened, and they had drifted.
 *
 * Being bounced back to your home page by a link the application itself just
 * offered is worse than not seeing the link: you cannot tell whether you lack
 * permission, whether the page is broken, or whether you mis-tapped.
 *
 * The fix is structural rather than a list of corrections — navFor filters the
 * catalogue through canReachPage, the same predicate proxy.ts enforces. These
 * tests hold that property for every role the system defines.
 */

const ROLES = Object.keys(ROLE_DEFAULTS)
const portalsFor = (role: string) => resolvePortals(role, null)

describe('every link shown is a link that opens', () => {
  for (const role of ROLES) {
    test(`${role}: no section item is refused by the proxy`, () => {
      const portals = portalsFor(role)
      for (const section of navFor(role, portals)) {
        for (const item of section.items) {
          assert.ok(
            canReachPage(item.href, role, portals),
            `${role} is shown "${item.label}" -> ${item.href}, which the proxy refuses`
          )
          for (const child of item.children || []) {
            assert.ok(
              canReachPage(child.href, role, portals),
              `${role} is shown "${item.label} / ${child.label}" -> ${child.href}, which the proxy refuses`
            )
          }
        }
      }
    })

    test(`${role}: every bottom tab opens`, () => {
      const portals = portalsFor(role)
      for (const tab of tabsFor(role, portals)) {
        assert.ok(
          canReachPage(tab.href, role, portals),
          `${role}'s "${tab.label}" tab points at ${tab.href}, which the proxy refuses`
        )
      }
    })
  }
})

describe('a super admin is not accidentally restricted', () => {
  test('sees every section in the catalogue', () => {
    const sections = navFor('super_admin', portalsFor('super_admin'))

    /*
     * Every section the catalogue uses must survive the filter for a super
     * admin, who passes every check. Fewer means the filter is wrong rather
     * than that access is.
     *
     * Counted from the source rather than written as a number: this asserted
     * 8, and adding the `ops` section — which had been dropping the
     * receptionist's front desk from every menu — made it 9. A hard-coded
     * total turns a correct fix into a failing test and invites somebody to
     * edit the number without asking why it moved.
     */
    const defined = new Set(
      [...readFileSync('lib/nav/model.ts', 'utf8').matchAll(/section: '(\w+)'/g)].map(m => m[1]),
    )
    assert.equal(sections.length, defined.size,
      `a super admin sees ${sections.length} of ${defined.size} sections`)
    assert.ok(sections.some(s => s.id === 'system'))
    assert.ok(sections.some(s => s.id === 'finance'))
  })
})

describe('nobody is left without navigation', () => {
  for (const role of ROLES) {
    test(`${role} gets a home tab that matches their role home`, () => {
      const portals = portalsFor(role)
      const tabs = tabsFor(role, portals)
      assert.ok(tabs.length >= 1, `${role} has no tabs at all`)
      assert.equal(tabs[0].key, 'home')
      assert.equal(tabs[0].href, ROLE_HOME[role] || '/admin')
    })

    test(`${role} has at least one destination`, () => {
      const dests = allDestinations(role, portalsFor(role))
      assert.ok(dests.length > 0, `${role} would see an empty menu`)
    })
  }
})

describe('the bottom bar stays usable on a small phone', () => {
  test('never more than four tabs, so More always fits as a fifth', () => {
    for (const role of ROLES) {
      const tabs = tabsFor(role, portalsFor(role))
      assert.ok(tabs.length <= 4,
        `${role} has ${tabs.length} tabs; the bar renders these plus More`)
    }
  })

  test('labels fit the ~60px a fifth of a 320px screen allows', () => {
    // Roughly eleven characters at the 10.5px label size. Longer labels
    // truncate to something unreadable, which is worse than a shorter word.
    for (const role of ROLES) {
      for (const tab of tabsFor(role, portalsFor(role))) {
        assert.ok(tab.label.length <= 11,
          `"${tab.label}" is too long for the bottom bar`)
      }
    }
  })

  test('no two tabs go to the same place', () => {
    for (const role of ROLES) {
      const hrefs = tabsFor(role, portalsFor(role)).map(t => t.href)
      assert.equal(new Set(hrefs).size, hrefs.length,
        `${role} has duplicate tabs: ${hrefs}`)
    }
  })
})

describe('the drawer lists each destination once', () => {
  test('SMS delivery appears under two groups but only once in the flat list', () => {
    const dests = allDestinations('super_admin', portalsFor('super_admin'))
    const hits = dests.filter(d => d.href === '/admin/sms-delivery')
    assert.equal(hits.length, 1)
  })

  test('no duplicate hrefs for any role', () => {
    for (const role of ROLES) {
      const hrefs = allDestinations(role, portalsFor(role)).map(d => d.href)
      assert.equal(new Set(hrefs).size, hrefs.length, `${role} sees a duplicated destination`)
    }
  })
})

describe('a group never becomes a heading that leads nowhere', () => {
  test('every group has at least one reachable child', () => {
    for (const role of ROLES) {
      for (const section of navFor(role, portalsFor(role))) {
        for (const item of section.items) {
          if (item.children) {
            assert.ok(item.children.length > 0,
              `${role}: "${item.label}" is an empty group`)
            // The group's own href must be one of its surviving children.
            assert.ok(item.children.some(c => c.href === item.href),
              `${role}: "${item.label}" points at ${item.href}, which is not one of its children`)
          }
        }
      }
    }
  })
})
