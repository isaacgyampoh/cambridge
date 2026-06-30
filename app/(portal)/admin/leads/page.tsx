'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import type { Lead } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { Search, Download, Plus, Upload, FileSpreadsheet } from 'lucide-react'
import Link from 'next/link'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import { exportToExcel } from '@/lib/utils/export'

const STATUS_TONE: Record<string, any> = {
  new: 'neutral', contacted: 'accent', interested: 'accent', follow_up: 'warning',
  ready_to_join: 'success', registered: 'success', not_interested: 'muted', lost: 'danger',
}

export default function AdminLeads() {
  const { data: leads, loading } = useData<Lead>({
    table: 'leads',
    select: '*, assignee:assigned_to(full_name), assigner:assigned_by(full_name)',
    orderBy: 'created_at', orderAsc: false, limit: 500,
  })
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const filtered = leads.filter((l: any) => {
    const matchSearch = !search || [l.full_name, l.email, l.phone, l.course_interest].some(v => v?.toLowerCase().includes(search.toLowerCase()))
    const matchSource = sourceFilter === 'all' || l.source === sourceFilter
    const matchStatus = statusFilter === 'all' || l.status === statusFilter
    return matchSearch && matchSource && matchStatus
  })

  function exportExcel() {
    const rows = filtered.map((l: any) => ({
      Name: l.full_name,
      Phone: l.phone?.replace(/^233/, '0') || '',
      Email: l.email || '',
      Source: l.source,
      Stage: l.status?.replace(/_/g, ' '),
      Course: l.course_interest || '',
      Owner: l.assignee?.full_name || 'Unassigned',
      Added: formatDateTime(l.created_at),
    }))
    if (!rows.length) return
    exportToExcel(rows, `cce-leads-${new Date().toISOString().slice(0, 10)}`, 'Leads')
  }

  function exportCSV() {
    const rows = filtered.map((l: any) => [
      l.full_name, l.email || '', l.phone || '', l.source, l.status,
      l.course_interest || '', l.assignee?.full_name || '', formatDateTime(l.created_at)
    ].map(v => `"${v}"`).join(','))
    const csv = 'Name,Email,Phone,Source,Status,Course,Assigned To,Date\n' + rows.join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `cce-leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="CRM"
        title="Leads"
        description="Every prospective student, with their source, stage and owner."
        actions={
          <>
            <Button variant="secondary" href="/admin/leads/import" >Import</Button>
            <Button variant="secondary" onClick={exportExcel} >Excel</Button>
            <Button variant="secondary" onClick={exportCSV} >CSV</Button>
            <Button href="/admin/leads/new" >Add lead</Button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex-1 min-w-56 relative">
          
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or phone"
            className={inputClass.replace('h-11', 'h-10') + ' pl-9'} />
        </div>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className={inputClass.replace('h-11', 'h-10') + ' w-auto'}>
          <option value="all">All sources</option>
          {['facebook', 'google', 'linkedin', 'website', 'referral', 'manual'].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputClass.replace('h-11', 'h-10') + ' w-auto'}>
          <option value="all">All stages</option>
          {['new', 'contacted', 'interested', 'follow_up', 'ready_to_join', 'registered', 'not_interested', 'lost'].map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      <Card className="overflow-hidden">
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div className="py-16">
            <EmptyState  title="No leads match" description="Try adjusting your search or filters, or add a new lead." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Name', 'Phone', 'Source', 'Course', 'Stage', 'Owner', 'Added'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l: any) => (
                  <tr key={l.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)] transition">
                    <td className="px-4 py-3">
                      <Link href={`/admin/leads/${l.id}`} className="font-medium text-sm text-[var(--ink)] hover:text-[var(--accent)] transition">{l.full_name}</Link>
                      {l.email && <div className="text-xs text-[var(--ink-faint)]">{l.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{l.phone?.replace(/^233/, '0') || '—'}</td>
                    <td className="px-4 py-3"><Badge tone="neutral">{l.source}</Badge></td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)] max-w-32 truncate">{l.course_interest || '—'}</td>
                    <td className="px-4 py-3"><Badge tone={STATUS_TONE[l.status] || 'neutral'}>{l.status.replace(/_/g, ' ')}</Badge></td>
                    <td className="px-4 py-3 text-sm">{l.assignee?.full_name || <span className="text-[var(--warn)] text-xs font-medium">Unassigned</span>}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-faint)]">{formatDateTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
