'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Spinner, EmptyState, Field, inputClass, textareaClass} from '@/components/ui'
import FileUpload from '@/components/shared/FileUpload'
import { Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { RemoteImage } from '@/components/shared/RemoteImage'
import { postJson, messageFor } from '@/lib/api/post'

export default function BrandKit() {
  const { confirm, ask, dialog } = useConfirm()
  const [profile, setProfile] = useState<any>({ voice: '', tagline: '', do_say: '', dont_say: '', primary_color: 'var(--accent)' })
  const [assets, setAssets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const d = await fetch('/api/content/brand').then(r => r.json()).catch(() => ({}))
    if (d.profile) setProfile(d.profile)
    setAssets(d.assets || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function save() {
    setSaving(true)
    try {
      const d = await fetch('/api/content/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) }).then(r => r.json())
      if (d.error) throw new Error(d.error)
      toast.success('Brand guidelines saved — the AI now uses these')
    } catch (e: any) { toast.error(e.message) } finally { setSaving(false) }
  }

  async function addAsset(url: string) {
    const typed = await ask({
      title: 'Name this asset',
      confirmLabel: 'Add asset',
      input: { label: 'Asset name', placeholder: 'e.g. Primary logo' },
    })
    // Cancelled — the upload is not recorded rather than filed as "Asset".
    if (typed === null) return
    const name = typed.trim() || 'Asset'
    // The file has already been uploaded by this point; this is the record of
    // it. Announcing "Asset added" without reading the response meant a
    // brand kit that looked complete and an asset the AI could never use.
    try {
      await postJson('/api/content/brand', { action: 'add_asset', url, name },
        { fallback: 'That asset could not be added to the brand kit.' })
      toast.success('Asset added')
    } catch (e) {
      toast.error(messageFor(e, 'That asset could not be added to the brand kit.'))
    }
    load()
  }
  async function delAsset(id: string) {
    if (!await confirm({
      title: 'Remove this asset?',
      message: 'It is removed from the brand kit. Anything already published using it is unaffected.',
      confirmLabel: 'Remove asset',
    })) return
    try {
      await postJson('/api/content/brand', { action: 'delete_asset', id },
        { fallback: 'That asset could not be removed.' })
    } catch (e) {
      toast.error(messageFor(e, 'That asset could not be removed.'))
    }
    load()
  }

  const set = (k: string, v: string) => setProfile((p: any) => ({ ...p, [k]: v }))

  if (loading) return <div className="p-8"><Spinner /></div>

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {dialog}
      <PageHeader eyebrow="Marketing" title="Brand kit"
        description="Set your voice and assets once. The AI uses these every time it writes, so all content stays on-brand." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* LEFT: brand guidelines */}
        <Card className="p-6 space-y-4">
          <Field label="Brand voice">
            <textarea value={profile.voice || ''} onChange={e => set('voice', e.target.value)} rows={3}
              placeholder="How should we sound? e.g. Confident, aspirational, credible…"
              className={textareaClass} />
          </Field>
          <Field label="Tagline">
            <input value={profile.tagline || ''} onChange={e => set('tagline', e.target.value)} className={inputClass} placeholder="Your signature line" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Words / phrases to use">
              <textarea value={profile.do_say || ''} onChange={e => set('do_say', e.target.value)} rows={3}
                className={textareaClass} placeholder="globally recognised, career growth…" />
            </Field>
            <Field label="Words / phrases to avoid">
              <textarea value={profile.dont_say || ''} onChange={e => set('dont_say', e.target.value)} rows={3}
                className={textareaClass} placeholder="cheap, guaranteed pass…" />
            </Field>
          </div>
          <Field label="Primary colour">
            <div className="flex items-center gap-3">
              <input type="color" value={profile.primary_color || 'var(--accent)'} onChange={e => set('primary_color', e.target.value)} className="w-12 h-10 rounded-lg border border-[var(--line)] cursor-pointer" />
              <span className="text-sm text-[var(--ink-soft)]">{profile.primary_color}</span>
            </div>
          </Field>
          <Button onClick={save} disabled={saving} >{saving ? 'Saving…' : 'Save brand guidelines'}</Button>
        </Card>

        {/* RIGHT: brand assets */}
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display font-semibold text-[var(--ink)] text-[15px]">Brand assets</h2>
            <div className="w-44"><FileUpload onUploaded={addAsset} label="Add logo / graphic" folder="cce/brand" /></div>
          </div>

          {assets.length === 0 ? (
            <EmptyState  title="No assets yet" description="Upload your logos and approved graphics so the team always uses the right files." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {assets.map(a => (
                <Card key={a.id} className="p-3">
                  <div className="aspect-square rounded-lg bg-[var(--canvas)] overflow-hidden mb-2 flex items-center justify-center">
                    <RemoteImage src={a.url} alt={a.name} className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs text-[var(--ink-soft)] truncate">{a.name}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      <button type="button" onClick={() => { navigator.clipboard.writeText(a.url); toast.success('Link copied') }} className="p-1 text-[var(--ink-faint)] hover:text-[var(--accent)]" aria-label="Copy"><Copy size={15} aria-hidden="true" /></button>
                      <button type="button" onClick={() => delAsset(a.id)} className="p-1 text-[var(--ink-faint)] hover:text-[var(--danger)]" aria-label="Delete"><Trash2 size={15} aria-hidden="true" /></button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
