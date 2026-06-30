'use client'
import { useState } from 'react'
import { useData, mutate, mutateDelete } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState } from '@/components/ui'
import { Quote, Copy, Trash2, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { CONFIG } from '@/lib/config'

export default function TestimonialsPage() {
  const { data: items, loading, refetch } = useData<any>({ table: 'testimonials', select: '*', orderBy: 'created_at', orderAsc: false, limit: 500 })

  const collectionLink = `${CONFIG.appUrl}/testimonial/submit`

  async function toggle(t: any, field: string) {
    try { await mutate('PATCH', 'testimonials', { [field]: !t[field] }, [{ col: 'id', val: t.id }]); refetch() }
    catch { toast.error('Failed') }
  }

  async function remove(id: string) {
    if (!confirm('Delete this testimonial?')) return
    try { await mutateDelete('testimonials', [{ col: 'id', val: id }]); toast.success('Deleted'); refetch() }
    catch { toast.error('Failed') }
  }

  function copyText(t: any) {
    const text = `"${t.quote}"\n— ${t.student_name}${t.role_title ? `, ${t.role_title}` : ''}${t.program_name ? ` (${t.program_name})` : ''}`
    navigator.clipboard.writeText(text); toast.success('Testimonial copied — ready to share')
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Visibility"
        title="Testimonials"
        description="Send the collection link to students who've completed. They fill in their own words and photo, and it appears here automatically."
      />

      {/* Collection link */}
      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          
          <span className="text-[12px] font-semibold text-[var(--accent)]">Testimonial collection link</span>
        </div>
        <p className="text-sm text-[var(--ink-soft)] mb-3">Copy this and send it to any student who has completed. They submit their testimonial themselves — it shows up below.</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-[var(--line-soft)] border border-[var(--line)] rounded-lg px-4 py-2.5 text-sm text-[var(--ink-soft)] font-mono break-all">{collectionLink}</div>
          <button onClick={() => { navigator.clipboard.writeText(collectionLink); toast.success('Collection link copied') }}
            className="flex-shrink-0 p-2.5 bg-[var(--accent)] text-white rounded-lg hover:brightness-110 transition"></button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`We'd love your feedback on your programme at Cambridge Centre of Excellence. Share your testimonial here: ${collectionLink}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="flex-shrink-0 h-[42px] px-4 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center">WhatsApp</a>
        </div>
      </Card>

      {loading ? <Spinner /> : items.length === 0 ? (
        <EmptyState  title="No testimonials yet"
          description="Share the collection link above. When students submit, their testimonials appear here." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((t: any) => (
            <Card key={t.id} className="p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                {t.image_url ? (
                  <img src={t.image_url} alt={t.student_name} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center font-semibold">{(t.student_name || '?')[0]}</div>
                )}
                <div className="min-w-0">
                  <div className="font-medium text-[var(--ink)] truncate">{t.student_name}</div>
                  {t.role_title && <div className="text-[12px] text-[var(--ink-soft)] truncate">{t.role_title}</div>}
                  {t.program_name && <div className="text-[12px] text-[var(--ink-faint)]">{t.program_name}</div>}
                </div>
              </div>
              <p className="text-sm text-[var(--ink-soft)] flex-1 mb-3">"{t.quote}"</p>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => toggle(t, 'approved')} className={`text-[12px] font-medium px-2.5 py-1 rounded-full ring-1 ring-inset transition ${t.approved ? 'bg-[var(--ok-soft)] text-[var(--ok)] ring-emerald-200' : 'bg-[var(--line-soft)] text-[var(--ink-soft)] ring-[var(--line)]'}`}>{t.approved ? 'Approved' : 'Approve'}</button>
                <button onClick={() => toggle(t, 'shared')} className={`text-[12px] font-medium px-2.5 py-1 rounded-full ring-1 ring-inset transition ${t.shared ? 'bg-[var(--accent-soft)] text-[var(--accent)] ring-[var(--accent)]/20' : 'bg-[var(--line-soft)] text-[var(--ink-soft)] ring-[var(--line)]'}`}>{t.shared ? 'Shared' : 'Mark shared'}</button>
                <button onClick={() => copyText(t)} title="Copy text" className="p-1.5 text-[var(--ink-faint)] hover:text-[var(--accent)]"></button>
                <button onClick={() => remove(t.id)} className="ml-auto p-1.5 text-[var(--ink-faint)] hover:text-[var(--danger)]"></button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
