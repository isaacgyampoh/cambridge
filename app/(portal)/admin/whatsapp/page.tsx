'use client'
import { useCallback, useEffect, useState } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { useData, mutate } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, Field, inputClass } from '@/components/ui'
import { X, RefreshCw } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'
import type { Profile } from '@/types'

/**
 * WhatsApp lines, with their REAL status from WasenderAPI.
 *
 * ── WHAT WAS WRONG HERE ────────────────────────────────────────────────────
 *
 * This screen read `wasender_api_key` to decide what to show — but the data
 * layer rightly never sends a secret to the browser; it sends
 * `has_wasender_key` instead. So the key always looked absent: every line said
 * "Connect", and the per-line Test button never rendered at all.
 *
 * That left one test: "Test connection" at the top, which used the server's
 * own WASENDER_API_KEY — not the key entered here. When that environment key
 * belonged to an old or deleted session, WasenderAPI answered "invalid API
 * key", however correct the key entered on this screen was.
 *
 * And a saved line showed "Connecting" because this screen wrote that word
 * itself on save. Status now comes from WasenderAPI, read live.
 */

type LiveLine = {
  id: string; name: string; number: string | null; key: string | null
  status: string | null; label: string; tone: 'success' | 'warning' | 'danger' | 'muted'
  message: string; kind: string | null
}
type Live = {
  central: { configured: boolean; key: string | null; label: string; tone: LiveLine['tone']; message: string; status: string | null }
  lines: LiveLine[]
  checkedAt: string
}

type StaffRow = Profile & { has_wasender_key?: boolean }

export default function WhatsAppLinesPage() {
  const { data: staff, loading, refetch } = useData<StaffRow>({
    table: 'profiles', select: 'id, full_name, role, phone, wasender_api_key, wasender_status, wasender_phone, wa_intro',
    filters: [{ col: 'is_active', op: 'eq', val: true }],
    orderBy: 'full_name', limit: 200,
  })

  const [live, setLive] = useState<Live | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [form, setForm] = useState({ apiKey: '', number: '', intro: '' })
  const [saving, setSaving] = useState(false)

  const [tester, setTester] = useState<{ open: boolean; staffId: string; phone: string; busy: null | 'check' | 'send'; result: { ok: boolean; text: string } | null }>(
    { open: false, staffId: '', phone: '', busy: null, result: null })

  /** Ask WasenderAPI, now, about every line. */
  const checkAll = useCallback(async () => {
    setChecking(true); setLiveError(null)
    try {
      const res = await fetch('/api/whatsapp/status')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not check WasenderAPI.')
      setLive(d)
      refetch()
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Could not check WasenderAPI.')
    } finally { setChecking(false) }
  }, [refetch])

  useEffect(() => { checkAll() }, [checkAll])

  const liveById = new Map((live?.lines || []).map(l => [l.id, l]))

  function open(s: StaffRow) {
    setEditing(s)
    setForm({ apiKey: '', number: s.wasender_phone || displayPhone(s.phone) || '', intro: s.wa_intro || '' })
  }

  async function save() {
    if (!editing) return
    if (!form.apiKey.trim() && !editing.has_wasender_key) { toast.error('Paste the WhatsApp session’s API key from WasenderAPI.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/whatsapp/instance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: editing.id, apiKey: form.apiKey.trim() || undefined, number: form.number }),
      })
      const d = await res.json()
      // The key is checked against WasenderAPI before it is saved; a refusal
      // says why — including a Personal Access Token pasted by mistake.
      if (!res.ok) { toast.error(d.error || 'Could not save', { duration: 12000 }); return }
      await mutate('PATCH', 'profiles', { wa_intro: form.intro || null }, [{ col: 'id', val: editing.id }])
      toast.success(d.message || 'WhatsApp line saved', { duration: 8000 })
      setEditing(null)
      checkAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally { setSaving(false) }
  }

  async function checkLine(staffId: string) {
    toast.loading('Asking WasenderAPI…', { id: `line-${staffId}` })
    try {
      const res = await fetch('/api/whatsapp/instance', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId }),
      })
      const d = await res.json()
      if (d.success) toast.success(`Connected. ${d.message}`, { id: `line-${staffId}` })
      else toast.error(d.error || `${d.label}: ${d.message}`, { id: `line-${staffId}`, duration: 12000 })
      checkAll()
    } catch {
      toast.error('Unable to reach the server.', { id: `line-${staffId}` })
    }
  }

  async function runTest(action: 'check' | 'send') {
    if (!tester.phone.trim()) { toast.error('Enter a phone number.'); return }
    setTester(t => ({ ...t, busy: action, result: null }))
    try {
      const res = await fetch('/api/whatsapp/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: tester.phone.trim(), action, staffId: tester.staffId || null }),
      })
      const d = await res.json()
      setTester(t => ({ ...t, result: { ok: !!d.ok, text: d.ok ? `${d.message} (Used ${d.via}.)` : `${d.error}${d.via ? ` (Used ${d.via}.)` : ''}` } }))
    } catch {
      setTester(t => ({ ...t, result: { ok: false, text: 'Unable to reach the server.' } }))
    } finally {
      setTester(t => ({ ...t, busy: null }))
    }
  }

  const lines = staff.filter(s => s.has_wasender_key)
  const connected = (live?.lines || []).filter(l => l.status === 'connected').length

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Messaging"
        title="WhatsApp lines"
        description="Each line is a WhatsApp session in WasenderAPI. Status here is read live from WasenderAPI."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={checkAll} disabled={checking}>
              <RefreshCw size={15} className={checking ? 'animate-spin' : ''} aria-hidden="true" />
              {checking ? 'Checking…' : 'Check status'}
            </Button>
            <Button onClick={() => setTester({ open: true, staffId: lines[0]?.id || '', phone: '', busy: null, result: null })}>
              Test number
            </Button>
          </div>
        }
      />

      {liveError && (
        <Card className="p-4 mb-4 !bg-[var(--attention-soft)] border-[var(--attention)]">
          <p className="text-sm text-[var(--ink)]">{liveError}</p>
        </Card>
      )}

      {live && (
        <Card className="p-4 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Central server key</div>
              <div className="text-xs text-[var(--ink-faint)]">
                {live.central.configured ? `WASENDER_API_KEY ${live.central.key}` : 'WASENDER_API_KEY is not set'} · used when a lead’s marketer has no line of their own
              </div>
            </div>
            <Badge tone={live.central.tone}>{live.central.label}</Badge>
          </div>
          {live.central.status !== 'connected' && (
            <p className="text-sm text-[var(--ink-soft)] mt-2">{live.central.message}</p>
          )}
        </Card>
      )}

      <Card className="p-4 mb-6 bg-[var(--accent-soft)] border-[var(--accent-soft)]">
        <p className="text-sm text-[var(--ink)]">
          <strong>How to connect a line:</strong> in WasenderAPI open the <strong>WhatsApp session</strong> for that
          person&rsquo;s number and copy <strong>its API key</strong> — not the Personal Access Token from Settings,
          which is a different credential. Paste it here; it is checked with WasenderAPI before it is saved.
          {live && <> {connected} of {lines.length} line{lines.length === 1 ? '' : 's'} connected.</>}
        </p>
      </Card>

      {loading ? <Spinner /> : staff.length === 0 ? (
        <EmptyState title="No staff yet" description="Add staff members first, then connect their WhatsApp lines." />
      ) : (
        <div className="space-y-2">
          {staff.map((s) => {
            const l = liveById.get(s.id)
            return (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-[var(--line-soft)] flex items-center justify-center text-[var(--ink-soft)] font-semibold flex-shrink-0">
                      {s.full_name?.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--ink)] truncate">{s.full_name}</div>
                      <div className="text-xs text-[var(--ink-faint)] capitalize">
                        {s.role?.replace(/_/g, ' ')}
                        {s.wasender_phone && <span> · {s.wasender_phone}</span>}
                        {l?.key && <span className="normal-case"> · key {l.key}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge tone={l ? l.tone : 'muted'}>
                      {s.has_wasender_key ? (l ? l.label : checking ? 'Checking…' : 'Not checked') : 'No line'}
                    </Badge>
                    {s.has_wasender_key && (
                      <Button size="sm" variant="ghost" onClick={() => checkLine(s.id)}>Check</Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => open(s)}>{s.has_wasender_key ? 'Edit' : 'Connect'}</Button>
                  </div>
                </div>
                {l && l.status !== 'connected' && (
                  <p className="text-sm text-[var(--ink-soft)] mt-2">{l.message}</p>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Connect / edit a line ─────────────────────────────────────────── */}
      <Modal open={!!editing} onClose={() => setEditing(null)} maxWidth="max-w-md">
        {editing && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Connect WhatsApp</h2>
              <button type="button" onClick={() => setEditing(null)} className="w-11 h-11 -mr-2 grid place-items-center text-[var(--ink-faint)] hover:text-[var(--ink)]" aria-label="Close"><X size={18} aria-hidden="true" /></button>
            </div>
            <p className="text-sm text-[var(--ink-soft)] mb-6">{editing.full_name}</p>

            <div className="space-y-4">
              <Field label="WhatsApp number" hint="the line they will use">
                <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="0244 000 000" className={inputClass} inputMode="tel" />
              </Field>
              <Field label="Personal intro" hint="how the AI introduces them">
                <input value={form.intro} onChange={e => setForm({ ...form, intro: e.target.value })} placeholder="I'm Ike, your admissions advisor" className={inputClass} />
              </Field>
              <Field label="Session API key" required={!editing.has_wasender_key}
                hint={editing.has_wasender_key ? 'leave blank to keep the current key' : 'from the WhatsApp session’s page in WasenderAPI'}>
                <input value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
                  className={inputClass} placeholder={editing.has_wasender_key ? 'Unchanged' : 'Paste the session API key'}
                  autoComplete="off" spellCheck={false} />
              </Field>
            </div>

            <div className="flex gap-2 mt-6">
              <Button onClick={save} disabled={saving} className="flex-1">{saving ? 'Checking with WasenderAPI…' : 'Save line'}</Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Test a number ─────────────────────────────────────────────────── */}
      <Modal open={tester.open} onClose={() => setTester(t => ({ ...t, open: false }))} maxWidth="max-w-md">
        <div className="p-6">
          <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Test number</h2>
          <p className="text-sm text-[var(--ink-soft)] mt-1 mb-5">
            Uses the chosen line&rsquo;s key against WasenderAPI. <strong>Check</strong> asks whether the number is on
            WhatsApp and sends nothing; <strong>Send test message</strong> sends a real message.
          </p>

          <div className="space-y-4">
            <Field label="Line to test">
              <select value={tester.staffId} onChange={e => setTester(t => ({ ...t, staffId: e.target.value, result: null }))} className={inputClass}>
                {lines.map(l => <option key={l.id} value={l.id}>{l.full_name}{l.wasender_phone ? ` (${l.wasender_phone})` : ''}</option>)}
                <option value="">Central server key (WASENDER_API_KEY)</option>
              </select>
            </Field>
            <Field label="Phone number">
              <input value={tester.phone} onChange={e => setTester(t => ({ ...t, phone: e.target.value, result: null }))}
                placeholder="0241234567" inputMode="tel" className={inputClass} />
            </Field>
          </div>

          {tester.result && (
            <p className={`mt-4 rounded-[var(--radius-control)] p-3 text-sm ${tester.result.ok ? 'bg-[var(--ok-soft)] text-[var(--ink)]' : 'bg-[var(--attention-soft)] text-[var(--ink)]'}`}>
              {tester.result.text}
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-6">
            <Button variant="secondary" onClick={() => runTest('check')} disabled={tester.busy !== null} className="flex-1 min-w-[120px]">
              {tester.busy === 'check' ? 'Checking…' : 'Check number'}
            </Button>
            <Button onClick={() => runTest('send')} disabled={tester.busy !== null} className="flex-1 min-w-[150px]">
              {tester.busy === 'send' ? 'Sending…' : 'Send test message'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
