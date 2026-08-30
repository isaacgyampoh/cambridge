import { NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'
import { SECRETS } from '@/lib/config.server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  // Count how many staff have a connected WhatsApp line
  let waLines = 0
  try {
    const sb = createServiceClient()
    const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('wasender_status', 'connected')
    waLines = count || 0
  } catch {}

  return NextResponse.json({
    supabase: !!CONFIG.supabaseUrl && !!SECRETS.supabaseServiceKey,
    arkesel: !!SECRETS.arkeselApiKey,
    paystack: !!CONFIG.paystackPublicKey && !!SECRETS.paystackSecretKey && CONFIG.paystackPublicKey.startsWith('pk_'),
    paystackLive: CONFIG.paystackPublicKey?.startsWith('pk_live_') || false,
    wawpCentral: !!SECRETS.wasenderApiKey,
    wawpLines: waLines,
    resend: !!SECRETS.resendApiKey,
    storage: !!CONFIG.supabaseUrl && !!SECRETS.supabaseServiceKey,
    ai: (SECRETS.aiProvider === 'openai' ? !!SECRETS.openaiApiKey : !!SECRETS.anthropicApiKey) && SECRETS.aiAssistantEnabled,
    senderId: CONFIG.arkeselSenderId,
  })
}
