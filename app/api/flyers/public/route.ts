import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { lookup, unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing' }, { status: 400 })
  const sb = createServiceClient()
  const { row: flyer, failed } = await lookup(
    sb.from('flyers')
      .select('id, title, course, image_url, marketer_id, profiles:marketer_id(full_name, marketer_code)')
      .eq('id', id).maybeSingle(),
  )
  if (failed) return unavailable('[flyers/public]', failed, 'this flyer')
  if (!flyer) return NextResponse.json({ error: 'not found' }, { status: 404 })

  /*
   * Count a view.
   *
   * Same destructive shape as the lead counter: `(f?.clicks || 0) + 1` writes
   * 1 when the read failed, so a flyer on three hundred clicks is written
   * back as having one — and unlike a lead, a click leaves no other record to
   * rebuild the number from. This is a public route, so a spell of failed
   * reads flattens the marketer's figures for every flyer being shared.
   *
   * An uncounted view is invisible. A reset total is a marketer being told
   * their campaign did nothing.
   */
  const { row: f, failed: clicksFailed } = await lookup(
    sb.from('flyers').select('clicks').eq('id', id).maybeSingle(),
  )
  if (clicksFailed) {
    console.error('[flyers/public] view not counted — read failed:', clicksFailed)
  } else if (f) {
    await sb.from('flyers').update({ clicks: (f.clicks || 0) + 1 }).eq('id', id)
      .then(() => {}, () => {})
  }

  const m: any = (flyer as any).profiles
  return NextResponse.json({
    flyer: {
      id: flyer.id, title: flyer.title, course: flyer.course, image_url: flyer.image_url,
      marketer_name: m?.full_name || null,
      marketer_code: m?.marketer_code || null,
    },
  })
}
