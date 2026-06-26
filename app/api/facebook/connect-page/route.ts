import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * One-click: subscribe the Page to this app for leadgen events, using the
 * Page Access Token. This is the step that makes REAL leads flow (the field
 * 'Test' button works without it, but real Page leads need this).
 *
 * GET  -> shows the Page this token belongs to (confirm it's the right one)
 * POST -> subscribes that Page to leadgen
 */
async function getPage() {
  const token = CONFIG.facebookPageAccessToken
  if (!token) return { error: 'No FACEBOOK_PAGE_ACCESS_TOKEN set in Vercel.' }
  const res = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${token}`, { signal: AbortSignal.timeout(8000) })
  const data = await res.json()
  if (data.error) return { error: data.error.message }
  return { id: data.id, name: data.name }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || session.role !== 'super_admin') return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  return NextResponse.json(await getPage())
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || session.role !== 'super_admin') return NextResponse.json({ error: 'Not permitted' }, { status: 403 })

  const page = await getPage()
  if (page.error) return NextResponse.json(page, { status: 400 })

  // Subscribe the Page to leadgen
  const res = await fetch(
    `https://graph.facebook.com/v18.0/${page.id}/subscribed_apps`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed_fields: 'leadgen', access_token: CONFIG.facebookPageAccessToken }),
      signal: AbortSignal.timeout(8000),
    }
  )
  const data = await res.json()
  if (data.error) return NextResponse.json({ error: data.error.message, page }, { status: 400 })
  return NextResponse.json({ success: true, page, result: data })
}
