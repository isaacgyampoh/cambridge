import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Single-use class entry. Consumes the token, records attendance, then
 * redirects to Zoom. A shared or reused URL lands on the portal instead.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const sb = createServiceClient()
  const home = new URL('/portal', req.url)

  const { data: t } = await sb.from('class_access_tokens').select('*').eq('token', token).maybeSingle()
  if (!t || t.used || (t.expires_at && new Date(t.expires_at).getTime() < Date.now())) {
    return NextResponse.redirect(home, { status: 302 })
  }
  await sb.from('class_access_tokens').update({ used: true }).eq('token', token)

  const { data: b } = await sb.from('batches').select('zoom_link').eq('id', t.batch_id).maybeSingle()
  if (!b?.zoom_link) return NextResponse.redirect(home, { status: 302 })

  // Record attendance
  try {
    const { data: enr } = await sb.from('class_enrollments')
      .select('id, full_name, phone').eq('lead_id', t.lead_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (enr) {
      const today = new Date().toISOString().slice(0, 10)
      const { data: seen } = await sb.from('class_signins')
        .select('id').eq('enrollment_id', enr.id).eq('session_date', today).maybeSingle()
      if (!seen) {
        await sb.from('class_signins').insert({
          batch_id: t.batch_id, enrollment_id: enr.id,
          student_name: enr.full_name, phone: enr.phone, session_date: today,
        })
      }
    }
  } catch {}

  return NextResponse.redirect(b.zoom_link, { status: 302 })
}
