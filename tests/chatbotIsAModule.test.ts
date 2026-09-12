import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE CHATBOT IS A MODULE INSIDE THE ERP, NOT A SECOND SYSTEM.
 *
 * The portal is the company's ERP and holds the company's data. The chatbot
 * is one new capability inside it: WhatsApp is a channel, the ERP is the
 * source of truth, and the assistant's job is to read what is already there
 * and write back into the same tables staff already use.
 *
 * The failure mode this guards against is not a crash. It is the quiet
 * growth of a parallel system — a second courses table because one loader
 * could not find the first, a "chatbot leads" list beside Leads, its own
 * conversation store — each of which looks reasonable alone and together
 * means the portal and the assistant disagree about the business.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const CHATBOT = sourceFiles('lib/chatbot')

describe('the chatbot reads the ERP rather than keeping its own copy', () => {
  test('courses and fees come from the courses table', () => {
    const src = codeOf('lib/chatbot/programme.ts')
    assert.match(src, /from\('courses'\)/,
      'The assistant must read the same course records the admin screens write.')
    assert.match(src, /course_fee/,
      'Fees come from the course record, not from anywhere else.')
  })

  test('no fee is ever written into the code', () => {
    /*
     * The rule the whole product turns on: the ERP is responsible for truth,
     * the model only for language. A number typed into a source file is a fee
     * that no longer changes when the centre changes it.
     */
    for (const f of CHATBOT) {
      const src = codeOf(f)
      const literals = src.match(/\b(?:GHS|GH₵)\s*[\d,]{3,}/gi) || []
      assert.deepEqual(literals, [],
        `${f} contains a hard-coded fee: ${literals.join(', ')}`)
    }
  })

  test('there is no second courses store', () => {
    for (const f of CHATBOT) {
      const src = codeOf(f)
      for (const table of ['chatbot_courses', 'bot_courses', 'programmes_cache', 'chatbot_programmes']) {
        assert.ok(!src.includes(table), `${f} reads ${table} — the ERP already has courses.`)
      }
    }
  })
})

describe('a WhatsApp conversation becomes an ordinary lead', () => {
  const webhook = codeOf('app/api/webhooks/whatsapp/route.ts')

  test('through the same intake every other source uses', () => {
    assert.match(webhook, /intakeLead\(/,
      'A WhatsApp enquiry is a lead like any other — same de-duplication, ' +
      'same attribution, same notifications.')
  })

  test('and not into a table of its own', () => {
    for (const table of ['chatbot_leads', 'bot_leads', 'whatsapp_leads']) {
      assert.ok(!webhook.includes(table), `The webhook writes ${table} instead of leads.`)
    }
  })

  test('an existing lead is found before a new one is created', () => {
    const create = webhook.indexOf('intakeLead(')
    const find = webhook.indexOf(".in('phone', variants)")
    assert.ok(find > 0 && find < create,
      'The lookup by phone must come first, or every message makes a new lead.')
  })

  test('handover uses the portal notifications staff already read', () => {
    assert.match(webhook, /from\('notifications'\)/,
      'There must not be a second place for staff to check.')
  })
})

describe('the portal is where the chatbot is managed', () => {
  const nav = codeOf('lib/nav/model.ts')

  test('it has its own section in the existing menu', () => {
    assert.match(nav, /chatbot: 'Chatbot'/,
      'The section needs a title or it renders unlabelled.')
    assert.match(nav, /SECTION_ORDER = \[[^\]]*'chatbot'/,
      'A section missing from SECTION_ORDER renders nowhere at all.')
  })

  test('and its portals can still be granted on the permissions screen', () => {
    /*
     * portalGroups() builds that screen from SECTION_LABELS. Moving the
     * assistant's entries into a section missing from it would take WhatsApp
     * lines, Knowledge and Conversations off the screen entirely — nobody
     * could grant them again, and nothing would have said so.
     */
    assert.match(nav, /\['chatbot', 'Chatbot'\]/,
      'SECTION_LABELS needs the section, or its portals vanish from Permissions.')
  })

  test('the overview page exists and is reachable', () => {
    assert.ok(existsSync('app/(portal)/admin/chatbot/page.tsx'))
    const portals = codeOf('lib/access/portals.ts')
    assert.match(portals, /'\/admin\/chatbot'/,
      'A page no portal grants is a menu entry that leads to a refusal.')
  })

  test('the overview links to the existing screens rather than reproducing them', () => {
    const page = codeOf('app/(portal)/admin/chatbot/page.tsx')
    for (const href of ['/admin/whatsapp', '/admin/conversations', '/admin/knowledge', '/admin/leads']) {
      assert.ok(page.includes(href), `The overview should point at ${href}, not rebuild it.`)
    }
  })

  test('a deferred channel is not reported as a fault', () => {
    const page = codeOf('app/(portal)/admin/chatbot/page.tsx')
    assert.match(page, /Deferred/,
      'WhatsApp and SMS are deliberately not connected. A page that calls that ' +
      'a failure is a page whose warnings nobody believes.')
  })
})
