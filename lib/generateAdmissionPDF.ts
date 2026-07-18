import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { createServiceClient } from '@/lib/supabase/server'

/** Brand teal */
const TEAL = rgb(0.102, 0.478, 0.522)      // #1a7a85
const INK = rgb(0.102, 0.133, 0.188)       // #1a2230
const SOFT = rgb(0.353, 0.400, 0.459)      // #5a6675
const FAINT = rgb(0.592, 0.631, 0.690)     // #97a1b0
const PANEL = rgb(0.941, 0.969, 0.972)     // #f0f7f8

interface LetterData {
  name: string
  course: string
  admissionNo: string
  startDate?: string
  delivery?: string
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
    page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: TEAL })
    page.drawText('CAMBRIDGE CENTER OF EXCELLENCE', {
      x: 40, y: height - 58, size: 18, font: bold, color: rgb(1, 1, 1),
    })
    page.drawText('LETTER OF ADMISSION', {
      x: 40, y: height - 82, size: 11, font: helv, color: rgb(0.749, 0.890, 0.902),
    })

    let y = height - 150
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    page.drawText(today, { x: 40, y, size: 10, font: helv, color: SOFT })

    y -= 40
    page.drawText(`Dear ${data.name},`, { x: 40, y, size: 12, font: bold, color: INK })

    y -= 26
    const intro = 'Following the successful completion of your registration, we are delighted to formally'
    const intro2 = 'offer you admission into the following programme at Cambridge Center of Excellence:'
    page.drawText(intro, { x: 40, y, size: 11, font: serif, color: INK })
    y -= 16
    page.drawText(intro2, { x: 40, y, size: 11, font: serif, color: INK })

    // ── Details panel ──
    y -= 30
    const panelH = data.startDate ? 108 : 88
    page.drawRectangle({ x: 40, y: y - panelH, width: width - 80, height: panelH, color: PANEL })
    page.drawRectangle({ x: 40, y: y - panelH, width: 4, height: panelH, color: TEAL })

    let py = y - 24
    const row = (label: string, value: string) => {
      page.drawText(label, { x: 60, y: py, size: 10, font: helv, color: SOFT })
      page.drawText(value, { x: 200, y: py, size: 11, font: bold, color: INK })
      py -= 22
    }
    row('Admission Number', data.admissionNo || '—')
    row('Programme', data.course)
    row('Candidate', data.name)
    if (data.startDate) row('Start Date', data.startDate)

    // ── Body ──
    y = y - panelH - 30
    const body = [
      'Your registration fee has been received. Our team will be in touch shortly with your',
      'class schedule, learning materials, and joining details. Please keep your admission',
      'number safe — you will need it for all correspondence.',
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
