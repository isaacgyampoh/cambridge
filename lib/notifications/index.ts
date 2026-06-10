import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS, SMS } from '@/lib/integrations/sms'
import { sendWhatsAppText, WA } from '@/lib/integrations/whatsapp'
import { sendWelcomeEmail, sendAdmissionLetter, sendPaymentReceipt, sendClassReminder } from '@/lib/integrations/email'

const sb = () => createServiceClient()

// Create in-app notification
export async function notify(userId: string, type: string, title: string, body: string, data?: any) {
  await sb().from('notifications').insert({ user_id: userId, type, title, body, data: data || null })
}

// Notify all users of a given role
export async function notifyRole(role: string, type: string, title: string, body: string, data?: any) {
  const { data: users } = await sb().from('profiles').select('id,phone').eq('role', role).eq('is_active', true)
  if (!users?.length) return
  await sb().from('notifications').insert(
    users.map((u: any) => ({ user_id: u.id, type, title, body, data: data || null }))
  )
  return users
}

// ── NEW LEAD ────────────────────────────────────────────────

export async function onNewLead(lead: any) {
  const { data: pms } = await sb().from('profiles').select('*').eq('role', 'project_manager').eq('is_active', true)
  const { count } = await sb().from('leads').select('*', { count: 'exact', head: true }).is('assigned_to', null)

  for (const pm of pms || []) {
    await notify(pm.id, 'lead', 'New lead received', `${lead.full_name} came from ${lead.source}`, { lead_id: lead.id })
    if (pm.phone) await sendSMS(pm.phone, SMS.newLeadToPM(lead.full_name, lead.source, count || 1))
  }
}

// ── LEAD ASSIGNED ───────────────────────────────────────────

export async function onLeadAssigned(lead: any, marketer: any) {
  // Notify marketer
  await notify(marketer.id, 'assignment', 'New lead assigned to you', `${lead.full_name} — ${lead.course_interest || 'No course specified'}`, { lead_id: lead.id })
  if (marketer.phone) await sendSMS(marketer.phone, SMS.leadAssignedToMarketer(marketer.full_name, lead.full_name))

  // WhatsApp to lead
  if (lead.phone) await sendWhatsAppText(lead.phone, WA.leadAssigned(lead.full_name, marketer.full_name))

  // Log activity
  await sb().from('lead_activities').insert({
    lead_id: lead.id,
    activity_type: 'whatsapp',
    subject: 'Assignment notification',
    description: `Assigned to ${marketer.full_name}. WA message sent to lead.`,
    created_by: marketer.id,
  })
}

// ── READY TO JOIN ───────────────────────────────────────────

export async function onReadyToJoin(lead: any, admissionId: string) {
  const { data: officers } = await sb().from('profiles').select('*').in('role', ['admissions_officer', 'accountant']).eq('is_active', true)

  for (const o of officers || []) {
    const isAccountant = o.role === 'accountant'
    await notify(o.id, 'admission', isAccountant ? 'New student awaiting payment' : 'New admission case',
      `${lead.full_name} is ready to join${lead.course_interest ? ` (${lead.course_interest})` : ''}.`,
      { lead_id: lead.id, admission_id: admissionId }
    )
    if (o.phone) {
      isAccountant
        ? await sendSMS(o.phone, SMS.readyToJoinToAccountant(lead.full_name))
        : await sendSMS(o.phone, SMS.readyToJoinToOfficer(o.full_name, lead.full_name))
    }
  }

  // WA to lead
  if (lead.phone) await sendWhatsAppText(lead.phone, WA.applicationConfirmed(lead.full_name, lead.course_interest || 'your chosen program'))
}

// ── ADMITTED ────────────────────────────────────────────────

export async function onAdmitted(lead: any, course: string, admissionNo: string, startDate?: string) {
  if (lead.email) await sendAdmissionLetter(lead.email, lead.full_name, course, admissionNo, startDate)
  if (lead.phone) await sendWhatsAppText(lead.phone, WA.admissionAccepted(lead.full_name, course, startDate || 'TBD'))
}

// ── PAYMENT CONFIRMED ───────────────────────────────────────

export async function onPaymentConfirmed(student: any, amount: string, receipt: string, course: string) {
  if (student.phone) {
    await sendSMS(student.phone, SMS.paymentConfirmed(student.full_name, amount, receipt))
    await sendWhatsAppText(student.phone, WA.paymentConfirmed(student.full_name, amount, course, receipt))
  }
  if (student.email) await sendPaymentReceipt(student.email, student.full_name, amount, receipt, course)
}

// ── CLASS REMINDERS ─────────────────────────────────────────

export async function onClassReminder(student: any, course: string, date: string, time: string, venue: string, daysUntil: number, zoom?: string) {
  if (student.phone) {
    await sendSMS(student.phone, SMS.classReminder(student.full_name, course, date, time, venue))
    const waMsg = daysUntil === 0
      ? WA.classReminderDay(student.full_name, course, time, venue, zoom)
      : daysUntil <= 2
      ? WA.classReminder2Days(student.full_name, course, date, time, venue, zoom)
      : WA.classReminder1Week(student.full_name, course, date, time, venue)
    await sendWhatsAppText(student.phone, waMsg)
  }
  if (student.email) await sendClassReminder(student.email, student.full_name, course, date, time, venue, zoom)
}
