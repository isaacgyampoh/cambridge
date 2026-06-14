'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { SOURCE_COLORS } from '@/lib/utils'
import { Phone, MessageSquare, RefreshCw } from 'lucide-react'
import { changeLeadStatus } from '@/lib/leadStatus'
import Modal from '@/components/shared/Modal'
import { Button, Field, inputClass } from '@/components/ui'

const STAGES = [
  { key: 'new', label: 'New Leads', dot: 'bg-yellow-400', bg: 'bg-yellow-50 border-yellow-200'},
  { key: 'contacted', label: 'Contacted', dot: 'bg-blue-500', bg: 'bg-blue-50 border-blue-200'},
  { key: 'interested', label: 'Interested', dot: 'bg-indigo-500', bg: 'bg-indigo-50 border-indigo-200'},
  { key: 'follow_up', label: 'Follow Up', dot: 'bg-orange-500', bg: 'bg-orange-50 border-orange-200'},
  { key: 'ready_to_join', label: 'Ready to Join', dot: 'bg-green-500', bg: 'bg-green-50 border-green-200'},
  { key: 'registered', label: 'Registered', dot: 'bg-emerald-600', bg: 'bg-emerald-50 border-emerald-200'},
]

export default function PipelinePage() {
  const [dragging, setDragging] = useState<string|null>(null)
  const [over, setOver] = useState<string|null>(null)
  const [showLost, setShowLost] = useState(false)
  const [regLead, setRegLead] = useState<{ id: string; name: string; programs: any[] } | null>(null)
  const [regForm, setRegForm] = useState({ programCode: '', delivery: 'in_person', corporateValue: '' })
  const [registering, setRegistering] = useState(false)

  const { data: leads, loading, refetch } = useData({
    table: 'leads',
    select: '*, assignee:assigned_to(full_name)',
    orderBy: 'updated_at', limit: 300,
  })

  const allStages = showLost
    ? [...STAGES, { key:'not_interested', label:'Not Interested', dot:'bg-red-400', bg:'bg-red-50 border-red-200'}, { key:'lost', label:'Lost', dot:'bg-gray-400', bg:'bg-gray-50 border-gray-200'}]
    : STAGES

  async function moveLead(leadId: string, newStatus: string) {
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.status === newStatus) return
    try {
      const result = await changeLeadStatus(leadId, newStatus)
      // Registration needs a programme to credit points
      if (result.needsProgram) {
        setRegLead({ id: leadId, name: lead.full_name, programs: result.programs || [] })
        setRegForm({ programCode: '', delivery: 'in_person', corporateValue: '' })
        return
      }
      if (result.error) { toast.error(result.error); return }
      if (newStatus === 'ready_to_join') {
        await fetch('/api/admissions', { method: 'POST', headers: { 'Content-Type': 'application/json'}, body: JSON.stringify({ leadId }) })
        toast.success(`${lead.full_name} → Ready to Join! Admissions notified.`)
      } else if (result.credited) {
        toast.success(`${lead.full_name} registered — points credited.`)
      }
      refetch()
    } catch (e: any) { toast.error(e.message) }
  }

  async function confirmRegistration() {
    if (!regLead) return
    if (!regForm.programCode) { toast.error('Select a programme'); return }
    setRegistering(true)
    try {
      const result = await changeLeadStatus(regLead.id, 'registered', {
        programCode: regForm.programCode, delivery: regForm.delivery,
        corporateValue: regForm.corporateValue ? parseFloat(regForm.corporateValue) : undefined,
      })
      if (result.error) { toast.error(result.error); return }
      toast.success(`${regLead.name} registered — points credited.`)
      setRegLead(null); refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setRegistering(false) }
  }

  const byStage = (key: string) => leads.filter(l => l.status === key)

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-2">Pipeline</div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">Lead pipeline</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">Drag and drop to move leads between stages.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowLost(!showLost)}
            className={`h-9 px-3 rounded-xl text-xs font-semibold border transition ${showLost?'bg-red-100 text-red-700 border-red-200':'bg-white text-gray-600 border-gray-200'}`}>
            {showLost ? 'Hide Lost': 'Show Lost'}
          </button>
          <button onClick={refetch} className="h-9 w-9 flex items-center justify-center bg-white border border-gray-200 text-gray-500 rounded-xl hover:bg-gray-50 transition">
            <RefreshCw size={14} className={loading ? 'animate-spin': ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '70vh'}}>
          {allStages.map(stage => (
            <div key={stage.key} className="flex-shrink-0 w-64"
              onDragOver={e => { e.preventDefault(); setOver(stage.key) }}
              onDrop={e => { e.preventDefault(); if(dragging) moveLead(dragging, stage.key); setDragging(null); setOver(null) }}
              onDragLeave={() => setOver(null)}>

              {/* Column header */}
              <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl mb-2 border transition-all ${over===stage.key ? stage.bg+'scale-[1.01] shadow-md': stage.bg}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${stage.dot}`} />
                  <span className="text-xs font-bold text-gray-800">{stage.label}</span>
                </div>
                <span className="text-xs font-black text-gray-500 bg-white/80 rounded-full px-2 py-0.5">
                  {byStage(stage.key).length}
                </span>
              </div>

              {over === stage.key && dragging && (
                <div className={`border-2 border-dashed rounded-xl h-12 mb-2 flex items-center justify-center text-[11px] font-semibold text-gray-400 ${stage.bg}`}>
                  Drop here
                </div>
              )}

              <div className="space-y-2">
                {byStage(stage.key).map(lead => (
                  <div key={lead.id} draggable
                    onDragStart={e => { setDragging(lead.id); e.dataTransfer.effectAllowed = 'move'}}
                    onDragEnd={() => { setDragging(null); setOver(null) }}
                    className={`bg-white rounded-xl border border-gray-200 p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-all select-none ${dragging===lead.id?'opacity-40 scale-95':''}`}>

                    <div className="flex items-start gap-2 mb-2">
                      <div className="w-7 h-7 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] font-semibold text-xs flex-shrink-0">
                        {lead.full_name?.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-[var(--ink)] truncate leading-tight">{lead.full_name}</div>
                        {lead.phone && <div className="text-[10px] text-gray-400">{lead.phone}</div>}
                      </div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${SOURCE_COLORS[lead.source]||'bg-gray-100 text-gray-600'}`}>
                        {lead.source}
                      </span>
                    </div>

                    {lead.course_interest && (
                      <div className="text-[10px] text-blue-600 font-medium mb-1.5 truncate"> {lead.course_interest}</div>
                    )}

                    <div className="flex items-center justify-between pt-1.5 border-t border-gray-50">
                      <span className="text-[9px] text-gray-300">{new Date(lead.updated_at).toLocaleDateString('en-GH', {day:'numeric',month:'short'})}</span>
                      {lead.phone && (
                        <div className="flex gap-1">
                          <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                            className="w-5 h-5 rounded bg-green-100 flex items-center justify-center hover:bg-green-200 transition">
                            <Phone size={9} className="text-green-600" />
                          </a>
                          <a href={`https://wa.me/${String(lead.phone).replace(/^0/,'233').replace(/\D/,'')}`} target="_blank" onClick={e => e.stopPropagation()}
                            className="w-5 h-5 rounded bg-[#25D366]/10 flex items-center justify-center hover:bg-[#25D366]/20 transition">
                            <MessageSquare size={9} className="text-[#25D366]" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {byStage(stage.key).length === 0 && (
                  <div className="h-16 border-2 border-dashed border-gray-100 rounded-xl flex items-center justify-center text-[11px] text-gray-300">
                    Drop leads here
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Registration programme prompt (when dragging to Registered) */}
      <Modal open={!!regLead} onClose={() => setRegLead(null)} maxWidth="max-w-sm">
        {regLead && (
          <div className="p-6">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)] mb-1">Register student</h2>
            <p className="text-sm text-[var(--ink-soft)] mb-5">{regLead.name} — select the programme to credit points and the GHS 200 commission.</p>
            <div className="space-y-4">
              <Field label="Programme" required>
                <select value={regForm.programCode} onChange={e => setRegForm({ ...regForm, programCode: e.target.value })} className={inputClass}>
                  <option value="">Select programme</option>
                  {regLead.programs.map((p: any) => (
                    <option key={p.code} value={p.code}>{p.name} {p.is_corporate ? '(40–200 pts)' : `(${p.points} pts)`}</option>
                  ))}
                </select>
              </Field>
              <Field label="Delivery">
                <div className="grid grid-cols-2 gap-2">
                  {[{ v: 'in_person', l: 'In person' }, { v: 'online', l: 'Online' }].map(d => (
                    <button key={d.v} type="button" onClick={() => setRegForm({ ...regForm, delivery: d.v })}
                      className={`h-10 rounded-lg text-sm font-medium border transition ${regForm.delivery === d.v ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-faint)]'}`}>
                      {d.l}
                    </button>
                  ))}
                </div>
              </Field>
              {regLead.programs.find((p: any) => p.code === regForm.programCode)?.is_corporate && (
                <Field label="Corporate value (points, 40–200)">
                  <input type="number" min={40} max={200} value={regForm.corporateValue} onChange={e => setRegForm({ ...regForm, corporateValue: e.target.value })} placeholder="e.g. 120" className={inputClass} />
                </Field>
              )}
            </div>
            <div className="flex gap-2 mt-6">
              <Button onClick={confirmRegistration} disabled={registering} className="flex-1">{registering ? 'Registering…' : 'Confirm registration'}</Button>
              <Button variant="secondary" onClick={() => setRegLead(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
