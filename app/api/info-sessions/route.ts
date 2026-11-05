import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { saveFailed, lookup, unavailable } from '@/lib/db/lookup'
import { enrolRecipients, triggerNextHop } from '@/lib/infoSessionCampaign'
import { columnExists } from '@/lib/db/hasColumn'
import { resolveAudience } from '@/lib/leads/audienceQuery'
import { describeFilter, type AudienceFilter } from '@/lib/leads/audienceFilter'
import { campaignProgress } from '@/lib/infoSessionCampaign'
import { COMPANY_LEAD_ROLES } from '@/lib/leads/ownership'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Info sessions — the Information section.
 *
 * ── WHY THIS IS GUARDED BY A PORTAL AND NOT A ROLE LIST ────────────────────
 *
 * It was `ALLOWED = ['super_admin', 'project_manager']`, checked by role, and
 * that is the whole reason the Admissions team reported that nothing sends.
 *
 * Three other layers already say who may be here, and all three agree with
 * each other and disagreed with this one:
 *
 *   lib/access/portals.ts   grants the PAGE /pm/info-sessions to grp_automation
 *   lib/access/apiAccess.ts grants THIS PATH to grp_automation
 *   the sidebar             shows "Automation → Info sessions" for it
 *
 * So an admissions officer granted that portal saw the section, opened it,
 * filled it in, chose SMS, pressed send — and got 401. The list came back
 * empty for the same reason, so the section also looked like it had never
 * been used. The only visible symptom was a toast reading "unauth".
 *
 * Guarded by the portal now, which is the same answer the other three give.
 * A grant means something or it does not.
 */

const PORTALS = ['grp_automation']

/**
 * Who may resume or delete a campaign.
 *
 * Seeing the section is a portal; stopping, restarting or removing a campaign
 * that has messaged hundreds of people is a different question, and it is the
 * same list that decides who owns leads for the company.
 */
const MAY_MANAGE: readonly string[] = COMPANY_LEAD_ROLES

/**
 * Begin a campaign and hand it to the worker.
 *
 * Returns as soon as the audience is enrolled and the first hop is away. The
 * count it reports is how many people are IN the campaign, which is a fact;
 * how many have been reached is a question the progress endpoint answers
 * while it runs.
 */
async function startCampaign(session: {
  id: string; audience?: string | null; title?: string | null
  audience_filter?: AudienceFilter | null
}) {
  const enrolled = await enrolRecipients(
    session.id, session.audience || 'all_leads', session.audience_filter || null,
  )
  if (typeof enrolled !== 'number') {
    return NextResponse.json({
      session, started: false,
      error: `${enrolled.error} The session is saved, so you can start it from the list.`,
    })
  }

  const sb = createServiceClient()
  await sb.from('info_sessions').update({ status: 'sending' })
    .eq('id', session.id).in('status', ['scheduled', 'sending'])

  /*
   * Not awaited to completion on purpose: this request's job is to START the
   * campaign, and the hop it fires runs as its own invocation. Waiting would
   * tie the operator's click to the whole campaign again.
   */
  await triggerNextHop(session.id, 0)

  return NextResponse.json({
    session, started: true, success: true,
    recipients: enrolled,
    message: `Sending to ${enrolled} lead${enrolled === 1 ? '' : 's'}. It continues on its own — you can leave this page.`,
  })
}

export const GET = withGuard({ portals: PORTALS }, async () => {
  const sb = createServiceClient()
  const { row: sessions, failed } = await lookup(
    /*
     * Archived campaigns are kept, not shown. A campaign that has messaged
     * people has a history that is not the operator's to erase — putting it
     * away takes it out of this list and leaves its recipients, its message
     * and its delivery record exactly where they are.
     */
    sb.from('info_sessions').select('*').neq('status', 'archived')
      .order('scheduled_at', { ascending: false }).limit(50),
  )
  // An empty list because the read failed is not an empty list.
  if (failed) return unavailable('[info-sessions]', failed, 'the information sessions')
  return NextResponse.json({ sessions: sessions || [] })
})

export const POST = withGuard({ portals: PORTALS }, async (req: NextRequest, { session }) => {
  const { title, link, description, scheduled_at, notify_at, audience, channels, send_now, message, filter } =
    await req.json()

  /*
   * ── SENDING IT THE MOMENT IT IS CREATED ──────────────────────────────────
   *
   * Scheduling was the only way in: fill the form, choose a time for it to
   * auto-send, save, and then find the row and press Send. For an invitation
   * that is going out now anyway, that is three steps and a decision nobody
   * wanted to make — and the auto-send time was REQUIRED, so somebody sending
   * immediately still had to invent one.
   *
   * With send_now the send time is now, because that is what it means.
   */
  const sendNow = send_now === true
  const notifyAt = sendNow ? new Date().toISOString() : notify_at

  if (!title?.trim() || !link?.trim() || !scheduled_at) {
    return NextResponse.json({ error: 'Title, link and the session time are required.' }, { status: 400 })
  }

  /*
   * ── THE MESSAGE IS THE AUTHOR'S, AND IT IS REQUIRED ──────────────────────
   *
   * The invitation text used to live in the code: every campaign said the
   * same sentence and nobody could change a word of it. It is written here
   * now, and an empty one is refused rather than quietly replaced with a
   * default — sending words nobody wrote is the behaviour being removed.
   */
  const text = String(message ?? '').trim()
  if (!text) {
    return NextResponse.json(
      { error: 'Write the message you want to send. There is no default.' }, { status: 400 })
  }

  /*
   * And it has to be storable. Without the column the campaign would send the
   * text that used to be hardcoded — which is not what the author wrote, and
   * worse than refusing.
   */
  if (!(await columnExists('info_sessions', 'message'))) {
    return NextResponse.json({
      error: 'This deployment has not run migration 0030, so your message cannot be saved. '
        + 'Nothing was created.',
    }, { status: 503 })
  }
  if (!notifyAt) {
    return NextResponse.json(
      { error: 'Choose when it should auto-send, or send it now.' }, { status: 400 })
  }

  /*
   * A session with no channel can never be sent, and the form lets every
   * channel be switched off. Refused here rather than saved as something
   * that will sit scheduled for ever and send nothing.
   */
  const picked = String(channels || '').split(',').map(c => c.trim()).filter(Boolean)
  if (!picked.length) {
    return NextResponse.json(
      { error: 'Choose at least one way to send it — SMS, WhatsApp or email.' }, { status: 400 })
  }

  /*
   * The audience is resolved NOW and its criteria kept with the campaign.
   *
   * A lead edited next week must not change who this campaign was for, and
   * the history has to be able to say what was asked for — not only who
   * answered. The counts are recorded at the same moment for the same reason.
   */
  const audienceFilter = (filter || {}) as AudienceFilter
  const resolved = await resolveAudience(audienceFilter)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 503 })
  }
  if (!resolved.sendable.length) {
    return NextResponse.json({
      error: resolved.matching
        ? `${resolved.matching} lead${resolved.matching === 1 ? '' : 's'} match, but none of them has a usable phone number.`
        : 'No leads match that selection.',
    }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data, error } = await sb.from('info_sessions').insert({
    title: title.trim(), link: link.trim(), description: description?.trim() || null,
    scheduled_at, notify_at: notifyAt,
    audience: audience || 'all_leads',
    channels: picked.join(','),
    created_by: session.userId,
    message: text,
    audience_filter: audienceFilter,
    audience_summary: {
      matching: resolved.matching,
      sendable: resolved.sendable.length,
      excluded: resolved.excluded.length,
      conditions: describeFilter(audienceFilter),
      resolvedAt: new Date().toISOString(),
    },
  }).select().single()
  if (error) return saveFailed('[info-sessions]', error.message, 'that session')

  if (!sendNow) return NextResponse.json({ session: data })

  /*
   * Saved first, then started. The row exists before anything goes out, so a
   * campaign interrupted at any point is continued rather than lost.
   *
   * This REQUEST does not send the campaign. It enrols the audience, marks
   * the session as sending, and starts the first hop — which starts the
   * next, and so on until the ledger says everybody has been dealt with.
   * Sending inside this request is what used to cap a campaign at whatever
   * fitted in one serverless invocation.
   */
  return startCampaign(data)
})

export const PATCH = withGuard({ portals: PORTALS }, async (req: NextRequest, { session }) => {
  const { id, action } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const sb = createServiceClient()

  if (action === 'cancel') {
    /*
     * A campaign already sending can be stopped too. The worker reads the
     * status before each batch, so this stops the NEXT batch — what has gone
     * has gone, and saying otherwise would be a lie.
     */
    await sb.from('info_sessions').update({ status: 'cancelled' })
      .eq('id', id).in('status', ['scheduled', 'sending'])
    await recordAudit({
      actorId: session.userId, action: 'info_session.cancelled',
      resource: 'info_sessions', resourceId: id, success: true, request: req,
    })
    return NextResponse.json({ success: true })
  }

  /*
   * ── RESUMING ONE THAT WAS STOPPED ────────────────────────────────────────
   *
   * PMP INFORMATION SESSION was cancelled half way because the SMS credits
   * ran out: 105 of 642 reached. Without this the only way to finish it was
   * to create it again, which would have messaged those 105 a second time.
   *
   * Nothing is re-enrolled and no audience is re-resolved. The ledger already
   * holds who was selected and who has been reached, so resuming is a change
   * of status and a nudge to the worker — which then claims only the rows
   * still pending. The original message and the original audience are
   * untouched by construction rather than by care.
   */
  if (action === 'resume') {
    if (!MAY_MANAGE.includes(String(session.role))) {
      return NextResponse.json(
        { error: 'Only an administrator or project manager can resume a campaign.' }, { status: 403 })
    }

    const { row: s, failed } = await lookup(
      sb.from('info_sessions').select('*').eq('id', id).maybeSingle(),
    )
    if (failed) return unavailable('[info-sessions]', failed, 'that campaign')
    if (!s) return NextResponse.json({ error: 'That campaign no longer exists.' }, { status: 404 })
    if (s.status !== 'cancelled') {
      return NextResponse.json(
        { error: `This campaign is ${s.status}, not cancelled, so there is nothing to resume.` },
        { status: 400 })
    }

    const { error: updateErr } = await sb.from('info_sessions')
      .update({ status: 'sending' })
      .eq('id', id).eq('status', 'cancelled')   // nobody else resumed it first
    if (updateErr) return saveFailed('[info-sessions]', updateErr.message, 'that campaign')

    await recordAudit({
      actorId: session.userId, action: 'info_session.resumed',
      resource: 'info_sessions', resourceId: id, success: true, request: req,
      metadata: { title: s.title },
    })

    await triggerNextHop(id, 0)
    return NextResponse.json({
      success: true, started: true,
      message: 'Sending has started again. Anybody already reached is skipped.',
    })
  }

  /*
   * ── PUTTING ONE AWAY ─────────────────────────────────────────────────────
   *
   * A campaign that has messaged people is ARCHIVED: it leaves the list and
   * keeps its recipients, its message and its delivery record, because that
   * is evidence of what was sent to whom and it is not the operator's to
   * erase. One that never sent anything is deleted outright — its recipient
   * rows go with it through the foreign key, and the LEADS do not: they are a
   * different table and the campaign never owned them.
   */
  if (action === 'delete') {
    if (!MAY_MANAGE.includes(String(session.role))) {
      return NextResponse.json(
        { error: 'Only an administrator or project manager can delete a campaign.' }, { status: 403 })
    }

    const progress = await campaignProgress(id)
    const everSent = !('error' in progress) && progress.sent > 0

    if (everSent) {
      const { error: archiveErr } = await sb.from('info_sessions')
        .update({ status: 'archived' }).eq('id', id)
      if (archiveErr) return saveFailed('[info-sessions]', archiveErr.message, 'that campaign')
      await recordAudit({
        actorId: session.userId, action: 'info_session.archived',
        resource: 'info_sessions', resourceId: id, success: true, request: req,
        metadata: { reason: 'messages had already been sent', sent: progress.sent },
      })
      return NextResponse.json({
        success: true, archived: true,
        message: `Removed from the list. The record of the ${progress.sent} message`
          + `${progress.sent === 1 ? '' : 's'} already sent is kept.`,
      })
    }

    const { error: deleteErr } = await sb.from('info_sessions').delete().eq('id', id)
    if (deleteErr) return saveFailed('[info-sessions]', deleteErr.message, 'that campaign')
    await recordAudit({
      actorId: session.userId, action: 'info_session.deleted',
      resource: 'info_sessions', resourceId: id, success: true, request: req,
      metadata: { reason: 'nothing had been sent' },
    })
    return NextResponse.json({
      success: true, deleted: true, message: 'Campaign deleted. Nothing had been sent.',
    })
  }

  if (action === 'send_now') {
    const { row: s, failed } = await lookup(
      sb.from('info_sessions').select('*').eq('id', id).maybeSingle(),
    )
    if (failed) return unavailable('[info-sessions]', failed, 'that session')
    if (!s) return NextResponse.json({ error: 'That session no longer exists.' }, { status: 404 })
    // The same start the create-and-send path uses, so one behaviour.
    return startCampaign(s)
  }

  return NextResponse.json({ success: true })
})

/*
 * Sending reaches out to every targeted lead. The platform default is ten to
 * fifteen seconds, which a few dozen recipients exceed — and a request killed
 * half way through has sent some of them.
 */
export const maxDuration = 60
