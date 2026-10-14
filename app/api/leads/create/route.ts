import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { validateRow, phoneVariants, resolveSource } from '@/lib/leads/importValidation'
import { isEligible } from '@/lib/leads/eligibility'
import { autoAssignLead, onLeadAssigned } from '@/lib/autoAssign'
import { recordAudit } from '@/lib/audit'
import { decideOwner, entersLeadsForTheCompany } from '@/lib/leads/ownership'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * Add ONE lead by hand.
 *
 * ── WHY THIS ROUTE EXISTS ──────────────────────────────────────────────────
 *
 * Staff get leads two ways: the system distributes them, or they go out and
 * find someone themselves and type them in. The second had been broken since
 * the "Add lead" screen was rewired to post to /api/leads/import, which is
 * the BULK route and is guarded by
 *
 *     withGuard({ portals: ['leads', 'pm_leads'] })
 *
 * A marketing officer holds neither. Their portals are `my_leads` and
 * friends, so every marketer, trainer, content manager and exam coordinator
 * who filled in that form got 403 "You do not have access to this." — for a
 * lead they had sourced themselves. Before the rewiring the page posted to
 * /api/data, which marketers may write, so this is a regression rather than
 * a feature that never worked.
 *
 * Widening the import route was the wrong fix. It accepts two hundred rows
 * and a client-supplied `assigned_to` per row, and it is reachable by people
 * who distribute leads on behalf of others. Handing that to everyone with
 * `my_leads` would let any marketer bulk-create leads owned by anybody. So
 * manual entry gets its own route: one lead, and an owner the caller does not
 * choose.
 *
 * ── ATTRIBUTION ────────────────────────────────────────────────────────────
 *
 * The owner is the authenticated session, resolved here. The old form sent
 * `assigned_to: myId` read from /api/auth/me — a value the browser supplies
 * and can therefore change. It is ignored.
 *
 * A distributor (`leads` / `pm_leads`) may name someone else, because entering
 * a lead on a colleague's behalf is part of that job — and if they name
 * nobody, the lead goes to the weighted lottery like any distributed one,
 * which is what the admin Add-lead screen has always meant by leaving the
 * marketer blank. Anyone else gets themselves, whatever they send.
 *
 * ── AND WHY IT SHARES THE INTAKE PIPELINE ──────────────────────────────────
 *
 * Same validation, same phone canonicalisation, same duplicate rule and the
 * same onLeadAssigned as a distributed lead, so a manually entered lead is
 * notified, nurtured and counted exactly like any other. There is one lead
 * model, not two.
 */

const Body = z.object({
  full_name: z.string().trim().min(1, 'A name is required.').max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  gender: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(120).optional().nullable(),
  course_interest: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  source: z.string().trim().max(40).optional().nullable(),
  /** Honoured only for a caller who may name another owner; ignored for everyone else. */
  assigned_to: z.string().uuid().optional().nullable(),
  /** A super admin or PM keeping this one rather than sending it to the centre. */
  keep_for_self: z.boolean().optional(),
  /** Anyone who may delegate, deliberately sending this one to distribution. */
  to_pool: z.boolean().optional(),
  /** Set when the operator has already been shown the duplicate and chose to continue. */
  allowDuplicate: z.boolean().optional(),
})

export const POST = withGuard(
  { portals: ['my_leads', 'leads', 'pm_leads'] },
  async (req: NextRequest, { session, portals }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'That lead could not be read.' },
        { status: 400 },
      )
    }
    const body = parsed.data

    // Same rule as an imported row: a name, and at least one way to reach them.
    const check = validateRow(body)
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 })
    }
    const { name, phone, email } = check

    /*
     * Attribution, decided by the ROLE and not by the browser — and not by
     * the portal, which is what used to decide it and is why an accountant,
     * an admissions officer and anyone granted `leads` individually lost
     * their own leads to the lottery. See lib/leads/ownership.
     *
     * `null` means the company pool, resolved after the row exists, because
     * the lottery assigns an existing lead.
     */
    const decision = decideOwner({
      actorId: session.userId,
      role: session.role,
      portals,
      requestedOwner: body.assigned_to ?? null,
      keepForSelf: body.keep_for_self === true,
      toPool: body.to_pool === true,
    })
    const owner = decision.owner

    if (owner && owner !== session.userId && !await isEligible(owner)) {
      return NextResponse.json(
        { error: 'That person cannot receive leads. Give them the Leads access first, or choose someone else.' },
        { status: 400 },
      )
    }

    const sb = createServiceClient()

    // ── duplicate ──
    // Reported, not silently merged: the same person entered twice by two
    // marketers is a commission dispute, so the operator decides.
    if (!body.allowDuplicate) {
      let existing: { id: string; full_name: string } | null = null
      const variants = phoneVariants(phone)
      if (variants.length) {
        const { data } = await sb.from('leads').select('id, full_name').in('phone', variants).limit(1).maybeSingle()
        existing = data ?? null
      }
      if (!existing && email) {
        const { data } = await sb.from('leads').select('id, full_name').eq('email', email).limit(1).maybeSingle()
        existing = data ?? null
      }
      if (existing) {
        return NextResponse.json(
          { error: `${existing.full_name} is already in the system with this phone or email.`, duplicate: true, leadId: existing.id },
          { status: 409 },
        )
      }
    }

    // ── insert ──
    // gender and notes are written. The import pipeline drops both, so
    // everything the operator typed into those two fields had been discarded
    // silently since the form was rewired through it.
    const { data: lead, error } = await sb.from('leads').insert({
      full_name: name,
      phone,
      email,
      gender: body.gender || null,
      city: body.city || null,
      country: body.country || null,
      course_interest: body.course_interest || null,
      notes: body.notes || null,
      source: resolveSource(body.source || 'manual'),
      status: 'new',
      landing_source: 'Added manually',
      assigned_to: owner,
      /*
       * Who put this lead into the system, recorded even when it goes to the
       * centre's pool. There is no created_by column on leads, and without
       * this a company lead carried no trace of who entered it until the
       * lottery placed it.
       */
      assigned_by: session.userId,
      assigned_at: owner ? new Date().toISOString() : null,
    }).select('id').single()

    if (error || !lead) {
      console.error('[leads/create] insert failed:', error?.message)
      return NextResponse.json(
        { error: 'This lead could not be saved. Please try again.' },
        { status: 500 },
      )
    }

    await recordAudit({
      actorId: session.userId,
      action: 'lead.created_manually',
      resource: 'leads',
      resourceId: lead.id,
      success: true,
      metadata: {
        assignedTo: owner, onBehalf: Boolean(owner) && owner !== session.userId,
        forTheCompany: owner === null, role: session.role, because: decision.because,
      },
      request: req,
    })

    /*
     * The same follow-through a distributed lead gets: the in-app
     * notification, the pending-SMS counter, and nurture enrolment.
     *
     * When nobody was named, autoAssignLead runs the same weighted lottery
     * the distributor uses and calls onLeadAssigned itself — so a lead added
     * from the admin screen with the marketer left blank behaves exactly like
     * one that arrived from a webhook, which is what that screen has always
     * intended.
     */
    let assignedTo = owner
    if (assignedTo) {
      await onLeadAssigned(lead.id, assignedTo)
    } else {
      assignedTo = await autoAssignLead(lead.id, null, 'manual')
    }

    await sb.from('lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'assignment',
      subject: 'Lead added manually',
      description: owner === null && !assignedTo
        ? `${decision.because} Nobody was available to take it yet.`
        : decision.because,
      created_by: session.userId,
    }).then(() => {}, () => {})

    return NextResponse.json({ success: true, leadId: lead.id, assigned: !!assignedTo })
  },
)
