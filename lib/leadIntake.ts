import { createServiceClient } from '@/lib/supabase/server'
import { autoAssignLead } from '@/lib/autoAssign'
import { sendSMS, SMS } from '@/lib/integrations/sms'

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
  raw_payload?: any
  extra?: Record<string, any>    // source-specific columns (e.g. fb_lead_id)
}

function normalizePhone(p?: string | null): string | null {
  if (!p) return null
  let d = p.replace(/[^\d]/g, '')
  if (d.startsWith('0')) d = '233' + d.slice(1)
  if (d.startsWith('233')) return d
  if (d.length === 9) return '233' + d
  return d || null
}

const PRETTY: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', google: 'Google',
  linkedin: 'LinkedIn', tiktok: 'TikTok', website: 'Website', whatsapp: 'WhatsApp',
}

export async function intakeLead(input: IncomingLead): Promise<{ leadId: string | null; assignedTo: string | null; duplicate: boolean }> {
  const sb = createServiceClient()
  const phone = normalizePhone(input.phone)
  const email = input.email?.trim().toLowerCase() || null

  // 1) De-dupe: same phone or email in the last 60 days → don't create twice
  if (phone || email) {
    const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString()
    let q = sb.from('leads').select('id, assigned_to').gte('created_at', since)
    if (phone && email) q = q.or(`phone.eq.${phone},email.eq.${email}`)
    else if (phone) q = q.eq('phone', phone)
    else if (email) q = q.eq('email', email)
    const { data: existing } = await q.limit(1).maybeSingle()
    if (existing) return { leadId: existing.id, assignedTo: existing.assigned_to || null, duplicate: true }
  }

  // 2) Create the lead with full attribution
  const { data: lead, error } = await sb.from('leads').insert({
    full_name: input.full_name?.trim() || `${PRETTY[input.source] || 'New'} Lead`,
    email, phone,
    source: input.source,
    status: 'new',
    course_interest: input.course_interest || null,
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
  try { assignedTo = await autoAssignLead(lead.id) } catch (e) { console.error('[intakeLead] assign failed', e) }

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
      if (pm.phone) { try { await sendSMS(pm.phone, SMS.newLeadToPM(lead.full_name, srcLabel, unassigned || 1)) } catch {} }
    }
  } catch (e) { console.error('[intakeLead] notify failed', e) }

  return { leadId: lead.id, assignedTo, duplicate: false }
}
