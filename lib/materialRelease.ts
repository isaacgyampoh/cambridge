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
    .select('id, lead_id, course_id, total_fee, amount_paid, student_name, phone')
    .eq('lead_id', leadId).maybeSingle()
  if (!fee) return { released: 0, materials: [] as any[], locked: [] as any[] }

  const paid = Number(fee.amount_paid || 0)
  const total = Number(fee.total_fee || 0)
  const fullyPaid = total > 0 ? paid >= total : paid > 0

  // Which class are they in, and how far has it got? Materials belong to
  // sections, so a student should not receive section 4 in week one.
  let reachedSection = 0
  try {
    const { data: enr } = await sb.from('class_enrollments')
      .select('batch_id').eq('lead_id', leadId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (enr?.batch_id) {
      const { data: b } = await sb.from('batches')
        .select('current_section').eq('id', enr.batch_id).maybeSingle()
      reachedSection = Number((b as any)?.current_section || 1)
    }
  } catch {}

  const { data: docs } = await sb.from('documents')
    .select('id, name, file_url, unlock_after_amount, course_id, section_no, delivery_scope')
    .eq('type', 'course_material')
    .order('section_no', { ascending: true })
    .limit(300)

  const forThisCourse = (docs || []).filter((d: any) => !d.course_id || d.course_id === fee.course_id)

  // A material is available when the payment for it has been made AND the
  // class has reached its section. Paying in full opens every section.
  const isUnlocked = (d: any) => {
    const needed = Number(d.unlock_after_amount || 0)
    if (paid < needed) return false
    if (fullyPaid) return true
    const sec = Number(d.section_no || 0)
    return sec === 0 || sec <= reachedSection
  }

  const eligible = forThisCourse.filter(isUnlocked)
  const locked = forThisCourse.filter((d: any) => !isUnlocked(d))

  if (eligible.length === 0) return { released: 0, materials: [], locked }

  const { data: already } = await sb.from('material_releases')
    .select('document_id').eq('lead_id', leadId).limit(500)
  const seen = new Set((already || []).map((r: any) => r.document_id))

  const fresh = eligible.filter((d: any) => !seen.has(d.id))
  for (const d of fresh) {
    await sb.from('material_releases').insert({
      lead_id: leadId, student_fee_id: fee.id, document_id: d.id,
    }).then(() => {}, () => {})
  }

  // Tell them what just opened — but never send the file itself, since it is
  // read inside the portal only.
  if (opts?.notify !== false && fresh.length > 0 && fee.phone) {
    const first = (fee.student_name || 'there').split(' ')[0]
    const list = fresh.map((d: any) => `- ${d.name}`).join('\n')
    const msg = `Hi ${first}, thanks for your payment. These materials are now open in your student portal:\n\n${list}\n\nOpen the portal to read them.`
    try { await sendWhatsAppText(fee.phone, msg) } catch {}
  }

  return { released: fresh.length, materials: eligible, locked }
}
