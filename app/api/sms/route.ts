import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/integrations/sms'

export async function POST(req: NextRequest) {
  const { phone, message } = await req.json()
  if (!phone || !message) return NextResponse.json({ error: 'Missing phone or message' }, { status: 400 })
  const ok = await sendSMS(phone, message)
  return NextResponse.json({ success: ok })
}
