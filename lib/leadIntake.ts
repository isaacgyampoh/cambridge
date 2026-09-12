import { createServiceClient } from '@/lib/supabase/server'
import { canonicalPhone, phoneVariants } from '@/lib/leads/importValidation'
import { lookup } from '@/lib/db/lookup'
import { autoAssignLead } from '@/lib/autoAssign'
import { SMS } from '@/lib/integrations/sms'
import { queueSMS } from '@/lib/notifications/sms'

/**
 * SINGLE ENTRY POINT for every inbound lead — Facebook, Google, LinkedIn,
 * website, or anywhere else. Guarantees every lead is treated identically:
 *   1. de-duplicated by phone/email
 *   2. created with full source + UTM attribution
 *   3. auto-assigned to a marketer (which also fires the AI opening message
 *      and nurture-sequence enrolment)
 *   4. project managers notified
 *
 * Returns { leadId, assignedTo, duplicate }.
 */
export type IncomingLead = {
  full_name?: string
  email?: string | null
  phone?: string | null
  source: string                 // 'facebook' | 'google' | 'linkedin' | 'website' | ...
  course_interest?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  landing_source?: string | null
  city?: string | null
  education_level?: string | null
  raw_payload?: any
  extra?: Record<string, any>    // source-specific columns (e.g. fb_lead_id)
  preferredMarketerId?: string | null  // assign straight to this marketer (personal referral link)
}

/**
 * One spelling of a number, shared with the import pipeline.
 *
 * This used to be a second, private implementation, and it disagreed with the
 * canonical one on exactly the inputs that matter. Given "00233201234567" it
 * saw a leading zero, replaced it, and stored `2330233201234567` — a number
 * that cannot be rung and that no dedupe variant will ever match again, so
 * that person comes back as a new lead every time they enquire.
 *
 * A number that is not a Ghanaian mobile is kept as plain digits rather than
 * discarded: the centre does take the occasional international enquiry, and a
 * number somebody has to reformat by hand beats no number at all.
 */
function normalizePhone(p?: string | null): string | null {
  if (!p) return null
  return canonicalPhone(p) ?? (String(p).replace(/\D/g, '') || null)
}

const PRETTY: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', google: 'Google',
  linkedin: 'LinkedIn', tiktok: 'TikTok', website: 'Website', whatsapp: 'WhatsApp', referral: 'Referral',
}

export async function intakeLead(input: IncomingLead): Promise<{ leadId: string | null; assignedTo: string | null; duplicate: boolean }> {
  const sb = createServiceClient()
  const phone = normalizePhone(input.phone)
  const email = input.email?.trim().toLowerCase() || null

  /*
   * 1) De-dupe: the same person in the last 60 days is not a second lead.
   *
   * ── WHY THIS IS TWO QUERIES AND NOT ONE `.or()` ──────────────────────────
   *
   * It was one, built by interpolation:
   *
   *     q.or(`phone.eq.${phone},email.eq.${email}`)
   *
   * `email` arrives in the body of a PUBLIC webhook — website, Facebook,
   * Google, LinkedIn — and PostgREST parses that string as filter syntax, so
   * a comma in the address is a new condition. An address of
   * `x@y.com,assigned_to.not.is.null` produced
   *
   *     or=(phone.eq.233…,email.eq.x@y.com,assigned_to.not.is.null)
   *
   * which matches the first assigned lead of the last sixty days. The real
   * lead is then never created — it is reported as a duplicate — and the
   * caller is handed an unrelated lead's database id. Anyone who could post
   * to a webhook could make enquiries disappear.
   *
   * Two `.eq`/`.in` queries take their values as values, so there is no
   * string for an address to be part of.
   *
   * Matching on every spelling of the number, rather than just the canonical
   * one, also catches the rows older code paths wrote as 0201234567 or
   * 201234567 — those used to come back as new people.
   */
  if (phone || email) {
    const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString()
    let existing: { id: string; assigned_to: string | null } | null = null

    const variants = phoneVariants(phone)
    if (variants.length) {
      const { row, failed } = await lookup(
        sb.from('leads').select('id, assigned_to')
          .gte('created_at', since).in('phone', variants).limit(1).maybeSingle(),
      )
      // Fail CLOSED. Read as "nobody matched", a failure here creates a
      // second record for somebody already on file, and their history, owner
      // and call notes stay behind on the first one.
      if (failed) {
        console.error('[intakeLead] duplicate check by phone failed:', failed)
        return { leadId: null, assignedTo: null, duplicate: false }
      }
      existing = row
    }

    if (!existing && email) {
      const { row, failed } = await lookup(
        sb.from('leads').select('id, assigned_to')
          .gte('created_at', since).eq('email', email).limit(1).maybeSingle(),
      )
      if (failed) {
        console.error('[intakeLead] duplicate check by email failed:', failed)
        return { leadId: null, assignedTo: null, duplicate: false }
      }
      existing = row
    }

    if (existing) return { leadId: existing.id, assignedTo: existing.assigned_to || null, duplicate: true }
  }

  // 2) Create the lead with full attribution
  const { data: lead, error } = await sb.from('leads').insert({
    full_name: input.full_name?.trim() || `${PRETTY[input.source] || 'New'} Lead`,
    email, phone,
    source: input.source,
    status: 'new',
    course_interest: input.course_interest || null,
    city: input.city || null,
    education_level: input.education_level || null,
    utm_source: input.utm_source || input.source,
    utm_medium: input.utm_medium || null,
    utm_campaign: input.utm_campaign || null,
    utm_content: input.utm_content || null,
    landing_source: input.landing_source || PRETTY[input.source] || input.source,
    raw_payload: input.raw_payload || null,
    ...(input.extra || {}),
  }).select().single()

  if (error || !lead) {
    console.error('[intakeLead] insert failed', error)
    return { leadId: null, assignedTo: null, duplicate: false }
  }

  // 3) Auto-assign (fires AI opening message + nurture sequence inside)
  let assignedTo: string | null = null
  try { assignedTo = await autoAssignLead(lead.id, input.preferredMarketerId, input.source) } catch (e) { console.error('[intakeLead] assign failed', e) }

  // 4) Notify project managers
  try {
    const { data: pms } = await sb.from('profiles').select('id, phone, full_name').eq('role', 'project_manager').eq('is_active', true)
    const { count: unassigned } = await sb.from('leads').select('id', { count: 'exact', head: true }).is('assigned_to', null)
    const srcLabel = PRETTY[input.source] || input.source
    for (const pm of pms || []) {
      await sb.from('notifications').insert({
        user_id: pm.id, type: 'lead',
        title: `New lead from ${srcLabel}`,
        body: `${lead.full_name} came in from ${srcLabel}.`,
        data: { lead_id: lead.id, source: input.source },
      }).then(() => {}, () => {})
      // Queued rather than sent inline: a slow SMS provider must not hold up
      // lead creation, and a failed text must never cost us the lead. The
      // dedupe key means a retried webhook cannot text the same PM twice
      // about the same lead.
      if (pm.phone) {
        await queueSMS({
          to: pm.phone,
          message: SMS.newLeadToPM(lead.full_name, srcLabel, unassigned || 1),
          kind: 'new_lead_pm',
          entityId: lead.id,
          dedupeKey: `new_lead_pm:${lead.id}:${pm.id}`,
        })
      }
    }
  } catch (e) { console.error('[intakeLead] notify failed', e) }

  return { leadId: lead.id, assignedTo, duplicate: false }
}
