import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { autoAssignLead } from '@/lib/autoAssign'
import { recordAudit } from '@/lib/audit'
import { LEAD_SOURCES, canonicalPhone, phoneVariants } from '@/lib/leads/importValidation'

/**
 * Make sure a submitted registration is visible in the pipeline.
 *
 * ── The bug this fixes ─────────────────────────────────────────────────────
 *
 * `applications/submit` created the application row and nothing else. The lead
 * was created and linked in `applications/complete`, which only runs AFTER
 * payment succeeds. So an applicant who filled in the registration link but
 * had not yet paid existed as an `applications` row with `lead_id = NULL` —
 * and since every portal view works from `leads`, nobody could see them.
 *
 * In the live database that was 9 of 15 applications: 13 submitted, only 6
 * paid, and 9 carrying no lead at all. That is exactly the reported symptom,
 * "someone clicks the registration link and it never reflects on the portal".
 *
 * A registration is now visible the moment it is submitted, in the
 * `ready_to_join` state, so staff can chase the payment instead of never
 * learning the person applied.
 *
 * ── Deliberately NOT done here ─────────────────────────────────────────────
 *
 * The sales welcome pack and AI opening message are not fired. Those greet a
 * cold lead and ask what they do for work — wrong for somebody already filling
 * in a registration form.
 */

export type LinkResult = {
  leadId: string | null
  created: boolean
  assignedTo: string | null
}

/**
 * leads.source is the `lead_source` enum, not free text:
 *   facebook · google · linkedin · website · referral · manual
 *
 * (walk_in is NOT one of them — the enum has never had it. resolveSource maps
 * a walk-in to manual, which is what it is: entered by hand.)
 *
 * Writing anything else fails the insert outright, so a UTM value is only used
 * when it is genuinely one of those. A registration reached through a
 * marketer's personal link is a referral; anything else is the website.
 */
/*
 * ── WHY THESE COME FROM lib/leads/importValidation ─────────────────────────
 *
 * This file had its own LEAD_SOURCES, phoneVariants and canonicalPhone. The
 * first two matched their originals character for character; the third did
 * not, and the difference mattered.
 *
 * The shared canonicalPhone requires nine digits after the country code —
 * a Ghanaian mobile — and returns null otherwise. The copy here had no length
 * check at all:
 *
 *     return local ? `233${local}` : null
 *
 * so "024123" became "23324123" and a fourteen-digit paste became
 * "23312345678901234". Both are truthy, so both passed the "no phone and no
 * email" guard below and were written into leads.phone as a new lead.
 *
 * The result is a lead nobody can reach. normaliseRecipient rejects the
 * number, so no SMS and no WhatsApp; and the same person enquiring properly
 * later matches nothing, so they are created a second time and the marketer's
 * history splits in two. The import path rejected exactly these rows. Only
 * registrations let them through.
 *
 * resolveSource stays local because it genuinely differs: a registration with
 * no usable UTM is a referral when it came through a marketer's link and the
 * website otherwise, where an imported row falls back to 'manual'. It is
 * built on the shared list so the two cannot disagree about what a source is.
 */

function resolveSource(utm?: string | null, marketerId?: string | null): string {
  const candidate = String(utm || '').trim().toLowerCase()
  if ((LEAD_SOURCES as readonly string[]).includes(candidate)) return candidate
  return marketerId ? 'referral' : 'website'
}

export async function linkApplicationToLead(app: {
  id: string
  full_name?: string | null
  email?: string | null
  phone?: string | null
  course_id?: string | null
  marketer_id?: string | null
  landing_source?: string | null
  utm_source?: string | null
}): Promise<LinkResult> {
  const sb = createServiceClient()
  const phone = canonicalPhone(app.phone)
  const email = app.email?.trim().toLowerCase() || null

  if (!phone && !email) {
    console.warn('[linkLead] application', app.id, 'has neither phone nor email — cannot link')
    return { leadId: null, created: false, assignedTo: null }
  }

  // Find an existing lead first: someone who enquired last month and registers
  // today is the same person, and splitting them loses the marketer's history.
  let leadId: string | null = null
  const variants = phoneVariants(app.phone)

  if (variants.length) {
    const { data } = await sb.from('leads')
      .select('id').in('phone', variants)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    leadId = data?.id ?? null
  }
  if (!leadId && email) {
    const { data } = await sb.from('leads')
      .select('id').eq('email', email)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    leadId = data?.id ?? null
  }

  let created = false

  if (leadId) {
    // Existing lead: move it forward, never backwards. Somebody already marked
    // 'registered' must not be dragged back to 'ready_to_join'.
    const { data: current } = await sb.from('leads').select('status').eq('id', leadId).maybeSingle()
    const settled = ['registered', 'done', 'not_interested', 'lost']
    if (!settled.includes(String(current?.status || ''))) {
      await sb.from('leads').update({ status: 'ready_to_join' }).eq('id', leadId)
    }
  } else {
    const { data: fresh, error } = await sb.from('leads').insert({
      full_name: app.full_name?.trim() || 'Registration',
      phone, email,
      source: resolveSource(app.utm_source, app.marketer_id),
      status: 'ready_to_join',
      landing_source: app.landing_source || 'Registration link',
      course_interest: null,
    }).select('id').single()

    if (error || !fresh) {
      console.error('[linkLead] could not create a lead for application', app.id, error?.message)
      return { leadId: null, created: false, assignedTo: null }
    }
    leadId = fresh.id
    created = true
  }

  // Every branch above either set leadId or returned, but TypeScript cannot
  // see that through the reassignment — state it once here.
  if (!leadId) return { leadId: null, created, assignedTo: null }
  const resolvedLeadId: string = leadId

  // Attach the lead to the application so both directions resolve.
  const { error: linkErr } = await sb.from('applications')
    .update({ lead_id: resolvedLeadId }).eq('id', app.id)
  if (linkErr) {
    console.error('[linkLead] could not attach lead to application', app.id, linkErr.message)
  }

  // Give it an owner so it shows on somebody's list rather than sitting
  // unassigned. A registration that names its marketer goes to them.
  let assignedTo: string | null = null
  try {
    const { data: lead } = await sb.from('leads').select('assigned_to').eq('id', resolvedLeadId).maybeSingle()
    assignedTo = lead?.assigned_to ?? null
    if (!assignedTo) {
      assignedTo = await autoAssignLead(resolvedLeadId, app.marketer_id || null, 'website')
    }
  } catch (e) {
    // An assignment failure must never lose the registration — the lead exists
    // and is visible; it can be assigned by hand.
    console.error('[linkLead] assignment failed for lead', resolvedLeadId, e)
  }

  await recordAudit({
    action: created ? 'registration.lead_created' : 'registration.lead_linked',
    resource: 'applications',
    resourceId: app.id,
    success: true,
    metadata: { leadId: resolvedLeadId, assignedTo },
  })

  return { leadId: resolvedLeadId, created, assignedTo }
}
