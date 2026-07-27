import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'

/**
 * Release course materials in step with what a student has paid.
 * Every 'course_material' document for their course carries an
 * unlock_after_amount; once their cumulative payment reaches it, the material
 * is released (and sent once). Nothing unlocks at 0 paid unless the material
 * itself is set to 0.
 */
export async function releaseMaterialsFor(leadId: string, opts?: { notify?: boolean }) {
  const sb = createServiceClient()

  const { data: fee } = await sb.from('student_fees')
    .select('id, lead_id, course_id, amount_paid, student_name, phone')
    .eq('lead_id', leadId).maybeSingle()
  if (!fee) return { released: 0, materials: [] as any[] }

  const paid = Number(fee.amount_paid || 0)

  // Materials for this course (or general ones with no course set)
  const { data: docs } = await sb.from('documents')
    .select('id, name, file_url, unlock_after_amount, course_id, delivery_scope')
    .eq('type', 'course_material')
    .order('unlock_after_amount', { ascending: true })
    .limit(200)

  const eligible = (docs || []).filter((d: any) =>
    (!d.course_id || d.course_id === fee.course_id) &&
    Number(d.unlock_after_amount || 0) <= paid)

  if (eligible.length === 0) return { released: 0, materials: [] }

  const { data: already } = await sb.from('material_releases')
    .select('document_id').eq('lead_id', leadId).limit(500)
  const seen = new Set((already || []).map((r: any) => r.document_id))

  const fresh = eligible.filter((d: any) => !seen.has(d.id))
  for (const d of fresh) {
    await sb.from('material_releases').insert({
      lead_id: leadId, student_fee_id: fee.id, document_id: d.id,
    }).then(() => {}, () => {})
  }

  // Tell the student what just unlocked
  if (opts?.notify !== false && fresh.length > 0 && fee.phone) {
    const first = (fee.student_name || 'there').split(' ')[0]
    const list = fresh.map((d: any) => `• ${d.name}\n  ${d.file_url}`).join('\n')
    const msg = `Hi ${first}! 📚 Thank you for your payment. These course materials are now unlocked for you:\n\n${list}\n\nMore will be released as you continue your payments.`
    try { await sendWhatsAppText(fee.phone, msg) } catch {}
  }

  // Everything they can currently access (for the sign-in screen)
  return { released: fresh.length, materials: eligible }
}
