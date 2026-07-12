import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** Public: active course names for dropdowns on public forms (refer page). */
export async function GET() {
  const sb = createServiceClient()
  const { data } = await sb.from('courses').select('id, name').eq('is_active', true).order('name')
  return NextResponse.json({
    courses: (data || []).map((c: any) => c.name),      // backward-compat: names
    list: (data || []).map((c: any) => ({ id: c.id, name: c.name })),  // id + name
  })
}
