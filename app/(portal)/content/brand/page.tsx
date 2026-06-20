'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Spinner, EmptyState, Field, inputClass } from '@/components/ui'
import FileUpload from '@/components/shared/FileUpload'
import { Palette, Save, Trash2, ImageIcon, Copy } from 'lucide-react'
import { toast } from 'sonner'

export default function BrandKit() {
  const [profile, setProfile] = useState<any>({ voice: '', tagline: '', do_say: '', dont_say: '', primary_color: '#2f80d6' })
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
    const name = prompt('Name this asset (e.g. Primary logo)') || 'Asset'
    await fetch('/api/content/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_asset', url, name }) })
    toast.success('Asset added'); load()
  }
  async function delAsset(id: string) {
    if (!confirm('Remove this asset?')) return
    await fetch('/api/content/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_asset', id }) })
    load()
  }

  const set = (k: string, v: string) => setProfile((p: any) => ({ ...p, [k]: v }))

  if (loading) return <div className="p-8"><Spinner /></div>

  return (
    <div className="fade-in w-full max-w-2xl">
      <PageHeader eyebrow="Marketing" title="Brand kit"
        description="Set your voice and assets once. The AI uses these every time it writes, so all content stays on-brand." />

      <Card className="p-5 mb-5 space-y-4">
        <Field label="Brand voice">
          <textarea value={profile.voice || ''} onChange={e => set('voice', e.target.value)} rows={3}
            placeholder="How should we sound? e.g. Confident, aspirational, credible…"
            className={inputClass.replace('h-11', 'min-h-[80px] py-2.5')} />
        </Field>
        <Field label="Tagline">
          <input value={profile.tagline || ''} onChange={e => set('tagline', e.target.value)} className={inputClass} placeholder="Your signature line" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Words / phrases to use">
            <textarea value={profile.do_say || ''} onChange={e => set('do_say', e.target.value)} rows={2}
              className={inputClass.replace('h-11', 'min-h-[60px] py-2.5')} placeholder="globally recognised, career growth…" />
          </Field>
          <Field label="Words / phrases to avoid">
            <textarea value={profile.dont_say || ''} onChange={e => set('dont_say', e.target.value)} rows={2}
              className={inputClass.replace('h-11', 'min-h-[60px] py-2.5')} placeholder="cheap, guaranteed pass…" />
          </Field>
        </div>
        <Field label="Primary colour">
          <div className="flex items-center gap-3">
            <input type="color" value={profile.primary_color || '#2f80d6'} onChange={e => set('primary_color', e.target.value)} className="w-12 h-10 rounded-lg border border-[var(--line)] cursor-pointer" />
            <span className="text-sm text-[var(--ink-soft)]">{profile.primary_color}</span>
          </div>
        </Field>
        <Button onClick={save} disabled={saving} icon={<Save size={15} />}>{saving ? 'Saving…' : 'Save brand guidelines'}</Button>
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display font-semibold text-[var(--ink)]">Brand assets</h2>
        <div className="w-44"><FileUpload onUploaded={addAsset} label="Add logo / graphic" folder="cce/brand" /></div>
      </div>

      {assets.length === 0 ? (
        <EmptyState icon={<ImageIcon size={20} />} title="No assets yet" description="Upload your logos and approved graphics so the team always uses the right files." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {assets.map(a => (
            <Card key={a.id} className="p-3">
              <div className="aspect-square rounded-lg bg-[var(--canvas)] overflow-hidden mb-2 flex items-center justify-center">
                <img src={a.url} alt={a.name} className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs text-[var(--ink-soft)] truncate">{a.name}</span>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => { navigator.clipboard.writeText(a.url); toast.success('Link copied') }} className="p-1 text-[var(--ink-faint)] hover:text-[var(--accent)]"><Copy size={13} /></button>
                  <button onClick={() => delAsset(a.id)} className="p-1 text-[var(--ink-faint)] hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
