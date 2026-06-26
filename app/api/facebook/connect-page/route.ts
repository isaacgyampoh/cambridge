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
  // What does this token belong to? (User vs Page)
  const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${token}`, { signal: AbortSignal.timeout(8000) })
  const me = await meRes.json()
  if (me.error) return { error: me.error.message }

  // List the Pages this token can manage (works for a User token)
  const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${token}`, { signal: AbortSignal.timeout(8000) })
  const pages = await pagesRes.json()
  const managedPages = (pages?.data || []).map((p: any) => ({ id: p.id, name: p.name }))

  return {
    id: me.id,
    name: me.name,
    tokenBelongsTo: managedPages.length ? 'user' : 'page-or-unknown',
    managedPages,
  }
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

  // Determine which Page to subscribe and which token to use.
  // If this is a User token, use the Page's own access_token from /me/accounts.
  let pageId = page.id
  let pageToken = CONFIG.facebookPageAccessToken
  try {
    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${CONFIG.facebookPageAccessToken}`, { signal: AbortSignal.timeout(8000) })
    const pages = await pagesRes.json()
    if (pages?.data?.length) {
      pageId = pages.data[0].id
      pageToken = pages.data[0].access_token   // the Page's own token — correct for subscribing
    }
  } catch {}

  // Subscribe the Page to leadgen using the Page token
  const res = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed_fields: 'leadgen', access_token: pageToken }),
      signal: AbortSignal.timeout(8000),
    }
  )
  const data = await res.json()
  if (data.error) return NextResponse.json({ error: data.error.message, pageId }, { status: 400 })
  return NextResponse.json({ success: true, pageId, pageName: page.managedPages?.[0]?.name || page.name, result: data })
}
