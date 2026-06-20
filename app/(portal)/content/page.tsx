'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import FileUpload from '@/components/shared/FileUpload'
import { Sparkles, Wand2, MessageSquare, Hash, Lightbulb, Copy, Save, Send, Trash2, Calendar, FileText } from 'lucide-react'
import { toast } from 'sonner'

const PLATFORMS = ['facebook', 'instagram', 'linkedin', 'tiktok', 'whatsapp', 'x']
const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok', whatsapp: 'WhatsApp', x: 'X (Twitter)' }

export default function ContentStudio() {
  const [tab, setTab] = useState<'studio' | 'library'>('studio')
  const [platform, setPlatform] = useState('facebook')
  const [brief, setBrief] = useState('')
  const [draft, setDraft] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [aiNotes, setAiNotes] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [posts, setPosts] = useState<any[]>([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  async function loadPosts() {
    setLoadingPosts(true)
    const d = await fetch('/api/content/posts').then(r => r.json()).catch(() => ({ posts: [] }))
    setPosts(d.posts || []); setLoadingPosts(false)
  }
  useEffect(() => { if (tab === 'library') loadPosts() }, [tab])

  async function runAI(task: string) {
    const input = task === 'write' || task === 'ideas' ? brief : draft
    if (!input.trim()) { toast.error(task === 'write' || task === 'ideas' ? 'Write a brief first' : 'Write or generate a draft first'); return }
    setBusy(task)
    try {
      const d = await fetch('/api/content/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, input, platform }),
      }).then(r => r.json())
      if (d.error) throw new Error(d.error)
      if (task === 'write' || task === 'improve') setDraft(d.result)
      else if (task === 'hashtags') setHashtags(d.result)
      else if (task === 'critique' || task === 'ideas' || task === 'image_brief') setAiNotes(d.result)
      toast.success('Done')
    } catch (e: any) { toast.error(e.message) }
    finally { setBusy('') }
  }

  async function save(status: string) {
    if (!draft.trim()) { toast.error('Nothing to save'); return }
    setBusy('save')
    try {
      const d = await fetch('/api/content/posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, platform, body: draft, hashtags, media_url: mediaUrl, ai_notes: aiNotes, status }),
      }).then(r => r.json())
      if (d.error) throw new Error(d.error)
      toast.success(status === 'scheduled' ? 'Scheduled' : 'Saved to library')
      setEditId(d.id)
    } catch (e: any) { toast.error(e.message) }
    finally { setBusy('') }
  }

  function copyAll() {
    const text = `${draft}${hashtags ? '\n\n' + hashtags : ''}`
    navigator.clipboard.writeText(text)
    toast.success('Copied — paste into ' + PLATFORM_LABEL[platform])
  }

  function loadPost(p: any) {
    setEditId(p.id); setPlatform(p.platform || 'facebook'); setDraft(p.body || '')
    setHashtags(p.hashtags || ''); setAiNotes(p.ai_notes || ''); setMediaUrl(p.media_url || '')
    setTab('studio'); toast.success('Loaded into studio')
  }

  async function del(id: string) {
    if (!confirm('Delete this post?')) return
    await fetch('/api/content/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    toast.success('Deleted'); loadPosts()
  }

  return (
    <div className="fade-in w-full max-w-4xl">
      <PageHeader eyebrow="Marketing" title="Content Studio"
        description="Draft posts, get AI feedback, plan your calendar. The AI knows our courses, fees and dates." />

      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('studio')} className={`text-sm font-medium px-4 h-9 rounded-lg ${tab === 'studio' ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>Studio</button>
        <button onClick={() => setTab('library')} className={`text-sm font-medium px-4 h-9 rounded-lg ${tab === 'library' ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>Library & Calendar</button>
      </div>

      {tab === 'studio' ? (
        <div className="space-y-4">
          {/* Platform picker */}
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => (
              <button key={p} onClick={() => setPlatform(p)} className={`text-xs font-medium px-3 h-8 rounded-lg ${platform === p ? 'bg-[var(--ink)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>{PLATFORM_LABEL[p]}</button>
            ))}
          </div>

          {/* Brief -> AI write */}
          <Card className="p-5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">What's the post about?</label>
            <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={2} placeholder="e.g. Promote the PMP April cohort — early-bird, limited seats"
              className={inputClass.replace('h-11', 'min-h-[60px] py-2.5') + ' mt-1.5 mb-3'} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => runAI('write')} disabled={!!busy} icon={<Wand2 size={14} />}>{busy === 'write' ? 'Writing…' : 'Write post'}</Button>
              <Button size="sm" variant="secondary" onClick={() => runAI('ideas')} disabled={!!busy} icon={<Lightbulb size={14} />}>{busy === 'ideas' ? 'Thinking…' : 'Give me ideas'}</Button>
            </div>
          </Card>

          {/* Draft editor */}
          <Card className="p-5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">Post draft</label>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={7} placeholder="Write your post here, or use 'Write post' above. Then get AI feedback."
              className={inputClass.replace('h-11', 'min-h-[150px] py-3') + ' mt-1.5 mb-3'} />
            {hashtags && <div className="text-xs text-[var(--accent)] mb-3 break-words">{hashtags}</div>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => runAI('critique')} disabled={!!busy} icon={<MessageSquare size={14} />}>{busy === 'critique' ? 'Reviewing…' : 'AI critique'}</Button>
              <Button size="sm" variant="secondary" onClick={() => runAI('improve')} disabled={!!busy} icon={<Sparkles size={14} />}>{busy === 'improve' ? 'Improving…' : 'Improve it'}</Button>
              <Button size="sm" variant="secondary" onClick={() => runAI('hashtags')} disabled={!!busy} icon={<Hash size={14} />}>{busy === 'hashtags' ? '…' : 'Hashtags'}</Button>
              <Button size="sm" variant="secondary" onClick={() => runAI('image_brief')} disabled={!!busy} icon={<Sparkles size={14} />}>{busy === 'image_brief' ? '…' : 'Image brief'}</Button>
            </div>
          </Card>

          {/* AI notes */}
          {aiNotes && (
            <Card className="p-5 bg-[var(--accent-soft)] border-[var(--accent)]/20">
              <div className="flex items-center gap-2 mb-2"><Sparkles size={15} className="text-[var(--accent)]" /><span className="text-sm font-semibold text-[var(--ink)]">AI feedback</span></div>
              <div className="text-sm text-[var(--ink-soft)] whitespace-pre-wrap">{aiNotes}</div>
            </Card>
          )}

          {/* Media + actions */}
          <Card className="p-5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">Image / graphic (optional)</label>
            <div className="mt-2 mb-4"><FileUpload onUploaded={setMediaUrl} value={mediaUrl} label="Upload visual" folder="cce/content" /></div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={copyAll} icon={<Copy size={14} />}>Copy for {PLATFORM_LABEL[platform]}</Button>
              <Button size="sm" variant="secondary" onClick={() => save('draft')} disabled={busy === 'save'} icon={<Save size={14} />}>Save draft</Button>
              <Button size="sm" variant="secondary" onClick={() => save('scheduled')} disabled={busy === 'save'} icon={<Calendar size={14} />}>Schedule</Button>
              {platform === 'whatsapp' && <p className="text-[11px] text-[var(--ink-faint)] w-full mt-1">WhatsApp broadcasting is available from the Broadcast page.</p>}
            </div>
            {platform !== 'whatsapp' && <p className="text-[11px] text-[var(--ink-faint)] mt-2">Copy the post and paste it into {PLATFORM_LABEL[platform]}. (Direct auto-posting needs platform setup — coming later.)</p>}
          </Card>
        </div>
      ) : (
        <ContentLibrary posts={posts} loading={loadingPosts} onLoad={loadPost} onDelete={del} />
      )}
    </div>
  )
}

function ContentLibrary({ posts, loading, onLoad, onDelete }: any) {
  if (loading) return <Spinner />
  if (!posts.length) return <EmptyState icon={<FileText size={20} />} title="No content yet" description="Drafts and scheduled posts you save will appear here." />
  const scheduled = posts.filter((p: any) => p.status === 'scheduled')
  const drafts = posts.filter((p: any) => p.status !== 'scheduled')
  return (
    <div className="space-y-6">
      {scheduled.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-3">Scheduled</p>
          <div className="space-y-2">{scheduled.map((p: any) => <PostRow key={p.id} p={p} onLoad={onLoad} onDelete={onDelete} />)}</div>
        </div>
      )}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-3">Drafts</p>
        <div className="space-y-2">{drafts.map((p: any) => <PostRow key={p.id} p={p} onLoad={onLoad} onDelete={onDelete} />)}</div>
      </div>
    </div>
  )
}

function PostRow({ p, onLoad, onDelete }: any) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onLoad(p)}>
          <div className="flex items-center gap-2 mb-1">
            {p.platform && <Badge tone="neutral">{p.platform}</Badge>}
            <Badge tone={p.status === 'scheduled' ? 'accent' : 'neutral'}>{p.status}</Badge>
          </div>
          <p className="text-sm text-[var(--ink-soft)] line-clamp-2">{p.body}</p>
        </div>
        <button onClick={() => onDelete(p.id)} className="p-1.5 text-[var(--ink-faint)] hover:text-red-500 flex-shrink-0"><Trash2 size={14} /></button>
      </div>
    </Card>
  )
}
