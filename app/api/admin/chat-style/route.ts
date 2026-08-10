import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * The uploaded conversation samples, as plain text, for the assistant to copy
 * the house style from. Cached so it is not fetched on every message.
 */
let cache: { text: string; at: number } | null = null

export async function GET() {
  const text = await getChatStyle()
  return NextResponse.json({ hasSamples: !!text, length: text.length })
}

export async function getChatStyle(): Promise<string> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.text
  let out = ''
  try {
    const sb = createServiceClient()
    const { data } = await sb.from('documents')
      .select('file_url, name').eq('type', 'chat_sample')
      .order('created_at', { ascending: false }).limit(4)

    for (const d of data || []) {
      if (!d.file_url) continue
      try {
        const r = await fetch(d.file_url, { signal: AbortSignal.timeout(8000) })
        const ct = r.headers.get('content-type') || ''
        // Only plain text can be read directly; a PDF needs extracting, which
        // is not worth doing on every message.
        if (/text|json/i.test(ct)) {
          const t = await r.text()
          out += `\n\n--- ${d.name} ---\n${t.slice(0, 4000)}`
        }
      } catch {}
    }
  } catch {}
  cache = { text: out.slice(0, 12000), at: Date.now() }
  return cache.text
}
