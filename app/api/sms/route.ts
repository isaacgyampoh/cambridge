import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/integrations/sms'
import { verifySession } from '@/lib/auth/pin'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'marketing_officer', 'admissions_officer', 'accountant', 'receptionist'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const { phone, message } = await req.json()
  if (!phone || !message) return NextResponse.json({ error: 'Missing phone or message' }, { status: 400 })
  const ok = await sendSMS(phone, message)
  return NextResponse.json({ success: ok })
}
