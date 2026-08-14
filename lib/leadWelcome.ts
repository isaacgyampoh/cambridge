import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText, sendWhatsAppMedia } from '@/lib/integrations/whatsapp'
import { claimJob, markSent } from '@/lib/messageJobs'
import { findCourse, findBrochure } from '@/lib/courseMatch'

/**
 * What a new lead receives: a short hello, then the gallery, then the brochure
 * for the course they actually asked about.
 *
 * Each piece is claimed before sending, so a retry or a second run cannot send
 * anything twice, and lead_sends records what has gone out so a later
 * follow-up knows not to repeat it.
 */
export async function sendWelcomePack(opts: {
  leadId: string
  phone: string
  leadName?: string | null
  courseInterest?: string | null
  marketerId?: string | null
  marketerName?: string | null
}) {
  const sb = createServiceClient()
  const first = (opts.leadName || '').split(' ')[0] || 'there'
  const mName = (opts.marketerName || '').split(' ')[0] || 'Cambridge'

  // Which course, and does it have its own brochure?
  const course = await findCourse(opts.courseInterest)

  const courseLabel = course?.name || opts.courseInterest || 'our programmes'

  // 1) Hello, saying what is coming — so the files are expected, not a surprise.
  const helloKey = `welcome_hello:${opts.leadId}`
  if (await claimJob({ dedupeKey: helloKey, leadId: opts.leadId, phone: opts.phone, kind: 'welcome_hello' })) {
    const hello = `Hi ${first}, this is ${mName} from Cambridge Center of Excellence. I saw you showed interest in ${courseLabel}. Before we start, let me share our gallery and the ${course?.name || 'course'} brochure so you can have a look.`
    const ok = await sendWhatsAppText(opts.phone, hello, opts.marketerId || null)
    await markSent(helloKey, ok)
    if (!ok) return { sent: false }
    await new Promise(r => setTimeout(r, 6000 + Math.random() * 4000))
  }

  // 2) The gallery.
  const galleryKey = `welcome_gallery:${opts.leadId}`
  if (await claimJob({ dedupeKey: galleryKey, leadId: opts.leadId, phone: opts.phone, kind: 'gallery' })) {
    const { data: gallery } = await sb.from('documents')
      .select('file_url, name').eq('is_gallery', true).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (gallery?.file_url) {
      const ok = await sendWhatsAppMedia(opts.phone, 'A look at our centre and past classes.', gallery.file_url, opts.marketerId || null)
      await markSent(galleryKey, ok)
      if (ok) {
        await sb.from('lead_sends').upsert({ lead_id: opts.leadId, kind: 'gallery' }, { onConflict: 'lead_id,kind' }).then(() => {}, () => {})
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 4000))
      }
    } else {
      await markSent(galleryKey, false)
    }
  }

  // 3) The brochure for THEIR course. A general one only if there is no
  //    course-specific brochure — never instead of one.
  const brochureKey = `welcome_brochure:${opts.leadId}`
  if (await claimJob({ dedupeKey: brochureKey, leadId: opts.leadId, phone: opts.phone, kind: 'brochure' })) {
    const url = await findBrochure(course?.id || null)
    if (url) {
      const ok = await sendWhatsAppMedia(opts.phone, `Everything about ${courseLabel} is in here.`, url, opts.marketerId || null)
      await markSent(brochureKey, ok)
      if (ok) {
        await sb.from('lead_sends').upsert({ lead_id: opts.leadId, kind: 'brochure' }, { onConflict: 'lead_id,kind' }).then(() => {}, () => {})
      }
    } else {
      await markSent(brochureKey, false)
    }
  }

  return { sent: true }
}
