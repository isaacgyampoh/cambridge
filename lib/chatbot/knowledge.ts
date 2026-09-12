import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Everything the chatbot is allowed to say, assembled from the live system.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 *
 * It was built inline inside the reply generator, which meant the single most
 * important property of this product — that the assistant states fees, dates
 * and venues ONLY from real records — could not be tested without calling a
 * language model. It is a pure assembly of database rows into text, so it is
 * separated and covered directly.
 *
 * Three sources, in the order a person asks about them:
 *
 *   knowledge_base  what the centre has written down about itself
 *   courses         the programmes and what they actually cost
 *   batches         the cohorts actually scheduled, with real dates
 *
 * Nothing else. If a fact is not here, the assistant says it will check —
 * see lib/chatbot/persona.
 */

export {
  longDate, ghs, courseLine, batchLine, hasFacts,
} from '@/lib/chatbot/format'
export type {
  KnowledgeBlocks, KnowledgeCounts, CourseRow, BatchRow,
} from '@/lib/chatbot/format'

import { courseLine, batchLine, type KnowledgeBlocks, type CourseRow, type BatchRow } from '@/lib/chatbot/format'

type KbRow = { kind?: string | null; category?: string | null; question?: string | null; answer?: string | null }

/**
 * Read the three sources and assemble them.
 *
 * A failed read is not the same as an empty table, and the difference matters:
 * with no knowledge the assistant must stop answering questions of fact rather
 * than fall back on what the model happens to believe about a training centre
 * in Ghana. `counts` is how the caller tells them apart.
 */
export async function loadKnowledge(): Promise<KnowledgeBlocks> {
  const sb = createServiceClient()
  const counts = { info: 0, faqs: 0, courses: 0, batches: 0 }
  const parts: string[] = []

  const { data: kb, error: kbErr } = await sb.from('knowledge_base')
    .select('kind, category, question, answer')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(200)
  if (kbErr) console.error('[chatbot] knowledge_base unreadable:', kbErr.message)

  const rows: KbRow[] = kb || []
  const infos = rows.filter(k => k.kind === 'info' && k.answer)
  const faqs = rows.filter(k => k.kind === 'faq' && k.question && k.answer)
  counts.info = infos.length
  counts.faqs = faqs.length

  if (infos.length) {
    parts.push('ABOUT THE CENTRE:\n' + infos
      .map(i => `- ${i.category ? `[${i.category}] ` : ''}${i.answer}`).join('\n'))
  }

  const { data: courses, error: cErr } = await sb.from('courses')
    .select('name, code, price, duration')
    .eq('is_active', true).order('name').limit(50)
  if (cErr) console.error('[chatbot] courses unreadable:', cErr.message)
  if (courses?.length) {
    counts.courses = courses.length
    parts.push('OUR PROGRAMMES AND FEES:\n' + (courses as CourseRow[]).map(courseLine).join('\n'))
  }

  const { data: batches, error: bErr } = await sb.from('batches')
    .select('name, class_type, status, start_date, schedule, venue, courses(name)')
    .in('status', ['upcoming', 'ongoing'])
    .order('start_date', { ascending: true }).limit(20)
  if (bErr) console.error('[chatbot] batches unreadable:', bErr.message)
  if (batches?.length) {
    counts.batches = batches.length
    parts.push('CLASSES RUNNING OR STARTING SOON:\n'
      + (batches as unknown as BatchRow[]).map(batchLine).join('\n'))
  }

  if (faqs.length) {
    parts.push('COMMON QUESTIONS:\n' + faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n'))
  }

  return { text: parts.join('\n\n'), counts }
}
