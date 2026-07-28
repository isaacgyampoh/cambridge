'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, Field, inputClass } from '@/components/ui'
import { MessageSquare, X, Plug, CheckCircle2 } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'

export default function WhatsAppLinesPage() {
  const { data: staff, loading, refetch } = useData<any>({
    table: 'profiles', select: 'id, full_name, role, phone, wasender_api_key, wasender_status, wasender_phone, wa_intro',
    filters: [{ col: 'is_active', op: 'eq', val: true }],
    orderBy: 'full_name', limit: 200,
  })

  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState({ apiKey: '', number: '', intro: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  function open(s: any) {
    setEditing(s)
    setForm({ apiKey: '', number: s.wasender_phone || s.phone?.replace(/^233/, '0') || '', intro: s.wa_intro || '' })
  }

  async function save() {
    if (!form.apiKey && !editing?.wasender_api_key) { toast.error('Enter the WaSender API key'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/whatsapp/instance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: editing.id,
          apiKey: form.apiKey || undefined,
          number: form.number,
          status: 'connecting',
        }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Could not save'); return }
      // Save the personal intro line used by the AI assistant
      await fetch('/api/data', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'profiles', data: { wa_intro: form.intro || null }, filters: [{ col: 'id', val: editing.id }] }),
      })
      toast.success('WhatsApp line saved')
      setEditing(null)
      refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  async function testConnection(staffId: string) {
    setTesting(true)
    try {
      const res = await fetch('/api/whatsapp/instance', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId }),
      })
      const d = await res.json()
      if (d.success) toast.success('Test message sent. Line is connected.')
      else toast.error('Test failed. Check the API key and that the session is active in WaSender.')
      refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setTesting(false) }
  }

  const STATUS: Record<string, any> = {
    connected: 'success', connecting: 'warning', disconnected: 'danger', not_connected: 'muted',
  }
  const connected = staff.filter((s: any) => s.wasender_status === 'connected').length

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Messaging"
        title="WhatsApp lines"
        description="Give each marketer their own WhatsApp line. Messages to their leads are sent from their number, and replies reach them directly."
        actions={
          <Button variant="secondary" onClick={async () => {
            const st = await fetch('/api/whatsapp/status').then(r => r.json()).catch(() => null)
            if (!st || st.error) { toast.error(st?.error || 'Could not check'); return }
            if (!st.central_key_set) { toast.error(st.diagnosis); return }
            const num = prompt(`WaSender is connected (key ${st.central_key_fingerprint}).\n\nEnter a phone number to send a real test message to:`)
            if (!num) return
            toast.loading('Sending test…', { id: 'wa' })
            const r = await fetch('/api/whatsapp/status', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: num.trim() }),
            }).then(x => x.json()).catch(() => ({ error: 'failed' }))
            if (r.sent) toast.success(`Test message sent to ${r.to}`, { id: 'wa' })
            else toast.error(`Failed: ${r.error || r.provider_response?.message || 'see console'}`, { id: 'wa' })
            console.log('WaSender test:', r)
          }}>Test connection</Button>
        }
      />

      <Card className="p-4 mb-6 bg-[var(--accent-soft)] border-[var(--accent-soft)]">
        <div className="flex items-start gap-3">
          
          <div className="text-sm text-[var(--accent)]">
            <strong>How it works:</strong> in your WaSender account (wasenderapi.com) create a session for each person's number and scan the QR with their phone, then paste that session's API key here. Once connected, the system sends that person's lead messages through their own line. {connected} of {staff.length} connected.
          </div>
        </div>
      </Card>

      {loading ? <Spinner /> : staff.length === 0 ? (
        <EmptyState  title="No staff yet" description="Add staff members first, then connect their WhatsApp lines." />
      ) : (
        <div className="space-y-2 stagger">
          {staff.map((s: any) => (
            <Card key={s.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[var(--line-soft)] flex items-center justify-center text-[var(--ink-soft)] font-semibold flex-shrink-0">
                  {s.full_name?.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-[var(--ink)] truncate">{s.full_name}</div>
                  <div className="text-xs text-[var(--ink-faint)] capitalize">
                    {s.role?.replace(/_/g, ' ')}
                    {s.wasender_phone && <span> · {s.wasender_phone}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge tone={STATUS[s.wasender_status] || 'muted'}>{(s.wasender_status || 'not connected').replace(/_/g, ' ')}</Badge>
                {s.wasender_api_key && (
                  <Button size="sm" variant="ghost" onClick={() => testConnection(s.id)} disabled={testing}>Test</Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => open(s)}>{s.wasender_api_key ? 'Edit' : 'Connect'}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} maxWidth="max-w-md">
        {editing && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Connect WhatsApp</h2>
              <button onClick={() => setEditing(null)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"></button>
            </div>
            <p className="text-sm text-[var(--ink-soft)] mb-6">{editing.full_name}</p>

            <div className="space-y-4">
              <Field label="WhatsApp number" hint="the line they will use">
                <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="0244 000 000" className={inputClass} />
              </Field>
              <Field label="Personal intro" hint="how the AI introduces them">
                <input value={form.intro} onChange={e => setForm({ ...form, intro: e.target.value })} placeholder="I'm Ike, your admissions advisor" className={inputClass} />
              </Field>
              <Field label="WaSender API key" required>
                <input value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} className={inputClass} placeholder="Paste the session API key" />
              </Field>
            </div>

            <div className="flex gap-2 mt-6">
              <Button onClick={save} disabled={saving} className="flex-1">{saving ? 'Saving…' : 'Save line'}</Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
            <p className="text-xs text-[var(--ink-faint)] mt-4">
              After saving, use “Test” on the list to send a confirmation message to this number and mark the line connected.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
