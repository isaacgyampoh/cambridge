import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing' }, { status: 400 })
  const sb = createServiceClient()
  const { data: flyer } = await sb.from('flyers')
    .select('id, title, course, image_url, marketer_id, profiles:marketer_id(full_name, marketer_code)')
    .eq('id', id).maybeSingle()
  if (!flyer) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // count a view
  try { await sb.rpc('noop') } catch {}
  try {
    const { data: f } = await sb.from('flyers').select('clicks').eq('id', id).maybeSingle()
    await sb.from('flyers').update({ clicks: (f?.clicks || 0) + 1 }).eq('id', id)
  } catch {}

  const m: any = (flyer as any).profiles
  return NextResponse.json({
    flyer: {
      id: flyer.id, title: flyer.title, course: flyer.course, image_url: flyer.image_url,
      marketer_name: m?.full_name || null,
      marketer_code: m?.marketer_code || null,
    },
  })
}
