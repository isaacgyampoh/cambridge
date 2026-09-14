import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { lookup, unavailable } from '@/lib/db/lookup'
import { bumpCounter } from '@/lib/db/counter'

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
   * Count a view, atomically.
   *
   * This was a read-then-write, and it was wrong twice over. Concurrently,
   * two people opening the same flyer both read 40 and both wrote 41, so a
   * view vanished — worst on the flyer being shared hardest, which is exactly
   * backwards. And on a failed read, `(f?.clicks || 0) + 1` wrote 1, taking a
   * flyer's whole running total down to a single click. A click leaves no
   * other record, so that number could not be rebuilt.
   *
   * bumpCounter does it in one statement and never writes a total it could
   * not read. An uncounted view is invisible; a reset one tells a marketer
   * their campaign did nothing.
   */
  await bumpCounter({ table: 'flyers', column: 'clicks' }, id)

  const m: any = (flyer as any).profiles
  return NextResponse.json({
    flyer: {
      id: flyer.id, title: flyer.title, course: flyer.course, image_url: flyer.image_url,
      marketer_name: m?.full_name || null,
      marketer_code: m?.marketer_code || null,
    },
  })
}
