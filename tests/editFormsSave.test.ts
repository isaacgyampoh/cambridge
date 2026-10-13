import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GLOBALLY_UNWRITABLE } from '../lib/data/policy.ts'

/**
 * Saving a course was impossible, and that is why the portal went on showing
 * an old fee.
 *
 * The edit form loaded a row, copied it into state, and sent it back. The row
 * carried created_at; /api/data refuses ANY write naming a globally
 * unwritable column, rejecting the whole request. The operator typed the
 * corrected fee, pressed Save, saw "The field created_at cannot be changed
 * here", and the price never changed.
 */

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (p: string) => strip(readFileSync(p, 'utf8'))

describe('an update never carries the columns the server owns', () => {
  const hook = read('hooks/useData.ts')

  test('created_at and updated_at are dropped from a PATCH', () => {
    assert.match(hook, /const SERVER_MANAGED = \['created_at', 'updated_at'\]/)
    assert.match(hook, /method === 'PATCH' \? withoutServerManaged\(data\) : data/)
  })

  test('an insert is left alone', () => {
    // A POST naming created_at is a caller stating a value on purpose, and
    // should still be refused rather than quietly ignored.
    assert.doesNotMatch(hook, /withoutServerManaged\(data\)\s*$/m)
    assert.match(hook, /: data/)
  })

  test('the security-sensitive columns are still refused, not dropped', () => {
    /*
     * Only the two timestamps may be swallowed. Nothing round-trips a pin
     * hash or a session token by accident, so a request naming one is either
     * a bug worth seeing or an attempt worth blocking — and silently
     * dropping it would hide both.
     */
    const dropped = /const SERVER_MANAGED = \[([^\]]*)\]/.exec(hook)
    assert.ok(dropped)
    const names = dropped[1].split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean)

    for (const col of GLOBALLY_UNWRITABLE) {
      if (col === 'created_at') continue
      assert.ok(!names.includes(col), `${col} must be refused by the API, not dropped by the client`)
    }
    for (const sensitive of ['pin_hash', 'session_token', 'wasender_api_key', 'reset_token_hash']) {
      assert.ok(!names.includes(sensitive), `${sensitive} must never be silently dropped`)
    }
  })

  test('it also handles the bulk form, since one helper serves both', () => {
    assert.match(hook, /Array\.isArray\(data\)/)
  })
})

describe('the courses form sends only what it edits', () => {
  const page = read('app/(portal)/admin/courses/page.tsx')

  test('the editable columns are named', () => {
    assert.match(page, /const EDITABLE = \[/)
    for (const f of ['course_fee', 'course_fee_online', 'registration_fee', 'name']) {
      assert.ok(page.includes(`'${f}'`), `${f} is not in the editable list`)
    }
  })

  test('the whole loaded row is no longer spread into the update', () => {
    // `const { id, ...data } = editing` swept every column the row happened
    // to carry into the request, including the ones that caused this.
    assert.doesNotMatch(page, /const \{ id, \.\.\.data \} = editing/)
  })

  test('no server-managed column can reach the request', () => {
    const m = /const EDITABLE = \[([\s\S]*?)\] as const/.exec(page)
    assert.ok(m, 'EDITABLE not found')
    const names = m[1].split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean)
    for (const col of ['id', 'created_at', 'updated_at', 'is_active']) {
      assert.ok(!names.includes(col), `${col} must not be in the editable list`)
    }
  })

  test('the fee fields the operator types are among them', () => {
    // The specific failure: a corrected fee that could not be saved.
    const m = /const EDITABLE = \[([\s\S]*?)\] as const/.exec(page)
    assert.ok(m)
    assert.match(m[1], /course_fee/)
    assert.match(m[1], /course_fee_online/)
  })
})

describe('the other forms with the same shape are covered by the hook', () => {
  for (const p of ['app/(portal)/admin/knowledge/page.tsx', 'app/(portal)/admin/whatsapp/page.tsx']) {
    test(`${p.split('/').slice(-2)[0]} still updates through mutate`, () => {
      // They copy a whole row into edit state too. They are fixed by the hook
      // rather than individually, so what this pins is that they go through it.
      const s = read(p)
      assert.match(s, /mutate\('PATCH'/, 'this form bypasses the helper that strips the timestamps')
    })
  }
})
