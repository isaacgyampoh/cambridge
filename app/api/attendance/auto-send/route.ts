import { CONFIG } from '@/lib/config'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import crypto from 'crypto'

// Generate a random class code like CCE-2503
function generateClassCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const nums = Math.floor(Math.random() * 9000 + 1000).toString()
  const prefix = letters[Math.floor(Math.random() * letters.length)] + letters[Math.floor(Math.random() * letters.length)]
  return `CCE-${prefix}${nums.slice(0, 2)}`
}

export async function POST(req: NextRequest) {
  // Verify this is a legit cron call
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${CONFIG.cronSecret || 'cce-cron-2024'}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()

  // Find batches that have class today (ongoing batches)
  // In production, batches should have a schedule field like "Mon,Wed,Fri"
  const { data: batches } = await sb.from('batches')
    .select('*, courses(*)')
    .eq('status', 'ongoing')
    .not('start_date', 'is', null)

  if (!batches?.length) {
    return NextResponse.json({ message: 'No ongoing batches today', count: 0 })
  }

  let sessionsCreated = 0
  let linksSent = 0

  for (const batch of batches) {
    // Check if session already exists for today
    const { data: existing } = await sb.from('class_sessions')
      .select('id').eq('batch_id', batch.id).eq('session_date', today).single()

    if (existing) continue // Already sent today

    // Create session with unique class code
    const classCode = generateClassCode()
    const { data: session, error } = await sb.from('class_sessions').insert({
      batch_id: batch.id,
      class_code: classCode,
      session_date: today,
      signin_open: true,
      signin_link_sent_at: new Date().toISOString(),
    }).select().single()

    if (error || !session) continue
    sessionsCreated++

    // Get all enrolled students
    const { data: enrollments } = await sb.from('batch_students')
      .select('*, student:student_id(*)')
      .eq('batch_id', batch.id)

    const appUrl = CONFIG.appUrl
    const signinUrl = `${appUrl}/signin/${batch.id}`
    const courseName = (batch as any).courses?.name || batch.name

    for (const enrollment of enrollments || []) {
      const student = (enrollment as any).student
      if (!student?.phone) continue

      // Get marketer for this student (from their admission)
      const { data: admission } = await sb.from('admissions')
        .select('*, lead:lead_id(assigned_to)')
        .eq('student_id', student.id)
        .single()

      const marketerId = (admission as any)?.lead?.assigned_to
      const linkWithMarketer = marketerId ? `${signinUrl}?m=${marketerId}` : signinUrl

      const message = `🎓 *Cambridge CE — ${courseName}*\n\n` +
        `Good morning ${student.full_name.split(' ')[0]}! 👋\n\n` +
        `Today's class is about to begin. Please sign in:\n\n` +
        `🔗 ${linkWithMarketer}\n\n` +
        `📌 You'll need today's class code — it will be written on the board/screen when you arrive.\n\n` +
        `See you in class! 📚`

      try {
        await sendWhatsAppText(student.phone, message)
        linksSent++
      } catch (e) {
        // Fallback to SMS if WhatsApp fails
        try {
          await sendSMS(student.phone, `Cambridge CE: Good morning! ${courseName} class today. Sign in at: ${linkWithMarketer}`)
          linksSent++
        } catch {}
      }
    }

    // Log in session that links were sent
    await sb.from('class_sessions').update({
      signin_link_sent_at: new Date().toISOString(),
    }).eq('id', session.id)
  }

  return NextResponse.json({
    success: true,
    sessionsCreated,
    linksSent,
    date: today,
  })
}

// Also allow GET to trigger manually from admin
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (secret !== (CONFIG.cronSecret || 'cce-cron-2024')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return POST(new NextRequest(req.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${CONFIG.cronSecret || 'cce-cron-2024'}` },
  }))
}
