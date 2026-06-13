import { NextRequest, NextResponse } from 'next/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const sb = createServiceClient()
  const { data: admins } = await sb.from('profiles').select('phone').eq('role', 'super_admin').limit(1)
  const phone = admins?.[0]?.phone || '0201234567'

  const ok = await sendWhatsAppText(phone, 'CCE ERP: Test WhatsApp from Cambridge Centre of Excellence system.')
  return NextResponse.json({ success: ok })
}
