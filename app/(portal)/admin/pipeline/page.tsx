'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Lead } from '@/types'
import { toast } from 'sonner'
import { SOURCE_COLORS, formatDateTime } from '@/lib/utils'
import { Phone, MessageSquare, User, RefreshCw } from 'lucide-react'

const STAGES = [
  { key: 'new', label: 'New Leads', color: 'bg-yellow-500', light: 'bg-yellow-50 border-yellow-200' },
  { key: 'contacted', label: 'Contacted', color: 'bg-blue-500', light: 'bg-blue-50 border-blue-200' },
  { key: 'interested', label: 'Interested', color: 'bg-indigo-500', light: 'bg-indigo-50 border-indigo-200' },
  { key: 'follow_up', label: 'Follow Up', color: 'bg-orange-500', light: 'bg-orange-50 border-orange-200' },
  { key: 'ready_to_join', label: 'Ready to Join', color: 'bg-green-500', light: 'bg-green-50 border-green-200' },
  { key: 'registered', label: 'Registered', color: 'bg-emerald-600', light: 'bg-emerald-50 border-emerald-200' },
]

const DEAD = [
  { key: 'not_interested', label: 'Not Interested', color: 'bg-red-500', light: 'bg-red-50 border-red-200' },
  { key: 'lost', label: 'Lost', color: 'bg-gray-500', light: 'bg-gray-50 border-gray-200' },
]

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState<string | null>(null)
  const [draggingOver, setDraggingOver] = useState<string | null>(null)
  const [myLeadsOnly, setMyLeadsOnly] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [showDead, setShowDead] = useState(false)
  const [search, setSearch] = useState('')
  const sb = createClient()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await sb.auth.getUser()
      const { data: p } = await sb.from('profiles').select('*').eq('id', user!.id).single()
      setProfile(p)
      load(p)
    }
    init()

    // Realtime updates
    const ch = sb.channel('pipeline')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => load())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [])

  async function load(p?: any) {
    const prof = p || profile
    let q = sb.from('leads')
      .select('*, assignee:assigned_to(full_name, phone)')
      .order('updated_at', { ascending: false })
      .limit(300)

    if (prof?.role === 'marketing_officer') {
      q = q.eq('assigned_to', prof.id)
    }

    const { data } = await q
    setLeads(data || [])
    setLoading(false)
  }

  async function moveLead(leadId: string, newStatus: string) {
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.status === newStatus) return

    // Optimistic update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus as any } : l))

    const { error } = await sb.from('leads').update({ status: newStatus }).eq('id', leadId)
    if (error) {
      toast.error('Failed to move lead')
      load()
      return
    }

    // Trigger admission flow if moved to ready_to_join
    if (newStatus === 'ready_to_join') {
      await fetch('/api/admissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      toast.success(`${lead.full_name} moved to Ready to Join — Admissions notified!`)
    } else {
      toast.success(`Moved to ${newStatus.replace(/_/g, ' ')}`)
    }

    // Log pipeline event
    await sb.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'note',
      subject: `Moved: ${lead.status} → ${newStatus}`,
      created_by: profile?.id,
    })
  }

  function handleDragStart(e: React.DragEvent, leadId: string) {
    setDragging(leadId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent, stage: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDraggingOver(stage)
  }

  function handleDrop(e: React.DragEvent, stage: string) {
    e.preventDefault()
    if (dragging) moveLead(dragging, stage)
    setDragging(null)
    setDraggingOver(null)
  }

  const allStages = showDead ? [...STAGES, ...DEAD] : STAGES

  const filtered = leads.filter(l => {
    if (myLeadsOnly && profile?.role !== 'marketing_officer') {
      return l.assigned_to === profile?.id
    }
    if (search) return l.full_name.toLowerCase().includes(search.toLowerCase()) ||
      l.phone?.includes(search) || l.email?.toLowerCase().includes(search.toLowerCase())
    return true
  })

  const byStage = (key: string) => filtered.filter(l => l.status === key)

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lead Pipeline</h1>
          <p className="text-gray-500 text-sm mt-0.5">Drag & drop leads between stages</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search leads..."
            className="h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 w-44" />
          {profile?.role !== 'marketing_officer' && (
            <button onClick={() => setMyLeadsOnly(!myLeadsOnly)}
              className={`h-9 px-3 rounded-xl text-xs font-semibold border transition ${myLeadsOnly ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              My Leads
            </button>
          )}
          <button onClick={() => setShowDead(!showDead)}
            className={`h-9 px-3 rounded-xl text-xs font-semibold border transition ${showDead ? 'bg-red-100 text-red-700 border-red-200' : 'bg-white text-gray-600 border-gray-200'}`}>
            {showDead ? 'Hide Dead' : 'Show Lost'}
          </button>
          <button onClick={() => load()} className="h-9 px-3 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Pipeline counts */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {allStages.map(s => (
          <div key={s.key} className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-gray-200 whitespace-nowrap">
            <div className={`w-2 h-2 rounded-full ${s.color}`} />
            <span className="text-xs font-semibold text-gray-600">{s.label}</span>
            <span className="text-xs font-bold text-gray-900 bg-gray-100 rounded-full px-1.5">{byStage(s.key).length}</span>
          </div>
        ))}
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: '70vh' }}>
          {allStages.map(stage => (
            <div key={stage.key} className="flex-shrink-0 w-72 flex flex-col"
              onDragOver={e => handleDragOver(e, stage.key)}
              onDrop={e => handleDrop(e, stage.key)}
              onDragLeave={() => setDraggingOver(null)}>

              {/* Column header */}
              <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl mb-3 border ${
                draggingOver === stage.key ? stage.light + ' scale-[1.02] shadow-md' : stage.light
              } transition-all`}>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${stage.color}`} />
                  <span className="text-sm font-bold text-gray-900">{stage.label}</span>
                </div>
                <span className="text-xs font-bold text-gray-500 bg-white rounded-full px-2 py-0.5">
                  {byStage(stage.key).length}
                </span>
              </div>

              {/* Drop zone indicator */}
              {draggingOver === stage.key && (
                <div className={`border-2 border-dashed rounded-xl h-16 mb-2 flex items-center justify-center text-xs font-semibold opacity-60 ${stage.light}`}>
                  Drop here
                </div>
              )}

              {/* Lead cards */}
              <div className="space-y-2 flex-1 overflow-y-auto">
                {byStage(stage.key).map(lead => (
                  <div key={lead.id}
                    draggable
                    onDragStart={e => handleDragStart(e, lead.id)}
                    onDragEnd={() => { setDragging(null); setDraggingOver(null) }}
                    className={`bg-white rounded-xl border border-gray-200 p-3.5 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-all select-none ${
                      dragging === lead.id ? 'opacity-50 scale-95' : ''
                    }`}>

                    {/* Lead name + source */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0">
                          {lead.full_name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-gray-900 truncate">{lead.full_name}</div>
                          {lead.phone && <div className="text-xs text-gray-400">{lead.phone.replace(/^233/, '0')}</div>}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize flex-shrink-0 ml-1 ${SOURCE_COLORS[lead.source]}`}>
                        {lead.source}
                      </span>
                    </div>

                    {/* Course interest */}
                    {lead.course_interest && (
                      <div className="text-[11px] text-blue-600 font-medium mb-2 truncate">
                        📚 {lead.course_interest}
                      </div>
                    )}

                    {/* Assignee */}
                    {(lead as any).assignee && (
                      <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-2">
                        <User size={10} />
                        <span>{(lead as any).assignee.full_name?.split(' ')[0]}</span>
                      </div>
                    )}

                    {/* Quick actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                      <span className="text-[10px] text-gray-300">
                        {new Date(lead.updated_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                      </span>
                      <div className="flex gap-1">
                        {lead.phone && (
                          <>
                            <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                              className="w-6 h-6 rounded-lg bg-green-100 flex items-center justify-center hover:bg-green-200 transition">
                              <Phone size={10} className="text-green-600" />
                            </a>
                            <a href={`https://wa.me/${lead.phone.replace(/^0/, '233')}`} target="_blank"
                              onClick={e => e.stopPropagation()}
                              className="w-6 h-6 rounded-lg bg-[#25D366]/10 flex items-center justify-center hover:bg-[#25D366]/20 transition">
                              <MessageSquare size={10} className="text-[#25D366]" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {byStage(stage.key).length === 0 && draggingOver !== stage.key && (
                  <div className="h-20 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-xs text-gray-300">
                    No leads
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
