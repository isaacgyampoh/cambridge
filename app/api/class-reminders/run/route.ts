import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { broadcastClassReminder } from '@/lib/classReminderBroadcast'

export const runtime = 'nodejs'

/** Cron: /api/class-reminders/run?key=SETUP_SECRET every ~15 min. */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const now = new Date().toISOString()
  const { data: due } = await sb.from('class_reminders')
    .select('id').eq('status', 'scheduled').lte('notify_at', now).limit(10)

  const results = []
  for (const d of due || []) results.push(await broadcastClassReminder(d.id))
  return NextResponse.json({ ran: true, reminders: results.length, results })
}
