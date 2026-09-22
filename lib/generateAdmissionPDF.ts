import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * The admission letter's palette, matching globals.css.
 *
 * This was teal — #1a7a85, from a palette the product no longer uses. The
 * letter is the single most formal thing the centre sends anybody, and it was
 * arriving in a colour that appears nowhere else on the crest, the portal or
 * the site. These are the same values as --brand, --ink and --canvas.
 */
const BRAND = rgb(0.043, 0.231, 0.180)     // #0B3B2E deep forest
const INK = rgb(0.063, 0.137, 0.110)       // #10231C
const SOFT = rgb(0.353, 0.420, 0.392)      // #5A6B64
const FAINT = rgb(0.549, 0.604, 0.580)     // #8C9A94
const PANEL = rgb(0.965, 0.973, 0.969)     // #F6F8F7

interface LetterData {
  name: string
  course: string
  admissionNo: string
  /**
   * The date printed on the letter — REQUIRED, and supplied by the caller
   * from the moment of sending in Accra time. The letter used to compute its
   * own date from the server clock, and the stored PDF it replaced had none.
   */
  letterDate: string
  /** "In-Person" or "Virtual". Printed, because the fee depends on it. */
  mode: string
  /** The current programme fee for that mode, already formatted. REQUIRED. */
  fee: string
  /** The registration fee, when the course has one. */
  registrationFee?: string
  startDate?: string
}

/**
 * Generate a personalized admission-letter PDF, upload it to Supabase Storage,
 * and return its public URL. Falls back to null on any failure (caller then
 * uses the HTML email letter only).
 */
export async function generateAdmissionPDF(data: LetterData): Promise<string | null> {
  try {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([595, 842]) // A4 portrait (points)
    const { width, height } = page.getSize()
    const helv = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const serif = await pdf.embedFont(StandardFonts.TimesRoman)

    // ── Header band ──
    page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: BRAND })
    page.drawText('CAMBRIDGE CENTER OF EXCELLENCE', {
      x: 40, y: height - 58, size: 18, font: bold, color: rgb(1, 1, 1),
    })
    page.drawText('LETTER OF ADMISSION', {
      x: 40, y: height - 82, size: 11, font: helv, color: rgb(0.749, 0.890, 0.902),
    })

    let y = height - 150
    page.drawText(data.letterDate, { x: 40, y, size: 10, font: helv, color: SOFT })

    y -= 40
    page.drawText(`Dear ${data.name},`, { x: 40, y, size: 12, font: bold, color: INK })

    y -= 26
    const intro = 'We are delighted to formally'
    const intro2 = 'offer you admission into the following programme at Cambridge Center of Excellence:'
    page.drawText(intro, { x: 40, y, size: 11, font: serif, color: INK })
    y -= 16
    page.drawText(intro2, { x: 40, y, size: 11, font: serif, color: INK })

    // ── Details panel ──
    y -= 30
    const rows = 5 + (data.registrationFee ? 1 : 0) + (data.startDate ? 1 : 0)
    const panelH = 20 + rows * 22
    page.drawRectangle({ x: 40, y: y - panelH, width: width - 80, height: panelH, color: PANEL })
    page.drawRectangle({ x: 40, y: y - panelH, width: 4, height: panelH, color: BRAND })

    let py = y - 24
    const row = (label: string, value: string) => {
      page.drawText(label, { x: 60, y: py, size: 10, font: helv, color: SOFT })
      page.drawText(value, { x: 200, y: py, size: 11, font: bold, color: INK })
      py -= 22
    }
    row('Admission Number', data.admissionNo || '—')
    row('Programme', data.course)
    row('Study Mode', data.mode)
    row('Candidate', data.name)
    row('Programme Fee', data.fee)
    if (data.registrationFee) row('Registration Fee', data.registrationFee)
    if (data.startDate) row('Start Date', data.startDate)

    // ── Body ──
    y = y - panelH - 30
    /*
     * "Your registration fee has been received" was the first sentence here,
     * and it is not true of everybody Admissions admits — so it is no longer
     * asserted on an official document.
     */
    const body = [
      'Our team will be in touch shortly with your class schedule, learning materials and',
      'joining details. Please keep your admission number safe — you will need it for all',
      'correspondence. The fees above are those current on the date of this letter.',
      '',
      'We warmly welcome you to the Cambridge Center of Excellence community and look',
      'forward to supporting your professional journey.',
    ]
    for (const line of body) {
      page.drawText(line, { x: 40, y, size: 11, font: serif, color: INK })
      y -= 16
    }

    y -= 24
    page.drawText('Yours sincerely,', { x: 40, y, size: 11, font: serif, color: INK })
    y -= 24
    page.drawText('Admissions Office', { x: 40, y, size: 11, font: bold, color: INK })
    y -= 15
    page.drawText('Cambridge Center of Excellence', { x: 40, y, size: 10, font: helv, color: SOFT })

    // ── Footer ──
    page.drawLine({ start: { x: 40, y: 70 }, end: { x: width - 40, y: 70 }, thickness: 0.5, color: rgb(0.918, 0.929, 0.945) })
    page.drawText('This is an official admission letter from Cambridge Center of Excellence.', {
      x: 40, y: 54, size: 9, font: helv, color: FAINT,
    })
    page.drawText('For enquiries, reply to your admission email or contact the Admissions Office.', {
      x: 40, y: 42, size: 9, font: helv, color: FAINT,
    })

    const pdfBytes = await pdf.save()

    // Upload to Supabase Storage
    const sb = createServiceClient()
    const safe = (data.name || 'student').replace(/[^a-z0-9]/gi, '-').slice(0, 40)
    const path = `admission-letters/${Date.now()}-${safe}.pdf`
    const { error } = await sb.storage.from('uploads').upload(path, Buffer.from(pdfBytes), {
      contentType: 'application/pdf', upsert: false,
    })
    if (error) return null
    const { data: pub } = sb.storage.from('uploads').getPublicUrl(path)
    return pub.publicUrl
  } catch {
    return null
  }
}
