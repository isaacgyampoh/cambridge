import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { NAV_SECTIONS, groupNavItems, sectionOf } from '../lib/access/navSections.ts'
import { PORTAL_PATHS, ROLE_DEFAULTS, resolvePortals } from '../lib/access/portals.ts'

/**
 * The sidebar grouping is presentation only. The property that matters is that
 * it can never hide something a person has access to — a navigation change must
 * not be able to remove a feature.
 */

const item = (id: string) => ({ id })

describe('grouping never loses an item', () => {
  test('every portal a role can reach still appears somewhere', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      const portals = resolvePortals(role, null)
      const grouped = groupNavItems(portals.map(item))
      const shown = grouped.flatMap(g => g.items.map(i => i.id))

      assert.deepEqual(
        [...shown].sort(), [...portals].sort(),
        `${role}: grouping changed which portals are visible`
      )
    }
  })

  test('an unknown portal falls into More rather than disappearing', () => {
    const grouped = groupNavItems([item('dashboard'), item('a_brand_new_portal')])
    const shown = grouped.flatMap(g => g.items.map(i => i.id))
    assert.ok(shown.includes('a_brand_new_portal'), 'unmapped portal was dropped')
    assert.equal(grouped.at(-1)?.section.id, 'more')
  })

  test('nothing is duplicated across sections', () => {
    const all = Object.keys(PORTAL_PATHS)
    const shown = groupNavItems(all.map(item)).flatMap(g => g.items.map(i => i.id))
    assert.equal(new Set(shown).size, shown.length, 'a portal appeared in two sections')
  })

  test('empty sections are omitted', () => {
    const grouped = groupNavItems([item('dashboard')])
    assert.equal(grouped.length, 1)
    assert.equal(grouped[0].section.id, 'overview')
  })

  test('no item at all produces no sections', () => {
    assert.deepEqual(groupNavItems([]), [])
  })
})

describe('the section table itself is coherent', () => {
  test('no portal is listed in two sections', () => {
    const seen = new Set<string>()
    for (const s of NAV_SECTIONS) {
      for (const p of s.portals) {
        assert.ok(!seen.has(p), `${p} is listed in more than one section`)
        seen.add(p)
      }
    }
  })

  test('every real portal has a home', () => {
    // A portal missing from the map still renders under More, so this is a
    // tidiness check rather than a safety one — but an unmapped portal is
    // usually an oversight, so it should be visible as a failure.
    const unmapped = Object.keys(PORTAL_PATHS).filter(p => sectionOf(p) === 'more')
    assert.deepEqual(unmapped, [], `unmapped portals: ${unmapped.join(', ')}`)
  })

  test('section order puts Overview first and Administration late', () => {
    const ids = NAV_SECTIONS.map(s => s.id)
    assert.equal(ids[0], 'overview')
    assert.ok(ids.indexOf('administration') > ids.indexOf('finance'))
  })
})

describe('grouping is stable', () => {
  test('the same input always produces the same output', () => {
    const portals = resolvePortals('super_admin', null).map(item)
    const first = JSON.stringify(groupNavItems(portals))
    for (let i = 0; i < 20; i++) {
      assert.equal(JSON.stringify(groupNavItems(portals)), first)
    }
  })

  test('order follows the section table, not the input order', () => {
    const shuffled = [item('settings'), item('dashboard'), item('finance')]
    const grouped = groupNavItems(shuffled)
    assert.deepEqual(grouped.map(g => g.section.id), ['overview', 'finance', 'administration'])
  })
})
