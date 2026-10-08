import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { buildLeadContext, actionsFor, renderActions } from '@/lib/chatbot'

/**
 * Cron runner — sends all due drip-sequence messages.
 * Call on a schedule (e.g. every 15 min) via Vercel Cron or an external
 * cron hitting /api/sequences/run?key=SETUP_SECRET.
 *
 * For each active enrollment whose next_run_at has passed, it sends the
 * current step's message (personalised, in the marketer's voice/line),
 * advances to the next step, and schedules it — or completes the
 * enrollment when steps run out.
 */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createServiceClient()
  const now = new Date().toISOString()

  // Due, active enrollments
  const { data: due } = await sb.from('sequence_enrollments')
    .select('*, lead:lead_id(id, full_name, phone, status, assigned_to)')
    .eq('status', 'active')
    .lte('next_run_at', now)
    .limit(50)

  let sent = 0, completed = 0, stopped = 0

  for (const enr of due || []) {
    const lead = (enr as any).lead
    // Stop if the lead has converted or gone cold-closed
    if (!lead || ['registered', 'lost', 'not_interested'].includes(lead.status)) {
      await sb.from('sequence_enrollments').update({ status: 'stopped' }).eq('id', enr.id)
      stopped++; continue
    }

    // Get the step to send
    const { data: steps } = await sb.from('sequence_steps')
      .select('*').eq('sequence_id', enr.sequence_id).order('step_order', { ascending: true })
    const step = (steps || [])[enr.current_step]

    if (!step) {
      await sb.from('sequence_enrollments').update({ status: 'completed' }).eq('id', enr.id)
      completed++; continue
    }

    // Personalise
    const first = (lead.full_name || '').split(' ')[0] || 'there'
    const msg = (step.message || '').replace(/\{name\}/gi, first).replace(/\{firstName\}/gi, first)

    if (lead.phone) {
      if (step.channel === 'sms') {
        // No menu on SMS. Every option costs characters, and an SMS cannot be
        // replied to through the WhatsApp line that would resolve the answer.
        await sendSMS(lead.phone, msg).catch(() => {})
      } else {
        /*
         * A nurture message ends with what to do next.
         *
         * This is the sequence in Isaac's drawing: a message, then a numbered
         * menu, and the option taken drops off the next one. Every piece of
         * that already existed for inbound replies and nothing used it here,
         * so a drip message arrived with no way to act on it.
         *
         * actionsFor is deterministic given the capability, the stage and
         * what has been taken — the same three facts the webhook recomputes
         * when a reply arrives. So the menu sent here and the menu the reply
         * is matched against are the same list, and neither has to be stored.
         *
         * A failure to build the context must not cost the lead the message
         * they were due: the menu is an addition to it, not a condition of it.
         */
        let menu = ''
        try {
          const ctx = await buildLeadContext({ lead, latestMessage: null })
          menu = renderActions(actionsFor({
            capability: ctx.capability,
            stage: ctx.state.stage,
            taken: ctx.state.taken,
            humanName: ctx.marketerName,
          }))
        } catch (e: unknown) {
          console.error('[sequences] no menu for lead', lead.id,
            e instanceof Error ? e.message : String(e))
        }
        await sendWhatsAppText(lead.phone, msg + menu, lead.assigned_to || undefined).catch(() => {})
      }
      // Log
      await sb.from('lead_activities').insert({
        lead_id: lead.id, activity_type: step.channel === 'sms' ? 'sms' : 'whatsapp',
        subject: 'Automated follow-up', description: msg.slice(0, 200),
      }).then(() => {}, () => {})
      sent++
    }

    // Advance
    const nextIdx = enr.current_step + 1
    const nextStep = (steps || [])[nextIdx]
    if (nextStep) {
      const nextRun = new Date(Date.now() + (nextStep.delay_hours || 24) * 3600000).toISOString()
      await sb.from('sequence_enrollments').update({ current_step: nextIdx, next_run_at: nextRun }).eq('id', enr.id)
    } else {
      await sb.from('sequence_enrollments').update({ current_step: nextIdx, status: 'completed' }).eq('id', enr.id)
      completed++
    }
  }

  return NextResponse.json({ ok: true, sent, completed, stopped, processed: (due || []).length })
}
