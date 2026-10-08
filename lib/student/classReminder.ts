import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { createLoginToken } from '@/lib/student/auth'
import { CONFIG } from '@/lib/config'
import { REMINDERS_KEY, remindersEnabled } from '@/lib/payments/reminderPolicy'

/**
 * ~30 minutes before an online class, message each student from THEIR
 * marketer's WhatsApp line: a friendly check-in, the reminder to sign in via
 * the portal, and — if they owe for this session — exactly what to pay.
 * De-duped per student per day via class_reminder_sends.
 */
export async function runClassStartReminders() {
  const sb = createServiceClient()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  /*
   * Does this reminder chase money?
   *
   * This runs every ten minutes and, when a student owes for the session,
   * tells them what to pay. That is a payment reminder arriving on a
   * student's phone, so it answers to the same switch as the rest — which is
   * how fee reminders kept arriving after they were switched off: nothing
   * here consulted it.
   *
   * Switched off, the class reminder STILL GOES. Only the money sentence is
   * dropped: a student who needs to join a class in thirty minutes must get
   * the link whatever has been decided about chasing fees. What they owe
   * remains visible in the portal, where they went to pay anyway.
   *
   * Read once per run, not per student.
   */
  let chaseFees = false
  try {
    const { data, error } = await sb.from('settings')
      .select('value').eq('key', REMINDERS_KEY).maybeSingle()
    if (error) throw new Error(error.message)
    chaseFees = remindersEnabled(data?.value ?? null)
  } catch (e: unknown) {
    const why = e instanceof Error ? e.message : String(e)
    console.error('[classReminder] could not read', REMINDERS_KEY, '— not chasing fees:', why)
    chaseFees = false
  }

  // Online batches with a session starting in the next 20-40 minutes
  const { data: batches } = await sb.from('batches')
    .select('id, name, class_type, next_session_at, end_date, status, free_sessions, min_payment_per_session')
    .eq('status', 'ongoing').limit(200)

  let sent = 0
  for (const b of batches || []) {
    if (!b.next_session_at) continue
    // Don't remind a cohort that has finished
    const endsAt = b.end_date ? new Date(b.end_date) : null
    if (endsAt) endsAt.setHours(23, 59, 59, 999)
    if (b.status === 'completed' || (endsAt && endsAt.getTime() < Date.now())) continue
    const mins = (new Date(b.next_session_at).getTime() - now.getTime()) / 60000
    if (mins < 20 || mins > 40) continue

    const { data: roster } = await sb.from('class_enrollments')
      .select('id, lead_id, full_name, phone, total_fee, amount_paid')
      .eq('batch_id', b.id).limit(500)

    for (const st of roster || []) {
      if (!st.phone || !st.lead_id) continue
      const { data: dup } = await sb.from('class_reminder_sends')
        .select('id').eq('batch_id', b.id).eq('lead_id', st.lead_id)
        .eq('session_date', today).eq('kind', 'start_30').maybeSingle()
      if (dup) continue

      const { count: attended } = await sb.from('class_signins')
        .select('id', { count: 'exact', head: true }).eq('enrollment_id', st.id)
      const sessionNumber = (attended || 0) + 1
      const freeSessions = Number(b.free_sessions ?? 1)
      const perSession = Number(b.min_payment_per_session ?? 0)
      const paid = Number(st.amount_paid || 0)
      const totalFee = Number(st.total_fee || 0)

      let required = 0
      if (perSession > 0 && sessionNumber > freeSessions) {
        required = (sessionNumber - freeSessions) * perSession
        if (totalFee > 0) required = Math.min(required, totalFee)
      }
      const owed = Math.max(0, Math.round((required - paid) * 100) / 100)

      // A fresh sign-in link so tapping goes straight in
      const token = await createLoginToken(st.lead_id, st.phone)
      const url = `${CONFIG.appUrl}/portal/enter?t=${token}`
      const first = (st.full_name || 'there').split(' ')[0]

      const msg = owed > 0 && chaseFees
        ? `Hi ${first}, how are you doing today?\n\nYour ${b.name} class starts in about 30 minutes. Open your student portal to sign in and join:\n${url}\n\nTo join this session you will need to have paid *GHS ${owed.toFixed(2)}* more. You can pay right inside the portal by mobile money or card, and the Join button unlocks straight away.\n\nSee you in class.`
        : `Hi ${first}, how are you doing today?\n\nJust a reminder that your ${b.name} class starts in about 30 minutes. Open your student portal and tap *Join class*:\n${url}\n\nSee you shortly.`

      const { data: lead } = await sb.from('leads').select('assigned_to').eq('id', st.lead_id).maybeSingle()
      let ok = false
      try { ok = !!(await sendWhatsAppText(st.phone, msg, lead?.assigned_to || null)) } catch {}
      if (ok) {
        sent++
        await sb.from('class_reminder_sends').insert({
          batch_id: b.id, lead_id: st.lead_id, session_date: today, kind: 'start_30',
        }).then(() => {}, () => {})
      }
    }
  }
  return { sent }
}
