import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NOTIFICATION_COLUMNS, notificationLink } from '../lib/notifications/shape.ts'

/**
 * THE NOTIFICATION NOBODY GOT.
 *
 * ── WHAT WAS REPORTED ──────────────────────────────────────────────────────
 *
 * "People say they didn't get notification when the leads came."
 *
 * The texts were going out — 354 of them, the most recent that same day, each
 * accepted by the provider with a message id. What had stopped was the
 * notification inside the portal: the last one of a new lead was written on
 * 14 September. Four hundred and forty-eight leads were assigned after that,
 * and the bell never lit up for any of them.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 *
 * Fifteen inserts across nine files wrote a `link` column. The table has no
 * such column, and PostgREST refuses the WHOLE statement when an insert names
 * one that does not exist. Every one of those notifications failed.
 *
 * It is the second time this fault has been paid for here. The first named
 * lead_assign_pending.last_sms_at and silenced the same feature. So this
 * sweeps every insert in the application rather than trusting the nine that
 * were found by hand.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** The brace-balanced object passed to an insert — not a regex guess at it. */
function insertedObject(src: string, from: number): string {
  const start = src.indexOf('{', from)
  if (start === -1) return ''
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return ''
}

const inserts: Array<{ file: string; columns: string[] }> = []
for (const file of [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]) {
  const src = readFileSync(file, 'utf8')
  const re = /from\('notifications'\)\s*\.insert\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const body = insertedObject(src, m.index + m[0].length - 1)
    if (!body) continue
    inserts.push({ file, columns: [...new Set([...body.matchAll(/^\s*([a-z_]+):/gm)].map(x => x[1]))] })
  }
}

describe('every notification insert names columns that exist', () => {
  test('the sweep finds the inserts it is meant to', () => {
    // A sweep that matches nothing passes for ever while proving nothing.
    assert.ok(inserts.length >= 10, `only ${inserts.length} notification inserts were found`)
  })

  test('and not one of them names a column the table does not have', () => {
    /*
     * This is the whole test. A single unknown column does not write a row
     * without that field — it writes NOTHING, and says so only to a log.
     */
    const offenders = inserts
      .map(i => ({ ...i, bad: i.columns.filter(c => !NOTIFICATION_COLUMNS.includes(c)) }))
      .filter(i => i.bad.length)
      .map(i => `${i.file}: ${i.bad.join(', ')}`)
    assert.deepEqual(offenders, [], 'these inserts fail outright and the notification never appears')
  })

  test('`link` in particular is gone from every one', () => {
    // The specific column that silenced the lead notifications.
    for (const i of inserts) {
      assert.ok(!i.columns.includes('link'), `${i.file} still writes a link column`)
    }
  })

  test('the column list matches the database', () => {
    // Confirmed against information_schema on the live project.
    assert.deepEqual([...NOTIFICATION_COLUMNS], [
      'id', 'user_id', 'type', 'title', 'body', 'data', 'is_read', 'read_at', 'created_at',
    ])
  })
})

describe('a notification still knows where it points', () => {
  test('a link written into data is found', () => {
    assert.equal(notificationLink({ data: { link: '/marketer/leads/abc' } }), '/marketer/leads/abc')
  })

  test('a top-level link still works, if the column is ever added', () => {
    // So the bell does not have to change twice.
    assert.equal(notificationLink({ link: '/admin/leads' }), '/admin/leads')
  })

  test('and a notification with nowhere to go says so', () => {
    for (const none of [null, undefined, {}, { data: null }, { data: {} }, { link: '   ' }]) {
      assert.equal(notificationLink(none as null), null)
    }
  })

  test('the bell asks the helper rather than the row', () => {
    const bell = readFileSync('components/shared/NotificationBell.tsx', 'utf8')
    assert.match(bell, /const href = notificationLink\(n\)/)
    assert.ok(!/if \(n\.link\)/.test(bell), 'the bell still reads a column that does not exist')
  })

  test('the lead assignment writes one, so the bell has somewhere to send them', () => {
    const notify = readFileSync('lib/leads/assignedNotify.ts', 'utf8')
    assert.match(notify, /data: \{ link: `\/marketer\/leads\/\$\{leadId\}` \}/)
  })
})
