'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, StatCard, inputClass } from '@/components/ui'
import { ClipboardList, Download, Search, Link2, Copy } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import Modal from '@/components/shared/Modal'

export default function ExternalSigninsPage() {
  const { data: signins, loading } = useData<any>({
    table: 'external_signins', select: '*',
    orderBy: 'signed_in_at', orderAsc: false, limit: 1000,
  })
  const [search, setSearch] = useState('')
  const [guide, setGuide] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const todayCount = signins.filter((s: any) => s.signed_in_at?.startsWith(today)).length
  const matched = signins.filter((s: any) => s.matched_lead_id).length

  const filtered = signins.filter((s: any) =>
    !search || [s.full_name, s.phone, s.email, s.course_interest].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  )

  function exportCSV() {
    const rows = filtered.map((s: any) => [s.full_name || '', s.phone || '', s.email || '', s.course_interest || '', s.campus || '', s.matched_lead_id ? 'Yes' : 'No', formatDateTime(s.signed_in_at)].map(v => `"${v}"`).join(','))
    const csv = 'Name,Phone,Email,Course,Campus,Known Lead,Signed In\n' + rows.join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `signins-${today}.csv`
    a.click()
  }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Sign-ins"
        title="Walk-in sign-ins"
        description="Live feed from your public sign-in page. Each submission is recorded here and matched to a known lead where possible."
        actions={
          <>
            <Button variant="secondary" onClick={() => setGuide(true)} icon={<Link2 size={14} />}>Connect sheet</Button>
            <Button variant="secondary" onClick={exportCSV} icon={<Download size={14} />}>Export</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Today" value={todayCount} sub="sign-ins so far" accent />
        <StatCard label="All time" value={signins.length} />
        <StatCard label="Matched to leads" value={matched} sub="already in CRM" />
        <StatCard label="New people" value={signins.length - matched} sub="not yet leads" />
      </div>

      <div className="relative mb-5 max-w-md mx-auto">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, course" className={inputClass.replace('h-11', 'h-10') + ' pl-9'} />
      </div>

      <Card className="overflow-hidden">
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div className="py-12"><EmptyState icon={<ClipboardList size={20} />} title="No sign-ins yet" description="Once your public sign-in page is connected, submissions appear here in real time." action={<Button variant="secondary" onClick={() => setGuide(true)}>How to connect</Button>} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Name', 'Phone', 'Course', 'Campus', 'Known lead', 'Signed in'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s: any) => (
                  <tr key={s.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)]">
                    <td className="px-4 py-3 font-medium text-sm text-[var(--ink)]">{s.full_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{s.phone?.replace(/^233/, '0') || '—'}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{s.course_interest || '—'}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-faint)]">{s.campus || '—'}</td>
                    <td className="px-4 py-3">{s.matched_lead_id ? <Badge tone="success">In CRM</Badge> : <Badge tone="muted">New</Badge>}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-faint)]">{formatDateTime(s.signed_in_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Connect guide */}
      <Modal open={guide} onClose={() => setGuide(false)} maxWidth="max-w-lg">
        <div className="p-6">
          <h2 className="font-display text-xl font-semibold text-[var(--ink)] mb-1">Connect your sign-in sheet</h2>
          <p className="text-sm text-[var(--ink-soft)] mb-5">Keep your current sign-in page and Google Sheet exactly as they are. Add this script so each new sign-in is also sent here.</p>

          <ol className="space-y-4 text-sm text-[var(--ink)]">
            <li>
              <div className="font-medium mb-1">1. Open your Google Sheet</div>
              <div className="text-[var(--ink-soft)]">Go to Extensions → Apps Script.</div>
            </li>
            <li>
              <div className="font-medium mb-1">2. Paste this script</div>
              <div className="relative">
                <pre className="bg-[var(--ink)] text-white text-[11px] rounded-lg p-3 overflow-x-auto leading-relaxed"><code>{`function onFormSubmit(e) {
  var row = {};
  var headers = e.range.getSheet()
    .getRange(1,1,1,e.range.getSheet().getLastColumn())
    .getValues()[0];
  e.values.forEach(function(v,i){ row[headers[i]] = v; });
  UrlFetchApp.fetch(
    "${appUrl}/api/signin/ingest?secret=cce-setup-2024",
    { method:"post", contentType:"application/json",
      payload: JSON.stringify(row) }
  );
}`}</code></pre>
                <button onClick={() => { navigator.clipboard.writeText(`function onFormSubmit(e) {\n  var row = {};\n  var headers = e.range.getSheet().getRange(1,1,1,e.range.getSheet().getLastColumn()).getValues()[0];\n  e.values.forEach(function(v,i){ row[headers[i]] = v; });\n  UrlFetchApp.fetch("${appUrl}/api/signin/ingest?secret=cce-setup-2024", { method:"post", contentType:"application/json", payload: JSON.stringify(row) });\n}`); toast.success('Script copied') }}
                  className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded text-white"><Copy size={13} /></button>
              </div>
            </li>
            <li>
              <div className="font-medium mb-1">3. Add the trigger</div>
              <div className="text-[var(--ink-soft)]">In Apps Script: Triggers → Add Trigger → choose <strong>onFormSubmit</strong>, event type <strong>On form submit</strong>. Save.</div>
            </li>
          </ol>

          <p className="text-xs text-[var(--ink-faint)] mt-5">From then on, every sign-in still goes to your sheet and also appears here automatically. People already in your CRM are matched by phone number.</p>

          <Button onClick={() => setGuide(false)} className="w-full mt-6">Done</Button>
        </div>
      </Modal>
    </div>
  )
}
