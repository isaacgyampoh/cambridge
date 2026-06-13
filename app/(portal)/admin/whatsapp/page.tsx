'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, Field, inputClass } from '@/components/ui'
import { MessageSquare, X, Plug, CheckCircle2 } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'

export default function WhatsAppLinesPage() {
  const { data: staff, loading, refetch } = useData<any>({
    table: 'profiles', select: 'id, full_name, role, phone, wawp_instance_id, wawp_status, wawp_number',
    filters: [{ col: 'is_active', op: 'eq', val: true }],
    orderBy: 'full_name', limit: 200,
  })

  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState({ instanceId: '', accessToken: '', number: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  function open(s: any) {
    setEditing(s)
    setForm({ instanceId: s.wawp_instance_id || '', accessToken: '', number: s.wawp_number || s.phone?.replace(/^233/, '0') || '' })
  }

  async function save() {
    if (!form.instanceId) { toast.error('Enter the instance ID'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/whatsapp/instance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: editing.id,
          instanceId: form.instanceId,
          accessToken: form.accessToken || undefined,
          number: form.number,
          status: 'connecting',
        }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Could not save'); return }
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
      else toast.error('Test failed. Check the credentials and that the line is active in WAWP.')
      refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setTesting(false) }
  }

  const STATUS: Record<string, any> = {
    connected: 'success', connecting: 'warning', disconnected: 'danger', not_connected: 'muted',
  }
  const connected = staff.filter((s: any) => s.wawp_status === 'connected').length

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Messaging"
        title="WhatsApp lines"
        description="Give each marketer their own WhatsApp line. Messages to their leads are sent from their number, and replies reach them directly."
      />

      <Card className="p-4 mb-6 bg-[var(--accent-soft)] border-[var(--accent-soft)]">
        <div className="flex items-start gap-3">
          <Plug size={18} className="text-[var(--accent)] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--accent)]">
            <strong>How it works:</strong> create an instance for each person in your WAWP account (app.wawp.net), scan the QR with their phone, then paste the Instance ID and Access Token here. Once connected, the system sends that person’s lead messages through their own line. {connected} of {staff.length} connected.
          </div>
        </div>
      </Card>

      {loading ? <Spinner /> : staff.length === 0 ? (
        <EmptyState icon={<MessageSquare size={20} />} title="No staff yet" description="Add staff members first, then connect their WhatsApp lines." />
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
                    {s.wawp_number && <span> · {s.wawp_number}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge tone={STATUS[s.wawp_status] || 'muted'}>{(s.wawp_status || 'not connected').replace(/_/g, ' ')}</Badge>
                {s.wawp_instance_id && (
                  <Button size="sm" variant="ghost" onClick={() => testConnection(s.id)} disabled={testing}>Test</Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => open(s)}>{s.wawp_instance_id ? 'Edit' : 'Connect'}</Button>
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
              <button onClick={() => setEditing(null)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"><X size={20} /></button>
            </div>
            <p className="text-sm text-[var(--ink-soft)] mb-6">{editing.full_name}</p>

            <div className="space-y-4">
              <Field label="WhatsApp number" hint="the line they will use">
                <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="0244 000 000" className={inputClass} />
              </Field>
              <Field label="Instance ID" required>
                <input value={form.instanceId} onChange={e => setForm({ ...form, instanceId: e.target.value })} placeholder="From your WAWP dashboard" className={inputClass} />
              </Field>
              <Field label="Access token" hint={editing.wawp_instance_id ? 'leave blank to keep current' : ''}>
                <input value={form.accessToken} onChange={e => setForm({ ...form, accessToken: e.target.value })} placeholder="From your WAWP dashboard" className={inputClass} />
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
