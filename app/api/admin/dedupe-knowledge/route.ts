import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * Remove duplicated knowledge-base entries, keeping the OLDEST of each set
 * (that's the one the AI has been using). Duplicates are matched on the
 * normalised question/answer text, so re-saves and repeated imports collapse
 * into one clean entry.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data: rows } = await sb.from('knowledge_base')
    .select('id, kind, question, answer, created_at')
    .order('created_at', { ascending: true }).limit(5000)

  const norm = (v: any) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const seen = new Map<string, string>()
  const dupIds: string[] = []

  for (const r of rows || []) {
    const key = `${r.kind}|${norm(r.question)}|${norm(r.answer)}`
    if (seen.has(key)) dupIds.push(r.id)   // keep the first (oldest)
    else seen.set(key, r.id)
  }

  // Delete in chunks so a large cleanup can't blow the request
  let removed = 0
  for (let i = 0; i < dupIds.length; i += 100) {
    const chunk = dupIds.slice(i, i + 100)
    const { error } = await sb.from('knowledge_base').delete().in('id', chunk)
    if (!error) removed += chunk.length
  }

  return NextResponse.json({ success: true, scanned: (rows || []).length, removed, kept: seen.size })
}
