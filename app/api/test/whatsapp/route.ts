import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { data: admins } = await sb.from('profiles').select('phone').eq('role', 'super_admin').limit(1)
  const phone = admins?.[0]?.phone || '0201234567'

  const ok = await sendWhatsAppText(phone, 'CCE ERP: Test WhatsApp from Cambridge Center of Excellence system.')
  return NextResponse.json({ success: ok })
}
