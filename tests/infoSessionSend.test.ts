import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normaliseRecipient } from '../lib/integrations/smsRecipient.ts'

/**
 * THE INFORMATION SECTION SENT NOTHING.
 *
 * ── WHAT WAS REPORTED ──────────────────────────────────────────────────────
 *
 * The Admissions team opened the Information section, chose SMS, filled it in,
 * pressed send, and nothing went out.
 *
 * ── WHAT WAS WRONG, IN ORDER OF HOW MUCH IT MATTERED ───────────────────────
 *
 *   1. The route refused them. Three layers — the portal catalogue, the API
 *      path guard and the sidebar — all admit anybody holding grp_automation.
 *      The handlers checked a hardcoded list of two ROLES. An admissions
 *      officer saw the section, used it, and got 401 on every request. The
 *      only visible symptom was a toast reading "unauth", and the list of
 *      past sessions came back empty for the same reason.
 *
 *   2. A disconnected WhatsApp reported success. With no API key the sender
 *      records the message and returns true, so every lead counted as
 *      notified and the session marked itself sent having reached nobody.
 *
 *   3. One request messaged up to five thousand leads in sequence. The
 *      platform killed it part way through, leaving the session `scheduled`
 *      with some people already messaged — and the retry started from the top
 *      and messaged them again.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const route = codeOf('app/api/info-sessions/route.ts')
const preview = codeOf('app/api/info-sessions/preview/route.ts')
const attendance = codeOf('app/api/info-sessions/attendance/route.ts')
const campaign = codeOf('lib/infoSessionCampaign.ts')
const worker = codeOf('app/api/info-sessions/worker/route.ts')
/*
 * The migration with its commentary stripped. Every claim below is about the
 * SQL — and the file explains itself at length, so a search of the whole
 * thing is satisfied by a sentence describing what the SQL ought to do. One
 * of these assertions passed against SQL that had had `SKIP LOCKED` removed,
 * because the paragraph above it still said the words.
 */
const migration = readFileSync('supabase/migrations/0029_info_session_recipients.sql', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*--.*$/gm, '')
const page = codeOf('app/(portal)/pm/info-sessions/page.tsx')

describe('who may use the Information section', () => {
  test('the portal decides, not a hardcoded pair of roles', () => {
    for (const [name, src] of [['route', route], ['preview', preview], ['attendance', attendance]] as const) {
      assert.match(src, /withGuard\(\{ portals: PORTALS \}/, `${name} is not guarded by the portal`)
      assert.ok(!/ALLOWED\s*=\s*\[/.test(src), `${name} still has its own role list`)
      assert.ok(!/'unauth'/.test(src), `${name} still answers with "unauth"`)
    }
  })

  test('and it is the same portal the page and the path already use', () => {
    /*
     * The three had to agree. They did — with each other, and not with the
     * handler, which is the only one a person actually hits.
     */
    const portals = readFileSync('lib/access/portals.ts', 'utf8')
    const api = readFileSync('lib/access/apiAccess.ts', 'utf8')
    assert.match(portals, /grp_automation: \['\/pm\/info-sessions'/)
    assert.match(api, /'\/api\/info-sessions':\s*\['grp_automation'\]/)
    assert.match(route, /const PORTALS = \['grp_automation'\]/)
  })

  test('a session with no channel at all is refused when it is created', () => {
    // Every channel can be switched off in the form. Saved, it would sit
    // scheduled for ever and send nothing.
    assert.match(route, /Choose at least one way to send it/)
  })

  test('the send has room to finish', () => {
    // The platform default is ten to fifteen seconds.
    assert.match(route, /export const maxDuration = 60/)
  })
})

describe('what counts as having reached somebody', () => {
  test('a channel is used only if it can actually send', () => {
    /*
     * The recorder trap. With no key, sendWhatsAppText keeps the message and
     * returns true — so the count was of messages RECORDED, not delivered.
     */
    assert.match(campaign, /whatsapp: wanted\.includes\('whatsapp'\) && whatsappConnected\(\)/)
    assert.match(campaign, /sms: wanted\.includes\('sms'\) && smsConnected\(\)/)
    assert.match(campaign, /email: wanted\.includes\('email'\) && emailConfigured\(\)/)
  })

  test('and if none of them can, the campaign stops rather than completing', () => {
    assert.match(campaign, /None of the channels chosen/)
    assert.match(campaign, /so the campaign was stopped rather than marked sent/)
  })

  test('the figures are kept apart', () => {
    /*
     * Total, pending, processing, sent, failed and unreachable are six
     * different facts. Reporting them as one number is what let "Sent to 212
     * leads" describe a session nobody received.
     */
    for (const field of ['total:', 'pending:', 'processing:', 'sent:', 'failed:', 'unreachable:']) {
      assert.ok(campaign.includes(field), `progress does not report ${field}`)
    }
  })

  test('the screen never calls a raw count "sent"', () => {
    assert.ok(!/Sent to \$\{d\.leads_notified\} leads/.test(page))
    assert.match(page, /Submitted/)
  })
})

describe('one click finishes the whole campaign', () => {
  /**
   * ── WHAT WAS WRONG ───────────────────────────────────────────────────────
   *
   * Every recipient was messaged in a loop inside the request that pressed
   * Send. A serverless invocation does not live long enough for a few
   * hundred, so the loop stopped at a time budget and told the operator
   * "566 left to send — press Send again to continue". For a list of eight
   * hundred that is six presses. The person had become the scheduler.
   */

  test('the Send request starts the campaign; it does not send it', () => {
    /*
     * The request enrols the audience, marks the session sending and fires
     * the first hop. It deliberately does not loop over recipients — that
     * loop is what capped a campaign at one invocation's lifetime.
     */
    assert.match(route, /async function startCampaign\(/)
    assert.match(route, /await enrolRecipients\(\s*\n?\s*session\.id/)
    assert.match(route, /await triggerNextHop\(session\.id, 0\)/)
    assert.ok(!/for \(const lead of/.test(route), 'the request still loops over recipients')
  })

  test('and says so, instead of reporting a partial send', () => {
    assert.match(route, /It continues on its own — you can leave this page/)
    assert.ok(!/press Send again/i.test(route))
    assert.ok(!/press Send again/i.test(page), 'the screen still asks for another press')
    assert.ok(!/left to send/i.test(page))
  })

  test('each hop starts the next one', () => {
    /*
     * The chain. A hop processes a batch and, if the ledger still has work,
     * makes an HTTP request that becomes the next invocation — a fresh
     * function with its own budget. Nothing is kept in memory between them,
     * because on this platform nothing can be.
     */
    assert.match(campaign, /export async function triggerNextHop/)
    assert.match(campaign, /await triggerNextHop\(sessionId, hop\)/)
    assert.match(campaign, /chained: true/)
  })

  test('the chain does not wait for the campaign it starts', () => {
    // Awaiting the next hop's response would tie this invocation's lifetime
    // to the whole remaining campaign, which is the thing being avoided.
    assert.match(campaign, /signal: AbortSignal\.timeout\(1_500\)/)
  })

  test('a runaway chain is capped', () => {
    assert.match(campaign, /const MAX_HOPS = 2_000/)
    assert.match(campaign, /if \(hop >= MAX_HOPS\)/)
  })

  test('it stops chaining when the ledger says there is nothing left', () => {
    assert.match(campaign, /if \(progress\.complete\)/)
    assert.match(campaign, /return \{ \.\.\.batch, progress, chained: false \}/)
  })

  test('and only then is the campaign marked sent', () => {
    /*
     * A status written optimistically by the first hop is what let a
     * half-finished campaign look finished. It is set once, by the hop that
     * finds nothing left, and only over a session still `sending`.
     */
    const done = campaign.slice(campaign.indexOf('if (progress.complete)'))
    assert.match(done.slice(0, 500), /status: 'sent'/)
    assert.match(done.slice(0, 500), /\.eq\('status', 'sending'\)/)
  })

  test('a hop that runs out of time hands its claim back', () => {
    /*
     * Rather than leaving those rows claimed for the five minutes the stale
     * sweep waits. The next hop is already starting and may as well find them.
     */
    assert.match(campaign, /const HOP_BUDGET_MS = 35_000/)
    assert.match(campaign, /released\.push\(r\.id\)/)
    assert.match(campaign, /status: 'pending', claimed_at: null/)
  })
})

describe('the campaign remembers who it has reached', () => {
  test('one row per campaign per lead, and enrolling twice changes nothing', () => {
    /*
     * The idempotency identity the whole design rests on. Enrolling is called
     * by the Send request AND by the recovery sweep, so it has to be safe to
     * call on a campaign already under way.
     */
    assert.match(migration, /UNIQUE \(session_id, lead_id\)/)
    assert.match(campaign, /onConflict: 'session_id,lead_id', ignoreDuplicates: true/)
  })

  test('two workers never take the same person', () => {
    // FOR UPDATE SKIP LOCKED: they take different rows and neither waits.
    assert.match(migration, /FOR UPDATE SKIP LOCKED/)
    assert.match(migration, /CREATE OR REPLACE FUNCTION claim_info_session_batch/)
  })

  test('a batch claimed by a worker that died is reclaimed', () => {
    assert.match(migration, /c\.status = 'claimed' AND c\.claimed_at < NOW\(\) - p_stale/)
    assert.match(migration, /p_stale   INTERVAL DEFAULT '5 minutes'/)
  })

  test('but not for ever — a dead number stops being retried', () => {
    assert.match(migration, /AND c\.attempts < 4/)
  })

  test('every recipient keeps its own state and reason', () => {
    assert.match(migration, /status      TEXT NOT NULL DEFAULT 'pending'/)
    assert.match(migration, /last_error  TEXT/)
    assert.match(migration, /channel     TEXT/)
  })

  test('and a text still carries its own dedupe key as well', () => {
    // Belt and braces: the ledger prevents a second attempt; this prevents a
    // second TEXT even if it ever did not.
    assert.match(campaign, /dedupeKey: `info_session:\$\{sessionId\}:\$\{r\.lead_id\}`/)
  })

  test('the table is not readable by a browser key', () => {
    assert.match(migration, /ALTER TABLE info_session_recipients ENABLE ROW LEVEL SECURITY/)
  })
})

describe('a campaign that was part-sent before the ledger existed', () => {
  /**
   * One campaign in production is in exactly this state: 105 recipients
   * texted across the runs that had to be pressed by hand, and the remainder
   * never reached. Enrolling it marks everybody `pending`, including those
   * 105 — and while the queue's dedupe key stops a second TEXT, it says
   * nothing about WhatsApp, which is tried first. They would get the
   * invitation again, through the other door.
   */
  test('the texts that definitely went are credited first', () => {
    assert.match(campaign, /async function honourEarlierSends/)
    assert.match(campaign, /await honourEarlierSends\(sessionId\)/)
    assert.match(campaign, /\.eq\('kind', 'info_session'\)/)
    assert.match(campaign, /\.eq\('status', 'sent'\)/)
  })

  test('the lead is read from the key this system wrote', () => {
    // sms_logs records a phone number, not a lead. The key carries the id:
    // info_session:<session>:<lead>.
    assert.match(campaign, /String\(r\.dedupe_key \|\| ''\)\.split\(':'\)\[2\]/)
    assert.match(campaign, /\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(id\)/)
  })

  test('and only rows still pending are credited', () => {
    /*
     * A result the campaign has since recorded for itself must not be
     * overwritten by history — a recipient marked failed yesterday is not
     * made "sent" by a text from last week.
     */
    const fn = campaign.slice(campaign.indexOf('async function honourEarlierSends'))
    const update = fn.slice(fn.indexOf("from('info_session_recipients')"))
    assert.match(update.slice(0, 400), /\.eq\('status', 'pending'\)/)
  })

  test('a failed read there does not stop the campaign', () => {
    // The worst case is the dedupe key doing this job for SMS alone, which is
    // where it was before.
    assert.match(campaign, /could not read earlier sends/)
  })
})

describe('a campaign finishes even when a hop does not', () => {
  test('the dispatcher sweeps for anything unfinished', () => {
    /*
     * The chain makes finishing prompt. This makes it certain: a hop that
     * died before it could start the next one leaves a campaign still
     * `sending`, and the sweep picks it up.
     */
    assert.match(worker, /\.in\('status', \['sending', 'scheduled'\]\)/)
    const cron = codeOf('app/api/cron/run/route.ts')
    assert.match(cron, /path: '\/api\/info-sessions\/worker'/)
  })

  test('a scheduled campaign starts itself, through the same path', () => {
    /*
     * Not a second implementation of sending. The sweep enrols it, switches
     * it to sending, and hands it to the same advanceCampaign the button
     * uses — two routines is how the scheduled path and the manual one came
     * to behave differently.
     */
    assert.match(worker, /if \(s\.status === 'scheduled'\)/)
    assert.match(worker, /await enrolRecipients\(s\.id, s\.audience \|\| 'all_leads'\)/)
    assert.match(worker, /await advanceCampaign\(s\.id, 0\)/)
  })

  test('the old cron path runs the same engine, not a copy of it', () => {
    const run = codeOf('app/api/info-sessions/run/route.ts')
    assert.match(run, /advanceCampaign/)
    assert.match(run, /enrolRecipients/)
    assert.ok(!/sendWhatsAppText|queueSMS/.test(run), 'it sends on its own again')
  })

  test('the worker is only callable by the server', () => {
    assert.match(worker, /isValidCronRequest\(req\)/)
    assert.match(worker, /status: 401/)
  })

  test('and says plainly when the migration has not been run', () => {
    // Rather than failing with a PostgREST error nobody outside this
    // codebase can read.
    assert.match(worker, /Migration 0029 has not been run/)
    assert.match(campaign, /await tableExists\('info_session_recipients'\)/)
  })
})

describe('progress is read, not guessed', () => {
  test('the counts come from the ledger', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION info_session_progress/)
    assert.match(campaign, /rpc\('info_session_progress'/)
  })

  test('complete means nothing pending and nothing in flight', () => {
    assert.match(campaign, /p\.complete = p\.total > 0 && p\.pending === 0 && p\.processing === 0/)
  })

  test('the screen polls while something is sending, and stops when nothing is', () => {
    /*
     * The thing that STARTS the polling, not only the cleanup. A test for
     * clearInterval alone passes on a screen that never set one.
     */
    assert.match(page, /\/api\/info-sessions\/progress\?session=/)
    assert.match(page, /const timer = setInterval\(tick, 4000\)/)
    assert.match(page, /if \(!sending\.length\) return/)
    assert.match(page, /clearInterval\(timer\)/)
  })

  test('and shows the six figures apart', () => {
    for (const label of ['Total', 'Submitted', 'Processing', 'Remaining', 'Failed', 'No usable number']) {
      assert.ok(page.includes(`'${label}'`), `the progress panel does not show ${label}`)
    }
  })

  test('the operator is told they can close the page', () => {
    assert.match(page, /You can close this page/)
  })
})

describe('numbers that cannot be dialled are named, not dropped', () => {
  test('the operator is told which ones to correct', () => {
    /*
     * Named, not just counted: three wrong numbers and no word on which three
     * leaves the list wrong for ever. Read from the ledger, so they survive
     * the page being closed — unlike the toast that used to carry them.
     */
    assert.match(campaign, /\.eq\('status', 'unreachable'\)/)
    assert.match(campaign, /p\.badNumbers = \(bad \|\| \[\]\)\.map/)
    assert.match(page, /Need correcting/)
    assert.match(page, /progress\[s\.id\]\.badNumbers/)
  })

  test('the Ghanaian spellings all reach the same number', () => {
    /*
     * The four forms a spreadsheet, a form and a person all produce. They are
     * one phone, and the sender has to see them as one.
     */
    const expected = '233244721555'
    for (const form of [
      '0244721555', '233244721555', '+233244721555',
      '+233 24 472 1555', '024-472-1555', '(024) 472 1555', '00233244721555',
    ]) {
      assert.equal(normaliseRecipient(form), expected, `${form} did not normalise`)
    }
  })

  test('a bare nine digits is refused here, and that is deliberate', () => {
    /*
     * `244721555` has no 0 and no country code. The IMPORT accepts it, because
     * Excel eats the leading zero off a phone column and the alternative is
     * throwing away real people — and it stores the canonical form, so what
     * lands in the database is dialable either way.
     *
     * The SENDER is stricter on purpose. By the time a number reaches Arkesel
     * it has been through a writer that should have canonicalised it, so nine
     * bare digits means something else went wrong, and guessing a country
     * code onto it would post a request that delivers nowhere and is then
     * retried.
     */
    assert.equal(normaliseRecipient('244721555'), null)
  })

  test('054 and the other networks too', () => {
    assert.equal(normaliseRecipient('0541234567'), '233541234567')
    assert.equal(normaliseRecipient('0201234567'), '233201234567')
    assert.equal(normaliseRecipient('0501234567'), '233501234567')
  })

  test('and something that is not a number is refused rather than guessed at', () => {
    for (const bad of ['', '12345', 'not a number', '0244', null, undefined]) {
      assert.equal(normaliseRecipient(bad as string), null, `${bad} was accepted`)
    }
  })
})

/**
 * ─── CREATING ONE AND SENDING IT, IN ONE ACTION ─────────────────────────────
 *
 * Scheduling was the only way in: fill the form, choose a time for it to
 * auto-send, save it, then find the row in the list and press Send. For an
 * invitation going out now anyway that is three steps — and the auto-send
 * time was REQUIRED, so somebody sending immediately still had to invent one.
 */
describe('a session can send the moment it is created', () => {
  test('the route takes send_now and uses now as the send time', () => {
    assert.match(route, /const sendNow = send_now === true/)
    assert.match(route, /const notifyAt = sendNow \? new Date\(\)\.toISOString\(\) : notify_at/)
  })

  test('and does not demand an auto-send time for it', () => {
    /*
     * "When should it auto-send?" has an obvious answer when the button says
     * Send now, and making somebody fill it in anyway was the friction.
     */
    assert.ok(!/!title\?\.trim\(\) \|\| !link\?\.trim\(\) \|\| !scheduled_at \|\| !notify_at/.test(route),
      'the auto-send time is still required for every session')
    assert.match(route, /if \(!notifyAt\)/)
  })

  test('it is saved before anything is started', () => {
    /*
     * A campaign interrupted at any point must leave a session that can be
     * continued, not invitations that reached some people and no record.
     */
    const insert = route.indexOf("from('info_sessions').insert({")
    const start = route.indexOf('return startCampaign(data)')
    assert.ok(insert > -1 && start > insert, 'it starts sending before the row exists')
  })

  test('and a campaign that could not start says the session was kept', () => {
    assert.match(route, /The session is saved, so you can start it from the list/)
  })

  test('the button and the create-and-send path start it the same way', () => {
    // One behaviour, not two implementations of it.
    assert.equal((route.match(/return startCampaign\(/g) || []).length, 2)
    assert.match(route, /async function startCampaign\(/)
  })

  test('the form offers both', () => {
    assert.match(page, /onClick=\{\(\) => create\(true\)\}/)
    assert.match(page, /onClick=\{\(\) => create\(false\)\}/)
  })

  test('and it confirms before it blasts', () => {
    /*
     * The CONDITION, not the words inside it. `if (false && !await confirm(…))`
     * leaves the whole dialog in the file, question and warning and all, and
     * asks nobody.
     */
    assert.match(page, /if \(sendNow && !await confirm\(\{/)
    assert.match(page, /Create and send it now\?/)
    assert.match(page, /cannot be recalled/)
  })

  test('both paths report the start the same way', () => {
    /*
     * Two reporters would drift, and the one that drifts is the one that
     * says "sent" about a campaign that has barely begun.
     */
    assert.match(page, /function reportStart\(/)
    assert.match(page, /if \(sendNow && d\.started\) reportStart\(d\)/)
    assert.match(page, /reportStart\(d, 'sn'\)/)
  })

  test('a session with no channel is refused before it is saved', () => {
    assert.match(page, /Choose at least one way to send it/)
    assert.match(route, /Choose at least one way to send it/)
  })
})

/**
 * ─── A CAMPAIGN THAT WAS STOPPED ────────────────────────────────────────────
 *
 * PMP INFORMATION SESSION reached 105 of 642 and was cancelled when the SMS
 * credits ran out. The screen then offered nothing: no resume, no delete, and
 * the row sat there as a dead end. The only way to finish the send was to
 * create the campaign again — which would have messaged those 105 twice, and
 * would have reported a second campaign's figures for one invitation.
 *
 * So: cancelled is a state you can leave, in one of two directions.
 */
describe('a cancelled campaign can be resumed or put away', () => {
  const resumeBranch = route.slice(
    route.indexOf("if (action === 'resume')"), route.indexOf("if (action === 'delete')"))
  const deleteBranch = route.slice(
    route.indexOf("if (action === 'delete')"), route.indexOf("if (action === 'send_now')"))

  test('the branches exist and are not empty', () => {
    // Everything below slices these, and a slice of nothing matches nothing.
    assert.ok(resumeBranch.length > 200, 'there is no resume branch')
    assert.ok(deleteBranch.length > 200, 'there is no delete branch')
  })

  test('resuming re-enrols nobody and re-resolves no audience', () => {
    /*
     * This is the whole correctness claim. The ledger already holds who was
     * selected and who has been reached; resuming is a status change and a
     * nudge. Re-running the audience would pick up leads added since, and
     * re-enrolling would reset rows that have already been sent.
     */
    assert.ok(!/enrolRecipients/.test(resumeBranch), 'resume re-enrols the audience')
    assert.ok(!/resolveAudience/.test(resumeBranch), 'resume re-resolves the audience')
    assert.match(resumeBranch, /await triggerNextHop\(id, 0\)/)
  })

  test('and only the rows still pending are ever claimed', () => {
    // The other half of "nobody is messaged twice" lives in the claim itself.
    assert.match(campaign, /\.eq\('status', 'pending'\)/)
  })

  test('resuming anything that is not cancelled is refused', () => {
    assert.match(resumeBranch, /if \(s\.status !== 'cancelled'\)/)
    assert.match(resumeBranch, /not cancelled, so there is nothing to resume/)
  })

  test('and two people pressing Resume together start it once', () => {
    /*
     * The status is written over `cancelled` specifically, so the second
     * update matches no row. Without it both requests fire a first hop and
     * two chains run over one ledger.
     */
    assert.match(resumeBranch, /\.eq\('id', id\)\.eq\('status', 'cancelled'\)/)
  })

  test('a campaign that has sent nothing is deleted outright', () => {
    assert.match(deleteBranch, /\.delete\(\)\.eq\('id', id\)/)
    assert.match(deleteBranch, /action: 'info_session\.deleted'/)
  })

  test('but one that has already messaged people is archived, not deleted', () => {
    /*
     * The delivery record is evidence of what was sent to whom. The ORDER
     * matters: the archive must be reached by the branch that finds sent > 0,
     * and the delete must be after it, or a sent campaign is erased.
     */
    assert.match(deleteBranch, /const progress = await campaignProgress\(id\)/)
    assert.match(deleteBranch, /const everSent = !\('error' in progress\) && progress\.sent > 0/)
    const guard = deleteBranch.indexOf('if (everSent)')
    const archive = deleteBranch.indexOf("status: 'archived'")
    const hardDelete = deleteBranch.indexOf('.delete()')
    assert.ok(guard > -1, 'nothing checks whether it ever sent')
    assert.ok(archive > guard && archive < hardDelete,
      'the archive is not inside the branch that finds messages already sent')
    assert.ok(hardDelete > archive, 'a campaign that has sent can reach the delete')
  })

  test('archiving keeps the recipients; it does not sweep them up', () => {
    assert.ok(!/from\('info_session_recipients'\)\s*\n?\s*\.delete\(\)/.test(route),
      'the ledger is deleted along with the campaign')
  })

  test('and an archived campaign is out of the list without being gone', () => {
    assert.match(route, /\.neq\('status', 'archived'\)/)
  })

  test('the worker sends nothing for a cancelled or archived campaign', () => {
    /*
     * Read before every batch. Resuming works by changing this status, so the
     * same check is what makes cancel stop the next batch and what keeps the
     * daily recovery sweep from restarting something somebody stopped.
     */
    const guard = campaign.slice(campaign.indexOf("if (s.status === 'cancelled'"))
    assert.match(guard.slice(0, 200), /\|\| s\.status === 'archived'/)
    assert.match(guard.slice(0, 200), /more: false/)
  })

  test('only an administrator or project manager may resume or delete', () => {
    /*
     * Everybody holding grp_automation can create and send — that is the
     * portal's decision and it was hard won. Undoing somebody else's campaign
     * is a different act, so these two check the role as well.
     */
    for (const [name, branch] of [['resume', resumeBranch], ['delete', deleteBranch]] as const) {
      assert.match(branch, /if \(!MAY_MANAGE\.includes\(String\(session\.role\)\)\)/,
        `${name} does not check the role`)
      assert.match(branch, /status: 403/, `${name} does not refuse`)
    }
    assert.match(route, /const MAY_MANAGE: readonly string\[\] = COMPANY_LEAD_ROLES/)
  })

  test('and both are written to the audit log', () => {
    for (const action of ['resumed', 'archived', 'deleted']) {
      assert.match(route, new RegExp(`action: 'info_session\\.${action}'`),
        `${action} is not recorded`)
    }
  })

  test('the screen offers the actions that fit the state it is in', () => {
    /*
     * A finished campaign is never offered Resume, and a cancelled one is
     * never offered Cancel. The CONDITION is what is asserted — the labels
     * can all sit in the file behind `{false && …}` and the test still finds
     * the words.
     */
    assert.match(page, /\{s\.status === 'scheduled' && \(/)
    assert.match(page, /\{s\.status === 'cancelled' && \(/)
    assert.match(page, /\{\(s\.status === 'sent' \|\| s\.status === 'archived'\) && \(/)
    const cancelledBlock = page.slice(
      page.indexOf("{s.status === 'cancelled' && ("),
      page.indexOf("{(s.status === 'sent' || s.status === 'archived') && ("))
    assert.match(cancelledBlock, /resume\(s\.id, s\.title\)/)
    assert.match(cancelledBlock, /remove\(s\.id, s\.title, Number\(s\.leads_notified\) > 0\)/)
    assert.ok(!/cancel\(s\.id\)/.test(cancelledBlock), 'a cancelled campaign is offered Cancel')
  })

  test('resuming asks first, and says what is actually left', () => {
    const fn = page.slice(page.indexOf('async function resume('), page.indexOf('async function remove('))
    assert.match(fn, /if \(!await confirm\(\{/)
    assert.match(fn, /counts\.pending \+ counts\.processing/)
    assert.match(fn, /has reached \$\{counts\.sent\} of \$\{counts\.total\}/)
    assert.match(fn, /Anybody already reached is skipped/)
  })

  test('and removing says which of the two things it is about to do', () => {
    /*
     * "Delete this campaign?" over a campaign that will actually be kept as a
     * record is the kind of wording that makes somebody press it to find out.
     */
    const fn = page.slice(page.indexOf('async function remove('), page.indexOf('async function sendNow('))
    assert.match(fn, /everSent \? 'Remove this campaign from the list\?' : 'Delete this campaign\?'/)
    assert.match(fn, /tone: 'danger'/)
    assert.match(fn, /the record `?\s*\n?\s*\+ 'of who was messaged/)
    assert.match(fn, /The leads it selected are/)
  })
})
