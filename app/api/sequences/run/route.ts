import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { CONFIG } from '@/lib/config'

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
  const key = new URL(req.url).searchParams.get('key')
  if (key !== CONFIG.setupSecret) {
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
        await sendSMS(lead.phone, msg).catch(() => {})
      } else {
        await sendWhatsAppText(lead.phone, msg, lead.assigned_to || undefined).catch(() => {})
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
