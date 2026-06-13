import { NextRequest, NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'

const ARKESEL_URL = 'https://sms.arkesel.com/api/v2/sms/send'
const ARKESEL_KEY = 'VXliSENVQnpsYkhWYlNpZkNRZEc'

// POST { phone?: "0244..." } — sends a test SMS and returns the RAW Arkesel response
export async function POST(req: NextRequest) {
  let phone = '0201234567'
  try { const body = await req.json(); if (body?.phone) phone = body.phone } catch {}

  const apiKey = CONFIG.arkeselApiKey || ARKESEL_KEY
  const senderId = CONFIG.arkeselSenderId || 'CambridgeCE'
  const recipient = phone.replace(/\s+/g, '').replace(/^\+233/, '233').replace(/^\+/, '').replace(/^0/, '233')

  try {
    const res = await fetch(ARKESEL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: senderId,
        message: 'Cambridge Centre of Excellence: test message. If you received this, SMS is working.',
        recipients: [recipient],
      }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => ({}))
    // Arkesel returns { status: "success", ... } on success; anything else is a problem
    const ok = res.ok && (data?.status === 'success' || data?.code === 'ok')
    return NextResponse.json({
      success: ok,
      httpStatus: res.status,
      sender: senderId,
      recipient,
      arkeselResponse: data,
      hint: !ok ? interpretArkesel(data) : 'SMS sent successfully',
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}

function interpretArkesel(data: any): string {
  const msg = JSON.stringify(data).toLowerCase()
  if (msg.includes('insufficient') || msg.includes('balance')) return 'Your Arkesel account has insufficient SMS balance. Top up at arkesel.com.'
  if (msg.includes('sender') || msg.includes('invalid sender')) return 'Your Sender ID "CambridgeCE" is not approved yet. Register/approve it in your Arkesel dashboard (Sender IDs).'
  if (msg.includes('api') && msg.includes('key')) return 'The Arkesel API key is invalid or expired.'
  return 'SMS was not accepted by Arkesel. Check the response details above.'
}
