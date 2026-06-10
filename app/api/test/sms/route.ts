import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/integrations/sms'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const sb = createServiceClient()
  const { data: admins } = await sb.from('profiles').select('phone').eq('role', 'super_admin').limit(1)
  const phone = admins?.[0]?.phone || '0201234567'

  const ok = await sendSMS(phone, 'CCE ERP: Test SMS from Cambridge Centre of Excellence system. If you received this, SMS is working! ✅')
  return NextResponse.json({ success: ok })
}
