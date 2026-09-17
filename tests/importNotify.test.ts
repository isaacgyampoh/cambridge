import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * AN IMPORTED LEAD WAS ASSIGNED AND NOBODY WAS TOLD.
 *
 * The importer calls distributeLead directly, so imported leads never passed
 * through onLeadAssigned: no in-app notification, no text, no email, for any
 * of them. A spreadsheet of two hundred enquiries landed silently.
 *
 * The obvious repair — the single-lead notifier in a loop — is worse than the
 * bug. Forty leads from one upload would be forty texts and forty emails: the
 * cost multiplied, a phone nobody can use, and a mailbox that buries the
 * leads it is announcing. A batch is announced once per person.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const importer = codeOf('lib/leads/import.ts')
const batch = codeOf('lib/leads/importNotify.ts')
const single = codeOf('lib/leads/assignedNotify.ts')

describe('an import announces itself', () => {
  test('the importer now notifies at all', () => {
    assert.match(importer, /notifyImportBatch\(assignedTally, reference!\)/)
  })

  test('once per person, not once per row', () => {
    assert.match(importer, /const assignedTally = new Map<string, number>\(\)/)
    assert.match(importer, /assignedTally\.set\(assignedTo, \(assignedTally\.get\(assignedTo\) \|\| 0\) \+ 1\)/)
    // The per-lead notifier must not be called from the import loop.
    assert.ok(!/notifyLeadAssigned/.test(importer),
      'forty leads from one upload must not be forty texts')
  })

  test('only after every row is committed', () => {
    const loopEnd = importer.indexOf('if (outcomes.length)')
    const notify = importer.indexOf('await notifyImportBatch')
    assert.ok(loopEnd > -1 && notify > loopEnd,
      'nothing is announced until the rows exist')
  })

  test('all three channels, each independent', () => {
    assert.match(batch, /from\('notifications'\)\.insert/)
    assert.match(batch, /queueSMS\(\{/)
    assert.match(batch, /await sendEmail\(/)
  })

  test('the message says how many arrived', () => {
    assert.match(batch, /const many = count === 1 \? '1 new lead' : `\$\{count\} new leads`/)
  })

  test('a batched upload cannot announce itself five times', () => {
    // The importer is called repeatedly with the same reference.
    assert.match(batch, /dedupeKey: `import_batch:\$\{reference\}:\$\{person\.id\}`/)
  })

  test('nobody inactive is messaged', () => {
    assert.match(batch, /if \(person\.is_active === false\) continue/)
  })

  test('a failed channel cannot fail the import', () => {
    assert.ok(!/throw /.test(batch), 'the leads are already committed')
    assert.match(batch, /out\.failures\.push/)
    assert.match(importer, /\.\.\.counts, notified \}/)
  })

  test('a failed read of who to notify is reported, not treated as nobody', () => {
    assert.match(batch, /if \(error\) \{[\s\S]{0,140}out\.failures\.push/)
  })

  test('the link is the canonical domain', () => {
    assert.match(batch, /publicUrl\('\/marketer\/leads'\)/)
    assert.ok(!/vercel\.app|localhost/.test(batch))
  })

  test('the address comes from the staff record', () => {
    assert.match(batch, /\.select\('id, full_name, phone, email, is_active'\)/)
  })

  test('values are escaped into the email', () => {
    assert.match(batch, /const esc = /)
    assert.match(batch, /esc\(firstName\)/)
  })
})

describe('the single-lead path is unchanged', () => {
  test('a lead arriving on its own is still announced immediately', () => {
    assert.match(single, /kind: 'lead_assigned'/)
    assert.match(single, /dedupeKey: `lead_assigned:\$\{leadId\}:\$\{marketerId\}`/)
  })

  test('the two notifiers use different dedupe namespaces', () => {
    // Otherwise a batch could suppress a later single-lead text.
    assert.ok(!/import_batch/.test(single))
    assert.ok(!/lead_assigned:/.test(batch))
  })
})

describe('what was left behind is gone', () => {
  test('the orphaned notification recorder was removed', () => {
    const store = codeOf('lib/leads/distributionStore.ts')
    assert.ok(!/recordNotificationOutcome/.test(store),
      'it had no callers once the dispatcher replaced it')
  })

  test('but the backlog drain was kept', () => {
    /*
     * lead_assign_pending can still hold rows from leads assigned before the
     * immediate notifier existed. Removing the only thing that drains them
     * would mean those marketers are never told at all.
     */
    assert.match(codeOf('app/api/cron/run/route.ts'), /name: 'lead_notify'/)
  })

  test('and the comments describe what actually exists', () => {
    const opp = readFileSync('lib/cron/opportunistic.ts', 'utf8')
    assert.ok(!/bump_lead_pending/.test(opp),
      'the described chain no longer exists')
  })
})
