import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { formatDate } from '@/lib/utils'

type ReminderType = '1_week' | '2_days' | 'day' | 'class_day'

function buildPersonalizedMessage(
 type: ReminderType,
 studentName: string,
 marketerName: string,
 courseName: string,
 batchName: string,
 date: string,
 time: string,
 venue: string,
 classType: string,
 zoomLink?: string | null
): string {
 const firstName = studentName.split(' ')[0]
 const marketerFirst = marketerName.split(' ')[0]
 const isOnline = classType === 'online'
 const locationLine = isOnline && zoomLink
 ?` Zoom Link: ${zoomLink}`
 :` Venue: ${venue || 'Cambridge Centre of Excellence'}`

 const messages: Record<ReminderType, string> = {
 '1_week':`Hello ${firstName}!\n\nThis is ${marketerFirst} from *Cambridge Centre of Excellence*.\n\nJust a friendly reminder that your *${courseName}* class is coming up in one week!\n\nDate: ${date}\nTime: ${time}\n${locationLine}\nBatch: ${batchName}\n\nPlease make sure you have all your materials ready.\n\nLooking forward to seeing you there! If you have any questions, feel free to reach out to me.\n\n– ${marketerName}`,

 '2_days':`Hello ${firstName}!\n\nIt's ${marketerFirst} from *Cambridge Centre of Excellence*.\n\nYour *${courseName}* class is just 2 days away!\n\nDate: ${date}\nTime: ${time}\n${locationLine}\n\nRemember to:\nReview your notes\nPrepare your questions\nSign in when you arrive\n\nCan't wait to see you! Reach out if you need anything.\n\n– ${marketerName}`,

 'day':`Good morning ${firstName}!\n\nThis is ${marketerFirst} from *Cambridge Centre of Excellence*.\n\nYour *${courseName}* class is *TODAY!*\n\nTime: ${time}\n${locationLine}\n\nDon't forget to sign in using the link that will be shared this morning.\n\nHave an amazing session! I'm cheering for you.\n\n– ${marketerName}`,

 'class_day':`Good morning ${firstName}!\n\nIt's ${marketerFirst} from *Cambridge Centre of Excellence*.\n\n*Class is starting soon!*\n\nTime: ${time}\n${locationLine}\n\nPlease sign in using the link shared this morning when you arrive.\n\nSee you there!\n\n– ${marketerName}`,
 }

 return messages[type]
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'trainer', 'receptionist'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
 const { batchId, type } = await req.json()
 if (!batchId || !type) return NextResponse.json({ error: 'Missing batchId or type' }, { status: 400 })

 const sb = createServiceClient()

 // Load batch with full details
 const { data: batch } = await sb.from('batches')
 .select('*, courses(*)')
 .eq('id', batchId).single()

 if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

 // Get all enrolled students with their marketer relationship
 const { data: enrollments } = await sb.from('batch_students')
 .select('*, student:student_id(*)')
 .eq('batch_id', batchId)

 if (!enrollments?.length) {
 return NextResponse.json({ success: true, count: 0, message: 'No enrolled students' })
 }

 const course = (batch as any).courses
 const date = formatDate(batch.start_date)
 const time = batch.schedule || 'Check with your trainer'
 const venue = batch.venue || 'Cambridge Centre of Excellence'

 let sent = 0
 const reminderLogs = []

 for (const enrollment of enrollments) {
 const student = (enrollment as any).student
 if (!student?.phone) continue

 // Find the marketer who owns this student's lead
 const { data: lead } = await sb.from('leads')
 .select('assigned_to, assignee:assigned_to(full_name, phone)')
 .eq('phone', student.phone)
 .maybeSingle()

 const marketer = (lead as any)?.assignee
 const marketerName = marketer?.full_name || 'Your Cambridge Advisor'

 const message = buildPersonalizedMessage(
 type as ReminderType,
 student.full_name,
 marketerName,
 course?.name || batch.name,
 batch.name,
 date,
 time,
 venue,
 batch.class_type,
 batch.zoom_link
)

 let waStatus = 'pending'
 let smsStatus = 'pending'

 // Send WhatsApp (appears to come from marketer's number context)
 try {
 const waOk = await sendWhatsAppText(student.phone, message)
 waStatus = waOk ? 'sent' : 'failed'
 if (waOk) sent++
 } catch {
 waStatus = 'failed'
 }

 // Fallback SMS if WhatsApp fails
 if (waStatus === 'failed') {
 const smsMsg =`Hi ${student.full_name.split(' ')[0]}, it's ${marketerName.split(' ')[0]} from Cambridge CE. Your ${course?.name} class is on ${date} at ${time}. Venue: ${venue}. See you there!`
 try {
 const smsOk = await sendSMS(student.phone, smsMsg)
 smsStatus = smsOk ? 'sent' : 'failed'
 if (smsOk) sent++
 } catch {
 smsStatus = 'failed'
 }
 }

 reminderLogs.push({
 batch_id: batchId,
 marketer_id: lead?.assigned_to || null,
 student_id: student.id,
 reminder_type: type,
 message_sent: message,
 whatsapp_status: waStatus,
 sms_status: smsStatus,
 })
 }

 // Log all reminders
 if (reminderLogs.length) {
 await sb.from('personalized_reminders').insert(reminderLogs)
 }

 return NextResponse.json({ success: true, count: sent, total: enrollments.length })
}
