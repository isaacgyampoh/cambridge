'use client'
import { uploadFile } from '@/lib/upload'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Spinner, EmptyState, inputClass } from '@/components/ui'
import { CONFIG } from '@/lib/config'
import { BRAND } from '@/lib/brand'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'

const COURSES = ['Projects Management Professional','Corporate Training','Professional in Human Resources','Senior Professional in Human Resources','Software Agile Projects Management','Results-Based Monitoring and Evaluation']

export default function MyFlyers() {
  const { confirm, dialog } = useConfirm()
  const [flyers, setFlyers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState({ title: '', course: '' })
  const [preview, setPreview] = useState<string>('')

  async function load() {
    try {
      const res = await fetch('/api/flyers')
      const d = await res.json().catch(() => ({ flyers: [] }))
      setFlyers(d.flyers || [])
    } catch {
      setFlyers([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return }
    setUploading(true)
    try {
      const up = await uploadFile(file, 'flyers')
      // save flyer
      const saveRes = await fetch('/api/flyers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, course: form.course, image_url: up.url }),
      })
      const d = await saveRes.json().catch(() => ({ error: 'Could not save the flyer. Please try again.' }))
      if (d.flyer) { toast.success('Flyer uploaded! Your link is ready to share.'); setForm({ title: '', course: '' }); setPreview(''); load() }
      else toast.error(d.error || 'Could not save flyer')
    } catch (err: any) { toast.error(err.message || 'Upload failed') }
    finally { setUploading(false) }
  }

  async function remove(id: string) {
    if (!await confirm({
      title: 'Delete this flyer?',
      message: 'Its link stops working immediately, and anyone who already has it will see nothing.',
      confirmLabel: 'Delete flyer',
    })) return
    await fetch('/api/flyers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  function linkFor(id: string) { return `${CONFIG.appUrl}/f/${id}` }
  function copy(id: string) { navigator.clipboard.writeText(linkFor(id)); toast.success('Flyer link copied') }

  /*
   * Share one flyer.
   *
   * The message carries the link and nothing else of substance, because the
   * LINK now carries the flyer: /f/{id} serves Open Graph metadata naming the
   * flyer image, so WhatsApp and Facebook render the flyer itself as the
   * preview. Repeating the details in the text would only compete with it.
   */
  async function shareFlyer(f: { id: string; title?: string | null; course?: string | null }) {
    const url = linkFor(f.id)
    const title = f.title || f.course || `Training at ${BRAND.shortName}`

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title,
          text: `${title} — ${BRAND.name}. Tap to see the programme and apply.`,
          url,
        })
        return
      } catch {
        // Includes the person dismissing the sheet, which is not a failure.
        return
      }
    }
    copy(f.id)
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {dialog}
      <PageHeader eyebrow="My work" title="My flyers"
        description="Upload your flyer, get your own link, and share it. Anyone who opens it can register or ask questions — and they become your lead." />

      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5 items-start">
        {/* Upload */}
        <Card className="p-6">
          <h3 className="font-display text-[15px] font-semibold text-[var(--ink)] mb-4">Upload a flyer</h3>
          <div className="space-y-3">
            <input className={inputClass} placeholder="Title (e.g. PMP March Intake)" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <select className={inputClass} value={form.course} onChange={e => setForm(f => ({ ...f, course: e.target.value }))}>
              <option value="">Course on the flyer (optional)</option>
              {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className={`block w-full ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
              <div className="border-2 border-dashed border-[var(--line)] rounded-xl py-8 text-center cursor-pointer hover:border-[var(--accent)] transition">
                <p className="text-[14px] font-medium text-[var(--accent)]">{uploading ? 'Uploading…' : 'Tap to choose flyer image'}</p>
                <p className="text-[12px] text-[var(--ink-faint)] mt-1">JPG or PNG</p>
              </div>
              <input type="file" accept="image/*" onChange={onFile} className="hidden" disabled={uploading} />
            </label>
          </div>
          <p className="text-[12px] text-[var(--ink-faint)] mt-4 leading-relaxed">Post the flyer image on WhatsApp status, Instagram, or TikTok, and put your link beside it. When someone taps the link, they see your flyer and a sign-up — and become your lead.</p>
        </Card>

        {/* Gallery */}
        <div>
          {loading ? <Spinner /> : flyers.length === 0 ? (
            <EmptyState title="No flyers yet" description="Upload your first flyer on the left to get a shareable link tied to you." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {flyers.map(f => (
                <Card key={f.id} className="p-0 overflow-hidden">
                  <img src={f.image_url} alt={f.title || 'Flyer'} className="w-full h-44 object-cover" />
                  <div className="p-4">
                    <div className="font-medium text-[var(--ink)] text-[15px]">{f.title || 'Flyer'}</div>
                    {f.course && <div className="text-[13px] text-[var(--ink-faint)]">{f.course}</div>}
                    <div className="flex gap-4 mt-2 text-[13px] text-[var(--ink-soft)]">
                      <span>{f.clicks || 0} views</span>
                      <span>{f.leads || 0} leads</span>
                    </div>
                    {/* Same treatment as the card above: the phone's own
                        share sheet, not a hardcoded WhatsApp button. */}
                    <div className="flex gap-2 mt-3">
                      <button type="button" onClick={() => copy(f.id)}
                        className="flex-1 h-11 sm:h-9 rounded-lg bg-[var(--accent)]
                          text-[var(--accent-ink)] text-[13px] font-semibold
                          hover:bg-[var(--accent-hover)] transition-colors">
                        Copy link
                      </button>
                      <button type="button" onClick={() => shareFlyer(f)}
                        className="flex-1 h-11 sm:h-9 rounded-lg border border-[var(--line)]
                          text-[var(--ink)] text-[13px] font-semibold
                          hover:bg-[var(--canvas)] transition-colors">
                        Share
                      </button>
                      <button type="button" onClick={() => remove(f.id)}
                        aria-label={`Delete ${f.title || 'this flyer'}`}
                        className="h-11 sm:h-9 px-3 rounded-lg border border-[var(--line)]
                          text-[13px] text-[var(--danger)] hover:bg-[var(--danger-soft)]
                          transition-colors">
                        Delete
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
