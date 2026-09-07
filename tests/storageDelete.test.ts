import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseStorageUrl } from '../lib/storage/parseUrl.ts'

/**
 * DELETING A DOCUMENT DELETES THE FILE.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * There was an upload endpoint and nothing else, so nothing in the product
 * had ever deleted a file. The document library's delete removed the database
 * row and left the file exactly where it was — while the confirmation said:
 *
 *   "Anyone holding a link to it will no longer be able to open it."
 *
 * That was not true. The row went; the file stayed at its public storage URL
 * and anyone who already had that URL kept working access. For an admission
 * letter or a signed form, that is a disclosure rather than untidiness — and
 * the operator had been told the opposite.
 *
 * `fileUrl` was already being passed into deleteDoc for exactly this purpose,
 * and ignored.
 */

describe('a storage URL is parsed safely', () => {
  const BASE = 'https://gejtxkbatldxbbqynpfg.supabase.co/storage/v1/object'

  test('the three URL shapes Supabase serves all parse', () => {
    for (const prefix of ['public/', 'sign/', '']) {
      const got = parseStorageUrl(`${BASE}/${prefix}uploads/documents/letter.pdf`)
      assert.deepEqual(got, { bucket: 'uploads', path: 'documents/letter.pdf' },
        `the ${prefix || 'authenticated'} form did not parse`)
    }
  })

  test('percent-encoding is decoded, so a spaced filename still deletes', () => {
    const got = parseStorageUrl(`${BASE}/public/uploads/documents/Admission%20Letter.pdf`)
    assert.deepEqual(got, { bucket: 'uploads', path: 'documents/Admission Letter.pdf' })
  })

  test('only the buckets this product writes to are accepted', () => {
    assert.ok(parseStorageUrl(`${BASE}/public/uploads/a.pdf`))
    assert.ok(parseStorageUrl(`${BASE}/public/materials/a.pdf`))

    // Supabase's own buckets, and anything invented by a caller.
    for (const bucket of ['avatars', 'storage', 'public', '..']) {
      assert.equal(parseStorageUrl(`${BASE}/public/${bucket}/a.pdf`), null,
        `bucket "${bucket}" was accepted`)
    }
  })

  test('traversal and empty segments are refused', () => {
    for (const path of ['../secrets.pdf', 'a/../../b.pdf', '/etc/passwd', 'a//b.pdf', '']) {
      assert.equal(parseStorageUrl(`${BASE}/public/uploads/${path}`), null,
        `path "${path}" was accepted`)
    }
  })

  test('anything that is not a storage URL is refused', () => {
    for (const url of [
      'https://example.com/uploads/a.pdf',
      'not a url',
      '',
      'https://gejtxkbatldxbbqynpfg.supabase.co/rest/v1/documents',
    ]) {
      assert.equal(parseStorageUrl(url), null, `"${url}" was accepted`)
    }
  })
})

describe('the delete path is guarded and actually used', () => {
  test('the route requires a session and a role', () => {
    const route = readFileSync('app/api/upload/delete/route.ts', 'utf8')
    assert.match(route, /withGuard\(\s*\{\s*roles:/,
      'the delete route is not role-guarded')
    assert.ok(!/export const GET/.test(route),
      'the delete route answers GET, which a link or a crawler could follow')
  })

  test('deleting a document deletes its file too', () => {
    const page = readFileSync('app/(portal)/admin/documents/page.tsx', 'utf8')

    assert.match(page, /\/api\/upload\/delete/,
      'deleting a document no longer removes the stored file')

    // And the failure is surfaced: a row gone with a file left behind is
    // exactly the orphan nobody would otherwise know about.
    const fn = page.slice(page.indexOf('async function deleteDoc'))
    assert.match(fn.slice(0, 1600), /could not be deleted/,
      'a failed file delete is reported as a plain success')
  })
})
