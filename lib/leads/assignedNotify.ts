import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { queueSMS } from '@/lib/notifications/sms'
import { SMS } from '@/lib/integrations/sms'
import { sendEmail } from '@/lib/integrations/email'
import { publicUrl } from '@/lib/url'
import { BRAND } from '@/lib/brand'

/**
 * TELLING SOMEBODY A LEAD IS THEIRS.
 *
 * ── THE BOUNDARY THIS ENFORCES ─────────────────────────────────────────────
 *
 * The lead is already assigned and committed by the time anything here runs.
 * Three channels are attempted — in-app, SMS, email — and each one succeeds or
 * fails on its own. None of them can fail the assignment, none can fail
 * another, and a lead never disappears because a message did not go.
 *
 * Every outcome is returned rather than swallowed, so an administrator can be
 * told which channel failed instead of "the lead never arrived".
 *
 * ── WHY SMS IS SENT PER LEAD NOW ───────────────────────────────────────────
 *
 * It used to increment a counter that a cron read later and turned into one
 * consolidated text per marketer. That is a good idea for volume and a bad
 * one for urgency: on this hosting plan the schedule is daily, so a marketer
 * learned about Tuesday's lead on Wednesday. The owner's requirement is that
 * the text goes the moment the lead lands, so the send is immediate and the
 * dedupe key — one per lead, per marketer — is what stops a retried webhook
 * texting twice about the same lead.
 *
 * The queue still does the sending, so a slow provider does not sit on the
 * request and a failure is retried by the existing machinery.
 */

export type ChannelOutcome = 'sent' | 'queued' | 'skipped' | 'failed'

export type NotifyOutcome = {
  inApp: ChannelOutcome
  sms: ChannelOutcome
  email: ChannelOutcome
  /** Why a channel did not go, for the administrator, never for the lead. */
  detail: Record<string, string>
}

export async function notifyLeadAssigned(
  leadId: string, marketerId: string,
): Promise<NotifyOutcome> {
  const sb = createServiceClient()
  const out: NotifyOutcome = {
    inApp: 'skipped', sms: 'skipped', email: 'skipped', detail: {},
  }

  const [{ data: lead }, { data: marketer }] = await Promise.all([
    sb.from('leads')
      .select('full_name, phone, source, course_interest, created_at')
      .eq('id', leadId).maybeSingle(),
    sb.from('profiles')
      .select('full_name, phone, email, is_active')
      .eq('id', marketerId).maybeSingle(),
  ])

  if (!marketer) {
    out.detail.all = 'The assigned person could not be read.'
    return out
  }

  /*
   * Somebody deactivated between being chosen and being told. The lead keeps
   * its owner — history is never rewritten by a notification — but there is
   * no point messaging a person who cannot sign in.
   */
  if (marketer.is_active === false) {
    out.detail.all = 'That person is no longer active, so they were not notified.'
    return out
  }

  const leadName = lead?.full_name || 'A new lead'
  const firstName = String(marketer.full_name || '').split(' ')[0] || 'there'
  const leadLink = publicUrl(`/marketer/leads/${leadId}`)

  /* ── 1. In app ─────────────────────────────────────────────────────────── */
  {
    const { error } = await sb.from('notifications').insert({
      user_id: marketerId,
      type: 'lead',
      title: 'New lead assigned to you',
      body: `${leadName}${lead?.source ? ` (${lead.source})` : ''} was assigned to you. Reach out soon.`,
      link: `/marketer/leads/${leadId}`,
    })
    if (error) {
      out.inApp = 'failed'
      out.detail.inApp = error.message
      console.error('[leadAssigned] in-app notification failed for', leadId, error.message)
    } else {
      out.inApp = 'sent'
    }
  }

  /* ── 2. SMS ────────────────────────────────────────────────────────────── */
  if (!marketer.phone) {
    out.detail.sms = 'No phone number on their staff record.'
  } else {
    try {
      const res = await queueSMS({
        to: marketer.phone,
        message: SMS.leadAssignedToMarketer(firstName, leadName),
        kind: 'lead_assigned',
        entityId: leadId,
        // One text per lead per person, however many times this runs.
        dedupeKey: `lead_assigned:${leadId}:${marketerId}`,
      })
      if (res.sent) out.sms = 'sent'
      else if (res.queued) out.sms = 'queued'
      else if (res.duplicate) { out.sms = 'skipped'; out.detail.sms = 'Already sent for this lead.' }
      else {
        out.sms = 'failed'
        out.detail.sms = 'The number is not a valid Ghanaian mobile.'
      }
    } catch (e) {
      out.sms = 'failed'
      out.detail.sms = e instanceof Error ? e.message : 'Could not queue the text.'
      console.error('[leadAssigned] SMS failed for', leadId, e)
    }
  }

  /* ── 3. Email ──────────────────────────────────────────────────────────── */
  const email = String(marketer.email || '').trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    out.detail.email = 'No usable email address on their staff record.'
  } else {
    try {
      const ok = await sendEmail(
        email,
        `New lead assigned: ${leadName}`,
        leadAssignedHtml({
          firstName, leadName,
          phone: lead?.phone || null,
          course: lead?.course_interest || null,
          source: lead?.source || null,
          link: leadLink,
        }),
        leadAssignedText({ firstName, leadName, phone: lead?.phone || null, link: leadLink }),
      )
      /*
       * `sent` means the provider accepted it. It is not a delivery
       * confirmation and is deliberately not described as one.
       */
      out.email = ok ? 'sent' : 'failed'
      if (!ok) out.detail.email = 'The mail provider did not accept the message.'
    } catch (e) {
      out.email = 'failed'
      out.detail.email = e instanceof Error ? e.message : 'Could not send the email.'
      console.error('[leadAssigned] email failed for', leadId, e)
    }
  }

  /*
   * A channel that failed is recorded against the lead, so "I never heard
   * about this one" has an answer on the lead itself rather than only in a
   * server log nobody can open.
   */
  const failed = (['inApp', 'sms', 'email'] as const).filter(k => out[k] === 'failed')
  if (failed.length) {
    await sb.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'note',
      subject: 'Assignment notification failed',
      description: `Assigned successfully, but ${failed.join(' and ')} notification did not go: `
        + failed.map(k => out.detail[k] || 'no reason recorded').join(' | '),
      created_by: marketerId,
    }).then(() => {}, () => { /* the note is the least important thing here */ })
  }

  return out
}

/** Plain text, for clients that will not render the HTML. */
function leadAssignedText(o: {
  firstName: string; leadName: string; phone: string | null; link: string
}): string {
  return [
    `Hi ${o.firstName},`,
    ``,
    `A new lead has been assigned to you: ${o.leadName}${o.phone ? ` (${o.phone})` : ''}.`,
    ``,
    `Open it here: ${o.link}`,
    ``,
    `— ${BRAND.name}`,
  ].join('\n')
}

/**
 * The email itself.
 *
 * Only what the person needs to act: who, their number, what they asked
 * about, and a way in. Nothing about other leads, nothing about money, and no
 * identifiers that mean anything outside the portal.
 */
function leadAssignedHtml(o: {
  firstName: string
  leadName: string
  phone: string | null
  course: string | null
  source: string | null
  link: string
}): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#8C9A94;width:110px">${escapeHtml(label)}</td>
      <td style="padding:8px 0;font-size:14px;color:#10231C;font-weight:600">${escapeHtml(value)}</td>
    </tr>`

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#8C9A94;font-weight:600;margin-bottom:24px">${escapeHtml(BRAND.name)}</div>
    <h1 style="font-size:20px;font-weight:600;margin:0 0 8px;color:#10231C">New lead assigned to you</h1>
    <p style="font-size:14px;color:#5A6B64;line-height:1.6;margin:0 0 20px">Hi ${escapeHtml(o.firstName)}, this one is yours. Reaching out early makes the difference.</p>
    <table style="width:100%;border-collapse:collapse;background:#F6F8F7;border-radius:14px;padding:4px 16px;margin-bottom:24px">
      ${row('Name', o.leadName)}
      ${o.phone ? row('Phone', o.phone) : ''}
      ${o.course ? row('Interested in', o.course) : ''}
      ${o.source ? row('Came from', o.source) : ''}
    </table>
    <a href="${escapeHtml(o.link)}" style="display:inline-block;background:#10231C;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;border-radius:12px">Open this lead</a>
    <p style="font-size:12px;color:#8C9A94;line-height:1.6;margin:24px 0 0">You are receiving this because the lead was assigned to you in the ${escapeHtml(BRAND.shortName)} portal.</p>
  </div>`
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
