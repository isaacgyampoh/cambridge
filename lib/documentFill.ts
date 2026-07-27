import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { createServiceClient } from '@/lib/supabase/server'

export type FillValues = Record<string, string>

/** Where a field is stamped on the page. Origin is TOP-left, in points (A4 = 595x842). */
export interface FieldPos { key: string; x: number; y: number; size?: number; bold?: boolean }

export const FIELD_KEYS = [
  'full_name', 'admission_number', 'course', 'batch', 'date', 'amount', 'email', 'phone', 'receipt_number',
]

/** Sensible defaults so a template works before anyone tunes positions. */
export const DEFAULT_POSITIONS: FieldPos[] = [
  { key: 'date', x: 60, y: 150, size: 11 },
  { key: 'full_name', x: 60, y: 190, size: 12, bold: true },
  { key: 'course', x: 60, y: 215, size: 12, bold: true },
  { key: 'admission_number', x: 60, y: 240, size: 12, bold: true },
]

/**
 * Personalise an uploaded PDF template.
 *
 * Two ways, tried in order:
 *  1. If the PDF has real form fields (AcroForm) whose names match our keys,
 *     they are filled and flattened — perfect fidelity, no positioning needed.
 *  2. Otherwise the values are stamped onto the first page at the saved
 *     coordinates, so a designed letterhead keeps its look.
 *
 * Returns the personalised PDF bytes.
 */
export async function fillTemplate(
  templateBytes: ArrayBuffer | Uint8Array,
  values: FillValues,
  positions?: FieldPos[] | null,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes)
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // 1) AcroForm fields
  let filledAny = false
  try {
    const form = pdf.getForm()
    for (const f of form.getFields()) {
      const name = f.getName().replace(/[{}\s]/g, '').toLowerCase()
      const val = values[name]
      if (val === undefined) continue
      try { (form.getTextField(f.getName())).setText(String(val)); filledAny = true } catch {}
    }
    if (filledAny) { form.flatten() }
  } catch { /* no form on this PDF */ }

  // 2) Stamp at coordinates
  if (!filledAny) {
    const page = pdf.getPages()[0]
    if (page) {
      const { height } = page.getSize()
      for (const p of (positions?.length ? positions : DEFAULT_POSITIONS)) {
        const val = values[p.key]
        if (!val) continue
        page.drawText(String(val), {
          x: p.x,
          y: height - p.y,           // saved as distance from the TOP
          size: p.size || 12,
          font: p.bold ? bold : helv,
          color: rgb(0.07, 0.13, 0.17),
        })
      }
    }
  }

  return pdf.save()
}

/** Fetch a template, personalise it, store the result, return its public URL. */
export async function renderPersonalisedDoc(opts: {
  templateUrl: string
  positions?: FieldPos[] | null
  values: FillValues
  folder?: string
  filename?: string
}): Promise<string | null> {
  try {
    const res = await fetch(opts.templateUrl)
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    const out = await fillTemplate(bytes, opts.values, opts.positions)

    const sb = createServiceClient()
    const safe = (opts.filename || opts.values.full_name || 'document').replace(/[^a-z0-9]/gi, '-').slice(0, 40)
    const path = `${opts.folder || 'personalised'}/${Date.now()}-${safe}.pdf`
    const { error } = await sb.storage.from('uploads').upload(path, Buffer.from(out), {
      contentType: 'application/pdf', upsert: false,
    })
    if (error) return null
    return sb.storage.from('uploads').getPublicUrl(path).data.publicUrl
  } catch {
    return null
  }
}
