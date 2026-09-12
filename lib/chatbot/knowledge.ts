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

export { longDate, ghs, hasFacts } from '@/lib/chatbot/format'
export type { KnowledgeBlocks, KnowledgeCounts } from '@/lib/chatbot/format'

import type { KnowledgeBlocks } from '@/lib/chatbot/format'
import type { LoadResult } from '@/lib/chatbot/programme'

type KbRow = { kind?: string | null; category?: string | null; question?: string | null; answer?: string | null }

/**
 * Read the three sources and assemble them.
 *
 * A failed read is not the same as an empty table, and the difference matters:
 * with no knowledge the assistant must stop answering questions of fact rather
 * than fall back on what the model happens to believe about a training centre
 * in Ghana. `counts` is how the caller tells them apart.
 */
export async function loadKnowledge(): Promise<LoadResult<KnowledgeBlocks>> {
  const sb = createServiceClient()
  // courses and batches stay at zero here: lib/chatbot/programme owns them.
  const counts = { info: 0, faqs: 0, courses: 0, batches: 0 }
  const parts: string[] = []

  const { data: kb, error: kbErr } = await sb.from('knowledge_base')
    .select('kind, category, question, answer')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(200)

  /*
   * A failed read is not an empty knowledge base.
   *
   * Returning empty blocks here would tell the caller the centre has written
   * nothing down, which is a legitimate state it handles by answering from
   * programme records alone. An unreadable table is not that, and the
   * assistant must not carry on as though it were.
   */
  if (kbErr) {
    console.error('[chatbot] knowledge_base unreadable:', kbErr.message)
    return { ok: false, error: kbErr.message }
  }

  const rows: KbRow[] = kb || []
  const infos = rows.filter(k => k.kind === 'info' && k.answer)
  const faqs = rows.filter(k => k.kind === 'faq' && k.question && k.answer)
  counts.info = infos.length
  counts.faqs = faqs.length

  if (infos.length) {
    parts.push('ABOUT THE CENTRE:\n' + infos
      .map(i => `- ${i.category ? `[${i.category}] ` : ''}${i.answer}`).join('\n'))
  }

  /*
   * ── COURSES AND COHORTS ARE NOT READ HERE ANY MORE ─────────────────────
   *
   * This block used to load them, and it selected `courses.price` — a column
   * nothing in this application writes, and which the Course interface does
   * not declare. PostgREST fails the whole select on a missing column, so it
   * returned either nothing or a field nobody populates: no fee reached the
   * model from here, ever, while the prompt told it to quote fees "only from
   * the facts below".
   *
   * Fixing the field was not enough, because it was also a second source of
   * the same truth. lib/chatbot/programme now owns programmes and cohorts,
   * reads the canonical course_fee, and states an absent fee as absent rather
   * than leaving it out. Two loaders would let the programme block say
   * "Fee: GHS 2,500" while this one listed the same programme with no fee
   * beside it — and a contradiction in the context is worse than a gap.
   *
   * So this file is the centre's OWN knowledge and nothing else: what it has
   * written down about itself. Programme facts come from the programme.
   */

  if (faqs.length) {
    parts.push('COMMON QUESTIONS:\n' + faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n'))
  }

  return { ok: true, data: { text: parts.join('\n\n'), counts } }
}
