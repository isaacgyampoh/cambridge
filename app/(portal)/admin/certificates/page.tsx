'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import FileUpload from '@/components/shared/FileUpload'
import { PageHeader, Card, Button, Badge, inputClass, Field } from '@/components/ui'
import Modal from '@/components/shared/Modal'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { toast } from 'sonner'
import { exportToExcel } from '@/lib/utils/export'
import { CONFIG } from '@/lib/config'

type Certificate = {
  id: string
  student_name: string
  course_name?: string | null
  month_completed?: string | null
  certificate_no?: string | null
  issued?: boolean
  download_token?: string | null
}

export default function CertificatesPage() {
  const { data: certs, loading, refetch } = useData<any>({
    table: 'certificates', select: '*', orderBy: 'created_at', orderAsc: false, limit: 1000,
  })
  // Eligible: completed AND fees paid, not yet issued
  const { data: eligible, refetch: refetchElig } = useData<any>({
    table: 'class_enrollments',
    select: '*, batch:batch_id(name, course:course_id(name))',
    filters: [{ col: 'status', op: 'eq', val: 'completed' }, { col: 'fees_paid', op: 'eq', val: true }],
    orderBy: 'completed_at', orderAsc: false, limit: 500,
  })

  const [search, setSearch] = useState('')
  const [issueFor, setIssueFor] = useState<any>(null)
  const [certUrl, setCertUrl] = useState('')
  const [month, setMonth] = useState('')
  const [issuing, setIssuing] = useState(false)

  const issuedEnrollmentIds = new Set(certs.map((c: any) => c.enrollment_id))
  const toIssue = eligible.filter((e: any) => !issuedEnrollmentIds.has(e.id))

  const filtered = certs.filter((c: any) => !search ||
    (c.student_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.course_name || '').toLowerCase().includes(search.toLowerCase()))

  const certificateColumns: Column<Certificate>[] = [
    { key: 'student', header: 'Student', primary: true, render: c => c.student_name },
    { key: 'course', header: 'Course', secondary: true, render: c => c.course_name || '—' },
    { key: 'completed', header: 'Completed', render: c => c.month_completed || '—' },
    {
      key: 'number', header: 'Certificate no.',
      render: c => <span className="font-mono text-[12px]">{c.certificate_no || '—'}</span>,
    },
    {
      key: 'status', header: 'Status',
      render: c => c.issued ? <Badge tone="success">Issued</Badge> : <Badge tone="neutral">Draft</Badge>,
    },
    {
      key: 'link', header: 'Link',
      render: c => c.download_token ? (
        <button
          onClick={() => {
            navigator.clipboard.writeText(`${CONFIG.appUrl}/certificate/${c.download_token}`)
            toast.success('Download link copied')
          }}
          className="text-[13px] text-[var(--accent)] font-medium hover:underline min-h-[36px]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1">
          Copy link
        </button>
      ) : null,
    },
  ]


  function openIssue(enr: any) {
    setIssueFor(enr); setCertUrl('')
    setMonth(enr.completed_at ? new Date(enr.completed_at).toLocaleDateString('en-GH', { month: 'long', year: 'numeric' }) : '')
  }

  async function issue(send: boolean) {
    if (!issueFor) return
    setIssuing(true)
    try {
      const res = await fetch('/api/certificates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: issueFor.id, certificateUrl: certUrl, monthCompleted: month, send }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(send ? 'Certificate issued and sent to student' : 'Certificate added to registry')
      setIssueFor(null); refetch(); refetchElig()
    } catch (e: any) { toast.error(e.message) }
    finally { setIssuing(false) }
  }

  async function exportRegistry() {
    await exportToExcel(filtered.map((c: any) => ({
      Name: c.student_name, Course: c.course_name, 'Month completed': c.month_completed || '',
      'Certificate No.': c.certificate_no || '', Issued: c.issued ? 'Yes' : 'No',
      'Issued on': c.issued_at ? new Date(c.issued_at).toLocaleDateString() : '',
    })), 'certificate-registry')
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Academics"
        title="Certificate registry"
        description="Issue certificates to students who completed their class and paid full fees. Online students get a download link automatically."
        actions={<button onClick={exportRegistry} className="inline-flex items-center gap-1.5 h-10 px-4 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg text-sm font-medium hover:border-[var(--ink-faint)]"> Export registry</button>}
      />

      {/* Ready to issue */}
      {toIssue.length > 0 && (
        <Card className="p-5 mb-6">
          <p className="text-[13px] font-medium text-[var(--accent)] mb-3">Ready to certify ({toIssue.length})</p>
          <div className="space-y-2">
            {toIssue.slice(0, 20).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2 border-b border-[var(--line-soft)] last:border-0">
                <div>
                  <div className="text-sm font-medium text-[var(--ink)]">{e.full_name}</div>
                  <div className="text-[12px] text-[var(--ink-faint)]">{e.batch?.course?.name || e.batch?.name} · completed</div>
                </div>
                <Button size="sm" onClick={() => openIssue(e)} >Issue certificate</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Registry */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-[var(--line)]">
          <div className="relative max-w-xs">
            
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search certificates..." className={inputClass + ' pl-9'} />
          </div>
        </div>
        <DataTable<Certificate>
          caption="Certificates"
          state={loading ? 'loading' : 'ready'}
          rows={filtered}
          rowKey={c => c.id}
          columns={certificateColumns}
          emptyTitle="No certificates yet"
          emptyMessage="Certificates appear here once students complete their course."
        />
      </Card>

      {/* Issue modal */}
      <Modal open={!!issueFor} onClose={() => setIssueFor(null)} maxWidth="max-w-lg">
        {issueFor && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Issue certificate</h2>
              <button onClick={() => setIssueFor(null)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"></button>
            </div>
            <div className="rounded-xl bg-[var(--canvas)] p-4 mb-4">
              <div className="text-sm font-semibold text-[var(--ink)]">{issueFor.full_name}</div>
              <div className="text-xs text-[var(--ink-faint)]">{issueFor.batch?.course?.name || issueFor.batch?.name}</div>
            </div>
            <div className="space-y-4">
              <Field label="Month completed">
                <input value={month} onChange={e => setMonth(e.target.value)} placeholder="e.g. June 2026" className={inputClass} />
              </Field>
              <Field label="Certificate PDF (soft copy)">
                <FileUpload onUploaded={url => setCertUrl(url)} value={certUrl} label="Upload certificate PDF" accept="application/pdf,image/*" folder="cce/certificates" />
                <div className="mt-2">
                  <input value={certUrl} onChange={e => setCertUrl(e.target.value)} placeholder="…or paste a PDF link" className={inputClass} />
                </div>
              </Field>
              <p className="text-xs text-[var(--ink-faint)]">The student gets a page where they can download this. Upload the file or paste a link.</p>
            </div>
            <div className="flex gap-2 mt-6">
              <Button onClick={() => issue(true)} disabled={issuing} >
                {issuing ? 'Issuing…' : 'Issue & send to student'}
              </Button>
              <Button variant="secondary" onClick={() => issue(false)} disabled={issuing}>Save to registry only</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
