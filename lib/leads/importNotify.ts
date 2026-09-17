import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { queueSMS } from '@/lib/notifications/sms'
import { sendEmail } from '@/lib/integrations/email'
import { publicUrl } from '@/lib/url'
import { BRAND } from '@/lib/brand'

/**
 * TELLING PEOPLE ABOUT A BATCH OF LEADS.
 *
 * ── WHY THIS IS NOT notifyLeadAssigned IN A LOOP ───────────────────────────
 *
 * Imported leads were assigned and nobody was ever told: the importer calls
 * distributeLead directly, so it never passed through onLeadAssigned and no
 * in-app notification, text or email was sent for any of them. A spreadsheet
 * of two hundred enquiries landed silently.
 *
 * The obvious repair — call the single-lead notifier for each row — is worse
 * than the bug. A marketer who receives forty leads from one upload would get
 * forty texts and forty emails, which is forty times the cost, a phone nobody
 * can use for a minute, and a mailbox that buries the very leads it is
 * announcing.
 *
 * So a batch is announced ONCE per person: one in-app notification, one text
 * and one email each saying how many arrived and linking to the list. The
 * per-lead notifier remains exactly right for a lead that arrives on its own,
 * which is the ordinary case.
 *
 * Every channel is independent and none of them can affect the import, which
 * has already committed every row by the time this runs.
 */

export type BatchNotifyOutcome = {
  people: number
  inApp: number
  sms: number
  email: number
  failures: string[]
}

export async function notifyImportBatch(
  /** How many leads each person received in this batch. */
  byMarketer: Map<string, number>,
  reference: string,
): Promise<BatchNotifyOutcome> {
  const out: BatchNotifyOutcome = { people: 0, inApp: 0, sms: 0, email: 0, failures: [] }
  if (byMarketer.size === 0) return out

  const sb = createServiceClient()
  const ids = [...byMarketer.keys()]

  const { data: people, error } = await sb.from('profiles')
    .select('id, full_name, phone, email, is_active').in('id', ids)

  if (error) {
    out.failures.push(`Could not read who to notify: ${error.message}`)
    return out
  }

  const listLink = publicUrl('/marketer/leads')

  for (const person of people || []) {
    if (person.is_active === false) continue

    const count = byMarketer.get(person.id) || 0
    if (count < 1) continue
    out.people++

    const firstName = String(person.full_name || '').split(' ')[0] || 'there'
    const many = count === 1 ? '1 new lead' : `${count} new leads`

    /* ── in app ─────────────────────────────────────────────────────────── */
    const { error: inAppError } = await sb.from('notifications').insert({
      user_id: person.id,
      type: 'lead',
      title: `${many} assigned to you`,
      body: `${many} from an imported list have been assigned to you. Start with the oldest.`,
      link: '/marketer/leads',
    })
    if (inAppError) out.failures.push(`in-app for ${person.id}: ${inAppError.message}`)
    else out.inApp++

    /* ── text ───────────────────────────────────────────────────────────── */
    if (person.phone) {
      try {
        const res = await queueSMS({
          to: person.phone,
          message: `${BRAND.shortName}: Hi ${firstName}, ${many} assigned to you. Open the portal: ${listLink}`,
          kind: 'lead_import_batch',
          entityId: reference,
          /*
           * One text per person per import run. A batched upload calls the
           * importer repeatedly with the same reference, so without this a
           * five-batch file would text five times.
           */
          dedupeKey: `import_batch:${reference}:${person.id}`,
        })
        if (res.sent || res.queued) out.sms++
        else if (!res.duplicate) out.failures.push(`sms for ${person.id}: number not usable`)
      } catch (e) {
        out.failures.push(`sms for ${person.id}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    /* ── email ──────────────────────────────────────────────────────────── */
    const address = String(person.email || '').trim()
    if (address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      try {
        const ok = await sendEmail(
          address,
          `${many} assigned to you`,
          batchHtml(firstName, many, listLink),
          `Hi ${firstName},\n\n${many} from an imported list have been assigned to you.\n\nOpen them: ${listLink}\n\n— ${BRAND.name}`,
        )
        if (ok) out.email++
        else out.failures.push(`email for ${person.id}: provider did not accept`)
      } catch (e) {
        out.failures.push(`email for ${person.id}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }
  }

  if (out.failures.length) {
    console.error(`[import ${reference}] some batch notifications failed:`, out.failures)
  }
  return out
}

function batchHtml(firstName: string, many: string, link: string): string {
  const esc = (s: string) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#8C9A94;font-weight:600;margin-bottom:24px">${esc(BRAND.name)}</div>
    <h1 style="font-size:20px;font-weight:600;margin:0 0 8px;color:#10231C">${esc(many)} assigned to you</h1>
    <p style="font-size:14px;color:#5A6B64;line-height:1.6;margin:0 0 24px">Hi ${esc(firstName)}, these came in from an imported list. Start with the oldest — they have been waiting longest.</p>
    <a href="${esc(link)}" style="display:inline-block;background:#10231C;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;border-radius:12px">Open my leads</a>
    <p style="font-size:12px;color:#8C9A94;line-height:1.6;margin:24px 0 0">You are receiving this because these leads were assigned to you in the ${esc(BRAND.shortName)} portal.</p>
  </div>`
}
