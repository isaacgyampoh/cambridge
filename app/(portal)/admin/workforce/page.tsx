'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, Field, inputClass, SectionLabel, StatCard } from '@/components/ui'
import { MapPin, Clock, Crosshair, Check, X } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'

export default function WorkforcePage() {
  const today = new Date().toISOString().slice(0, 10)
  const { data: offices, refetch: loadOffices } = useData<any>({ table: 'office_locations', limit: 20 })
  const { data: attendance, loading, refetch: loadAtt } = useData<any>({
    table: 'staff_attendance', select: '*, staff:staff_id(full_name, role)',
    filters: [{ col: 'date', op: 'eq', val: today }],
    orderBy: 'clock_in_at', orderAsc: false, limit: 200,
  })

  const [officeModal, setOfficeModal] = useState(false)
  const [form, setForm] = useState({ name: '', latitude: '', longitude: '', radius_meters: 150 })
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState(false)

  function useMyLocation() {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({ ...f, latitude: pos.coords.latitude.toFixed(7), longitude: pos.coords.longitude.toFixed(7) }))
        setLocating(false)
        toast.success('Captured current location')
      },
      () => { setLocating(false); toast.error('Could not get your location') },
      { enableHighAccuracy: true, timeout: 12000 }
    )
  }

  async function saveOffice() {
    if (!form.name || !form.latitude || !form.longitude) { toast.error('Fill in all fields'); return }
    setSaving(true)
    try {
      await mutate('POST', 'office_locations', {
        name: form.name,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        radius_meters: form.radius_meters,
        is_active: true,
      })
      toast.success('Office location saved')
      setOfficeModal(false)
      setForm({ name: '', latitude: '', longitude: '', radius_meters: 150 })
      loadOffices()
    } catch (e: any) { toast.error(e.message || 'Could not save') }
    finally { setSaving(false) }
  }

  const present = attendance.filter((a: any) => a.clock_in_at).length
  const late = attendance.filter((a: any) => a.status === 'late').length
  const out = attendance.filter((a: any) => a.clock_out_at).length
  const fmt = (t: string) => t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Workforce"
        title="Staff attendance"
        description="Who is on site today. Sign-ins are location-verified against your office."
        actions={<Button variant="secondary" onClick={() => setOfficeModal(true)} >Office location</Button>}
      />

      {/* Office setup notice */}
      {offices.length === 0 && (
        <Card className="p-4 mb-6 border-[var(--warn)]/20 bg-[var(--warn-soft)]">
          <div className="flex items-start gap-3">
            
            <div className="text-sm text-amber-800">
              <strong>No office location set.</strong> Staff cannot sign in until you set one. Stand at your office and use “Office location, then Use my current location”.
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="On site today" value={present}  accent />
        <StatCard label="Late arrivals" value={late}  />
        <StatCard label="Signed out" value={out} />
        <StatCard label="Office radius" value={offices[0] ? `${offices[0].radius_meters}m` : '—'} sub={offices[0]?.name} />
      </div>

      <SectionLabel>Today — {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</SectionLabel>

      <Card className="overflow-hidden">
        {loading ? <Spinner /> : attendance.length === 0 ? (
          <div className="py-12"><EmptyState  title="No sign-ins yet today" description="Staff sign-ins will appear here as they arrive." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rtc w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Staff', 'Role', 'Clock in', 'Clock out', 'Distance', 'Status'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendance.map((a: any) => (
                  <tr key={a.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)]">
                    <td data-label="Staff" className="px-4 py-3 font-medium text-sm text-[var(--ink)]">{a.staff?.full_name}</td>
                    <td data-label="Role" className="px-4 py-3 text-sm text-[var(--ink-soft)] capitalize">{a.staff?.role?.replace(/_/g, ' ')}</td>
                    <td data-label="Clock in" className="px-4 py-3 text-sm text-[var(--ink)]">{fmt(a.clock_in_at)}</td>
                    <td data-label="Clock out" className="px-4 py-3 text-sm text-[var(--ink-soft)]">{fmt(a.clock_out_at)}</td>
                    <td data-label="Distance" className="px-4 py-3 text-sm text-[var(--ink-faint)]">{a.distance_meters != null ? `${a.distance_meters}m` : '—'}</td>
                    <td data-label="Status" className="px-4 py-3"><Badge tone={a.status === 'late' ? 'warning' : 'success'}>{a.status === 'late' ? 'Late' : 'Present'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Office location modal */}
      <Modal open={officeModal} onClose={() => setOfficeModal(false)} maxWidth="max-w-md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Office location</h2>
            <button onClick={() => setOfficeModal(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"></button>
          </div>

          {offices.length > 0 && (
            <div className="mb-5 space-y-2">
              {offices.map((o: any) => (
                <div key={o.id} className="flex items-center justify-between p-3 bg-[var(--line-soft)] rounded-lg text-sm">
                  <div>
                    <div className="font-medium text-[var(--ink)]">{o.name}</div>
                    <div className="text-xs text-[var(--ink-faint)] font-mono">{Number(o.latitude).toFixed(5)}, {Number(o.longitude).toFixed(5)} · {o.radius_meters}m</div>
                  </div>
                  <Badge tone={o.is_active ? 'success' : 'muted'}>{o.is_active ? 'Active' : 'Off'}</Badge>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-4">
            <Field label="Location name" required>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Main Campus, Accra" className={inputClass} />
            </Field>
            <Button variant="secondary" onClick={useMyLocation} disabled={locating}  className="w-full">
              {locating ? 'Getting location…' : 'Use my current location'}
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" required><input value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })} placeholder="5.6037" className={inputClass} /></Field>
              <Field label="Longitude" required><input value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })} placeholder="-0.1870" className={inputClass} /></Field>
            </div>
            <Field label="Allowed radius (metres)" hint="how close staff must be">
              <input type="number" value={form.radius_meters} onChange={e => setForm({ ...form, radius_meters: parseInt(e.target.value) || 150 })} className={inputClass} />
            </Field>
          </div>
          <div className="flex gap-2 mt-6">
            <Button onClick={saveOffice} disabled={saving} className="flex-1">{saving ? 'Saving…' : 'Save location'}</Button>
            <Button variant="secondary" onClick={() => setOfficeModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
