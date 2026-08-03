import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * What has actually arrived from WhatsApp, read from whichever log is
 * available — so diagnosis works even if the newest schema has not been run.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const out: any = { events: [], sources: {}, setup: {} }

  // Preferred source
  try {
    const { data, error } = await sb.from('webhook_inbox')
      .select('*').order('created_at', { ascending: false }).limit(80)
    out.sources.webhook_inbox = error ? `missing (${error.message.slice(0, 60)})` : `${(data || []).length} entries`
    if (!error) out.events.push(...(data || []).map((r: any) => ({
      at: r.created_at, phone: r.from_phone, text: r.body_text,
      outcome: r.outcome, detail: r.detail,
    })))
  } catch (e: any) { out.sources.webhook_inbox = 'missing' }

  // Fallback source
  if (out.events.length === 0) {
    try {
      const { data } = await sb.from('whatsapp_logs')
        .select('*').ilike('message', '[INBOUND%').order('created_at', { ascending: false }).limit(80)
      out.sources.whatsapp_logs = `${(data || []).length} inbound entries`
      out.events.push(...(data || []).map((r: any) => ({
        at: r.created_at, phone: r.recipient, text: r.message,
        outcome: r.provider_response?.outcome || r.status, detail: r.provider_response?.detail || '',
      })))
    } catch { out.sources.whatsapp_logs = 'unavailable' }
  }

  // What conversations exist at all — proves whether anything is flowing
  try {
    const since = new Date(Date.now() - 86400000).toISOString()
    const { count: inbound } = await sb.from('ai_conversations')
      .select('id', { count: 'exact', head: true }).not('incoming_text', 'is', null).gte('created_at', since)
    const { count: outbound } = await sb.from('whatsapp_logs')
      .select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', since)
    out.last24h = { messagesFromLeads: inbound || 0, messagesWeSent: outbound || 0 }
  } catch {}

  out.setup = {
    wasenderKey: CONFIG.wasenderApiKey ? 'set' : 'MISSING',
    openaiKey: CONFIG.openaiApiKey ? 'set' : 'MISSING',
    webhookUrl: `${new URL(req.url).origin}/api/webhooks/whatsapp`,
  }
  out.verdict = out.last24h?.messagesFromLeads
    ? 'Messages from leads are arriving. Check the outcomes below for any that were not answered.'
    : 'No messages from leads have arrived in 24 hours. WaSender is not calling the webhook URL above — set it in WaSender for each connected session.'

  return NextResponse.json(out)
}
