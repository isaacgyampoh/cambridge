import { NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  // Count how many staff have a connected WhatsApp line
  let waLines = 0
  try {
    const sb = createServiceClient()
    const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('wawp_status', 'connected')
    waLines = count || 0
  } catch {}

  return NextResponse.json({
    supabase: !!CONFIG.supabaseUrl && !!CONFIG.supabaseServiceKey,
    arkesel: !!CONFIG.arkeselApiKey,
    paystack: !!CONFIG.paystackPublicKey && !!CONFIG.paystackSecretKey && CONFIG.paystackPublicKey.startsWith('pk_'),
    paystackLive: CONFIG.paystackPublicKey?.startsWith('pk_live_') || false,
    wawpCentral: !!CONFIG.wawpInstanceId && !!CONFIG.wawpAccessToken,
    wawpLines: waLines,
    resend: !!CONFIG.resendApiKey,
    senderId: CONFIG.arkeselSenderId,
  })
}
