import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'

/**
 * Scheduled prep reminders. For each active-prep student:
 *  - sends any content whose send_offset_days matches days-until-their-exam
 *  - sends a voucher-expiry reminder as the expiry approaches
 * De-duped via prep_sends so nothing repeats.
 */
export async function runPrepReminders() {
  const sb = createServiceClient()
  const now = Date.now()
  const DAY = 86400000

  const { data: students } = await sb.from('prep_records')
    .select('id, student_name, phone, program_code, program_name, prep_status, exam_scheduled_date, voucher_code, voucher_expiry_date')
    .neq('prep_status', 'completed').not('phone', 'is', null).limit(2000)

  // Pull scheduled content (has a send_offset_days)
  const { data: scheduled } = await sb.from('prep_content')
    .select('*').eq('active', true).not('send_offset_days', 'is', null).limit(500)

  let sent = 0
  for (const st of students || []) {
    const first = (st.student_name || 'there').split(' ')[0]

    // 1) Scheduled content keyed to days-before-exam
    if (st.exam_scheduled_date) {
      const daysToExam = Math.round((new Date(st.exam_scheduled_date).getTime() - now) / DAY)
      for (const c of (scheduled || []).filter((c: any) => c.program_code === st.program_code)) {
        if (c.send_offset_days === daysToExam) {
          // de-dupe
          const { data: already } = await sb.from('prep_sends')
            .select('id').eq('content_id', c.id).eq('prep_record_id', st.id).limit(1).maybeSingle()
          if (already) continue
          const msg = formatContent(c, first)
          let ok = false
          try { ok = !!(await sendWhatsAppText(st.phone, msg)) } catch {}
          if (!ok) { try { ok = !!(await sendSMS(st.phone, msg)) } catch {} }
          if (ok) { sent++; await sb.from('prep_sends').insert({ content_id: c.id, prep_record_id: st.id, phone: st.phone }).then(() => {}, () => {}) }
        }
      }
    }

    // 2) Voucher-expiry reminder at 7 days and 2 days before expiry
    if (st.voucher_code && st.voucher_expiry_date) {
      const daysToExpiry = Math.round((new Date(st.voucher_expiry_date).getTime() - now) / DAY)
      if (daysToExpiry === 7 || daysToExpiry === 2) {
        const tag = `voucher_expiry_${daysToExpiry}`
        const { data: already } = await sb.from('prep_sends')
          .select('id').eq('prep_record_id', st.id).eq('phone', `${st.phone}#${tag}`).limit(1).maybeSingle()
        if (!already) {
          const when = new Date(st.voucher_expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
          const msg = `Hi ${first}! ⏰ A reminder that your ${st.program_name || st.program_code} exam voucher (*${st.voucher_code}*) expires on *${when}* — that's ${daysToExpiry} day${daysToExpiry > 1 ? 's' : ''} away. Please schedule and sit your exam before then. You've got this! 💪`
          let ok = false
          try { ok = !!(await sendWhatsAppText(st.phone, msg)) } catch {}
          if (!ok) { try { ok = !!(await sendSMS(st.phone, msg)) } catch {} }
          if (ok) { sent++; await sb.from('prep_sends').insert({ prep_record_id: st.id, phone: `${st.phone}#${tag}` }).then(() => {}, () => {}) }
        }
      }
    }

    // 3) Good-wishes the day before the exam
    if (st.exam_scheduled_date) {
      const daysToExam = Math.round((new Date(st.exam_scheduled_date).getTime() - now) / DAY)
      if (daysToExam === 1) {
        const tag = 'good_wishes'
        const { data: already } = await sb.from('prep_sends')
          .select('id').eq('prep_record_id', st.id).eq('phone', `${st.phone}#${tag}`).limit(1).maybeSingle()
        if (!already) {
          const msg = `Hi ${first}! 🌟 Your ${st.program_name || st.program_code} exam is tomorrow. Get a good night's rest, arrive early, and remember to bring your national ID. We believe in you — go and do your best! 🎓`
          let ok = false
          try { ok = !!(await sendWhatsAppText(st.phone, msg)) } catch {}
          if (!ok) { try { ok = !!(await sendSMS(st.phone, msg)) } catch {} }
          if (ok) { sent++; await sb.from('prep_sends').insert({ prep_record_id: st.id, phone: `${st.phone}#${tag}` }).then(() => {}, () => {}) }
        }
      }
    }
  }

  return { sent }
}

function formatContent(c: any, firstName: string): string {
  const hi = `Hi ${firstName}! `
  if (c.kind === 'question') return `${hi}📝 Practice question:\n\n${c.body}${c.answer ? `\n\n*Answer:* ${c.answer}` : ''}`
  if (c.kind === 'tip') return `${hi}💡 Exam tip:\n\n${c.body}`
  if (c.kind === 'exam_info') return `${hi}ℹ️ ${c.title || 'Exam information'}:\n\n${c.body}`
  return `${hi}${c.body}`
}
