import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText, sendWhatsAppMedia } from '@/lib/integrations/whatsapp'
import { claimJob, markSent } from '@/lib/messageJobs'
import { findCourse } from '@/lib/courseMatch'
import { resolveBrochure } from '@/lib/documents/resolve'
import { recordEvent } from '@/lib/chatbot/events'

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
    /*
     * ── THIS WAS THE LAST PLACE THAT IMPERSONATED A MARKETER ─────────────
     *
     * It read "Hi Ama, this is Ruth from Cambridge Center of Excellence" — a
     * message Ruth had never written or seen, and for most leads the FIRST
     * message they ever receive, because autoAssign returns early when the
     * welcome pack sends and the pack becomes the opening.
     *
     * So every rule the assistant follows about not posing as a colleague was
     * being undone by the message that arrived before it. It says what it is
     * now, and still says who is looking after them.
     */
    const helper = mName === 'Cambridge'
      ? `I'm Cambridge Center of Excellence's virtual assistant`
      : `I'm the virtual assistant supporting ${mName}, who is handling your enquiry`
    const hello = `Hi ${first}, this is Cambridge Center of Excellence. ${helper}. I saw you showed interest in ${courseLabel}, so let me share our gallery and the ${course?.name || 'course'} brochure for you to look through.`
    const ok = await sendWhatsAppText(opts.phone, hello, opts.marketerId || null)
    await markSent(helloKey, ok)
    if (!ok) return { sent: false }
    await recordEvent({ leadId: opts.leadId, event: 'CHAT_STARTED', detail: courseLabel })
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
    const url = await resolveBrochure(course?.id || null, null)
    if (url) {
      const ok = await sendWhatsAppMedia(opts.phone, `Everything about ${courseLabel} is in here.`, url, opts.marketerId || null)
      await markSent(brochureKey, ok)
      if (ok) {
        await sb.from('lead_sends').upsert({ lead_id: opts.leadId, kind: 'brochure' }, { onConflict: 'lead_id,kind' }).then(() => {}, () => {})
        /*
         * Recorded, so the assistant knows it has already gone.
         *
         * lib/chatbot/events derives the conversation stage from these, and
         * without this one the welcome pack would send the brochure and the
         * assistant would go on offering it as though it never had.
         */
        await recordEvent({ leadId: opts.leadId, event: 'BROCHURE_SENT', detail: courseLabel })
      }
    } else {
      await markSent(brochureKey, false)
    }
  }

  return { sent: true }
}
