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
    // Read the text extracted at upload time — never fetch or parse a file
    // while someone is waiting for a reply.
    const { data } = await sb.from('documents')
      .select('name, extracted_text').eq('type', 'chat_sample')
      .not('extracted_text', 'is', null)
      .order('created_at', { ascending: false }).limit(5)

    for (const d of data || []) {
      if (!d.extracted_text) continue
      out += `\n\n--- ${d.name} ---\n${String(d.extracted_text).slice(0, 4000)}`
    }
  } catch {}
  cache = { text: out.slice(0, 12000), at: Date.now() }
  return cache.text
}
