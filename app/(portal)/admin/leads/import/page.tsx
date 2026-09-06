'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Upload, FileText, CheckCircle, XCircle, AlertTriangle, Download } from 'lucide-react'
import Link from 'next/link'

interface ParsedLead {
  full_name: string
  phone: string
  email: string
  course_interest: string
  source: string
  city: string
  notes: string
  status: 'valid' | 'error'
  error?: string
}

const TEMPLATE_CSV = `full_name,phone,email,course_interest,source,city,notes
Kwame Mensah,0241234567,kwame@email.com,PMP,facebook,Accra,Interested in weekend classes
Abena Owusu,0551234567,abena@email.com,Corporate Training,google,Kumasi,
John Doe,0201234567,,PHRI,manual,Takoradi,Called office`

type ImportResult = {
  reference: string
  totalReceived: number
  valid: number
  invalid: number
  duplicates: number
  assigned: number
  unassigned: number
  failed: number
  status: 'complete' | 'partial'
}

export default function ImportLeadsPage() {
  const router  = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [raw,       setRaw]       = useState('')
  const [parsed,    setParsed]    = useState<ParsedLead[]>([])
  const [importing, setImporting] = useState(false)
  /*
   * How far through we are.
   *
   * The browser sends the file in batches of fifty. A five-hundred-row list is
   * ten sequential requests, and the screen previously said nothing at all
   * between the first and the last — several minutes of a disabled button,
   * which is indistinguishable from a hang and is exactly when somebody
   * reloads the page and imports the list twice.
   */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<(ImportResult & { requestsFailed: number }) | null>(null)

  const VALID_SOURCES = ['facebook','google','linkedin','website','referral','manual']

  function parseCSV(text: string): ParsedLead[] {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) return []

    // Detect header
    const firstLine = lines[0].toLowerCase()
    const hasHeader = firstLine.includes('full_name') || firstLine.includes('name') || firstLine.includes('phone')
    const dataLines = hasHeader ? lines.slice(1) : lines

    return dataLines.map((line, i) => {
      // Handle quoted CSV
      const cols: string[] = []
      let cur = '', inQ = false
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
        else cur += ch
      }
      cols.push(cur.trim())

      const [full_name='', phone='', email='', course_interest='', source='', city='', notes=''] = cols

      if (!full_name.trim()) return { full_name:'', phone, email, course_interest, source, city, notes, status: 'error', error: `Row ${i+2}: Name is required` }

      const cleanSource = source.toLowerCase().trim()
      const validSource = VALID_SOURCES.includes(cleanSource) ? cleanSource : 'manual'

      return {
        full_name: full_name.trim(),
        phone: phone.trim().replace(/\s+/g,'').replace(/^0/,'233'),
        email: email.trim(),
        course_interest: course_interest.trim(),
        source: validSource,
        city: city.trim(),
        notes: notes.trim(),
        status: 'valid',
      }
    })
  }

  function handleText(text: string) {
    setRaw(text)
    setResult(null)
    if (text.trim()) setParsed(parseCSV(text))
    else setParsed([])
  }

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => handleText(e.target?.result as string)
    reader.readAsText(file)
  }

  async function importLeads() {
    const valid = parsed.filter(p => p.status === 'valid')
    if (!valid.length) { toast.error('No valid leads to import'); return }
    setImporting(true)
    setResult(null)
    setProgress({ done: 0, total: valid.length })

    /*
     * Batches accumulate into ONE import record, identified by a reference the
     * server allocates on the first call and we carry through the rest.
     *
     * The previous version summed its own counters in the browser and reported
     * a whole batch as failed whenever a request died — which it did, because
     * the endpoint greeted every lead inline and outlived its own timeout. The
     * server is now the only thing that counts, so a number shown here is one
     * the database can be asked about afterwards.
     */
    const BATCH = 50
    let reference: string | null = null
    let latest: ImportResult | null = null
    let requestsFailed = 0

    for (let i = 0; i < valid.length; i += BATCH) {
      const batch = valid.slice(i, i + BATCH)
      try {
        const res: Response = await fetch('/api/leads/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference,
            filename: fileRef.current?.files?.[0]?.name || undefined,
            rowOffset: i,
            leads: batch.map(l => ({
              full_name: l.full_name,
              phone: l.phone || null,
              email: l.email || null,
              course_interest: l.course_interest || null,
              source: l.source,
              city: l.city || null,
              notes: l.notes || null,
            })),
          }),
        })
        const d: (ImportResult & { success?: boolean; error?: string }) | null =
          await res.json().catch(() => null)

        if (!res.ok || !d?.success) {
          requestsFailed += batch.length
          toast.error(d?.error || `Rows ${i + 1}–${i + batch.length} could not be sent.`)
          continue
        }

        reference = d.reference
        latest = d as ImportResult
      } catch {
        requestsFailed += batch.length
        toast.error(`Rows ${i + 1}–${i + batch.length} could not be sent. Check your connection.`)
      } finally {
        // Advance whether the batch landed or not: the bar tracks how much of
        // the file has been attempted, and a stalled bar during a failing run
        // is the least useful thing it could do.
        setProgress({ done: Math.min(i + BATCH, valid.length), total: valid.length })
      }
    }

    setImporting(false)
    setProgress(null)

    if (!latest) {
      toast.error('Nothing was imported.')
      return
    }

    setResult({ ...latest, requestsFailed })
    toast.success(`${latest.reference} — ${latest.assigned} assigned of ${latest.totalReceived} received.`)
  }

  function downloadTemplate() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }))
    a.download = 'cambridge-leads-template.csv'
    a.click()
  }

  const validCount = parsed.filter(p => p.status === 'valid').length
  const errorCount = parsed.filter(p => p.status === 'error').length

  return (
    <div className="w-full fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/leads"
          className="flex items-center gap-1.5 h-9 px-3 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-xl text-sm font-medium hover:bg-[var(--line-soft)] transition">
           Leads
        </Link>
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Import Leads</h1>
          <p className="text-[var(--ink-faint)] text-sm">Upload a CSV file or paste data to import multiple leads at once</p>
        </div>
      </div>

      {/* While the file is being sent, say how far through it is. Ten
          sequential requests with a silent disabled button is
          indistinguishable from a hang, and that is when somebody reloads and
          imports the same list twice. */}
      {importing && progress && (
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6 max-w-lg mx-auto mb-5"
          role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <span className="text-[15px] font-semibold text-[var(--ink)]">Importing…</span>
            <span className="text-[13px] text-[var(--ink-soft)] tabular-nums">
              {progress.done} of {progress.total}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--line-soft)] overflow-hidden">
            <div className="h-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
              style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <p className="text-[12px] text-[var(--ink-faint)] mt-3 leading-relaxed">
            Sent in batches so a long list cannot time out. Please keep this page open.
          </p>
        </div>
      )}

      {result ? (
        /*
         * Every row accounted for.
         *
         * The old summary showed "imported" and "failed" counted in the
         * browser, which reported a whole batch as failed whenever a request
         * died — and requests died routinely, because the endpoint greeted
         * each lead inline and outlived its own timeout. These figures come
         * from the server, and the reference beneath them can be used to ask
         * the database exactly which rows did what.
         */
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6 sm:p-8 max-w-lg mx-auto">
          <h2 className="font-display text-xl font-semibold text-[var(--ink)] mb-1">
            {result.status === 'complete' ? 'Import complete' : 'Import finished with problems'}
          </h2>
          <p className="text-[13px] font-mono text-[var(--ink-faint)] mb-5">{result.reference}</p>

          <dl className="space-y-2 mb-6 text-[14px]">
            {[
              { label: 'Rows received', value: result.totalReceived, tone: 'ink' },
              { label: 'Assigned to a marketer', value: result.assigned, tone: 'ok' },
              { label: 'Already in the system', value: result.duplicates, tone: 'faint' },
              { label: 'Could not be read', value: result.invalid, tone: 'warn' },
              { label: 'Imported but unassigned', value: result.unassigned, tone: 'warn' },
              { label: 'Failed', value: result.failed, tone: 'danger' },
              { label: 'Never reached the server', value: result.requestsFailed, tone: 'danger' },
            ].filter(r => r.value > 0 || r.label === 'Rows received' || r.label === 'Assigned to a marketer')
              .map(r => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-[var(--line-soft)] pb-2 last:border-0">
                  <dt className="text-[var(--ink-soft)]">{r.label}</dt>
                  <dd className={`font-semibold tabular-nums ${
                    r.tone === 'ok' ? 'text-[var(--ok)]'
                      : r.tone === 'danger' ? 'text-[var(--danger)]'
                      : r.tone === 'warn' ? 'text-[var(--warn)]'
                      : r.tone === 'faint' ? 'text-[var(--ink-faint)]'
                      : 'text-[var(--ink)]'
                  }`}>{r.value}</dd>
                </div>
              ))}
          </dl>

          {(result.unassigned > 0 || result.failed > 0) && (
            <p className="text-[13px] text-[var(--ink-soft)] leading-relaxed mb-5">
              Every row that did not land is recorded against {result.reference} with the
              reason. Open the full report below to see which people are missing and why.
            </p>
          )}

          <p className="text-[13px] text-[var(--ink-soft)] leading-relaxed mb-6">
            Welcome messages are queued and go out over the next few minutes, rather than
            during the import — that is what keeps a large list from timing out.
          </p>

          <div className="flex flex-col sm:flex-row gap-2.5">
            {/* The row-level report. Every figure above is traceable to the
                rows behind it, which was recorded from the start but had
                nowhere to be seen. */}
            <Link href={`/admin/leads/import/${encodeURIComponent(result.reference)}`}
              className="flex-1 min-h-[44px] bg-[var(--accent)] text-white rounded-xl text-sm font-bold
                hover:brightness-110 transition flex items-center justify-center
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2">
              See the full report
            </Link>
            <Link href="/admin/leads"
              className="flex-1 min-h-[44px] bg-[var(--paper)] border border-[var(--line)] text-[var(--ink)]
                rounded-xl text-sm font-semibold hover:bg-[var(--canvas)] transition
                flex items-center justify-center
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
              View leads
            </Link>
            <button onClick={() => { setResult(null); setParsed([]); setRaw('') }}
              className="flex-1 min-h-[44px] bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold
                hover:bg-[var(--line)] transition
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
              Import another list
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Left — input */}
          <div className="space-y-4">
            {/* Template download */}
            <div className="bg-[var(--accent-soft)] border border-blue-100 rounded-2xl p-4 flex items-center gap-3">
              
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[var(--accent)]">Need a template?</div>
                <div className="text-xs text-[var(--accent)]">Columns: full_name, phone, email, course_interest, source, city, notes</div>
              </div>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-2 bg-[var(--accent)] text-white rounded-xl text-xs font-bold hover:brightness-110 transition flex-shrink-0">
                 Template
              </button>
            </div>

            {/* File upload */}
            <div>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full h-28 border-2 border-dashed border-[var(--line)] rounded-2xl flex flex-col items-center justify-center gap-2 text-[var(--ink-faint)] hover:border-blue-400 hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all">
                
                <span className="text-sm font-semibold">Click to upload CSV file</span>
                <span className="text-xs">or drag & drop</span>
              </button>
            </div>

            {/* Paste area */}
            <div>
              <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-2">
                Or paste CSV data directly
              </label>
              <textarea
                value={raw}
                onChange={e => handleText(e.target.value)}
                rows={12}
                placeholder={`full_name,phone,email,course_interest,source,city,notes\nKwame Mensah,0241234567,kwame@email.com,PMP,facebook,Accra,Interested in weekend classes\nAbena Owusu,0551234567,,PHRI,google,Kumasi,`}
                className="w-full px-4 py-3 rounded-2xl border border-[var(--line)] text-sm font-mono resize-none focus:outline-none focus:border-[var(--accent)] bg-[var(--line-soft)] focus:bg-white transition"
              />
            </div>
          </div>

          {/* Right — preview */}
          <div className="space-y-4">
            {parsed.length === 0 ? (
              <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-12 text-center text-[var(--ink-faint)] shadow-[var(--shadow-raised)]">
                
                <p className="font-medium">Preview will appear here</p>
                <p className="text-sm mt-1">Upload or paste your CSV data</p>
              </div>
            ) : (
              <>
                {/* Stats bar */}
                <div className="flex gap-3">
                  <div className="flex-1 bg-[var(--ok-soft)] border border-green-100 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-[var(--ok)]">{validCount}</div>
                    <div className="text-xs text-[var(--ok)] font-semibold">Ready to import</div>
                  </div>
                  {errorCount > 0 && (
                    <div className="flex-1 bg-[var(--danger-soft)] border border-red-100 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-[var(--danger)]">{errorCount}</div>
                      <div className="text-xs text-[var(--danger)] font-semibold">Will be skipped</div>
                    </div>
                  )}
                  <div className="flex-1 bg-[var(--line-soft)] border border-[var(--line-soft)] rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-[var(--ink-soft)]">{parsed.length}</div>
                    <div className="text-xs text-[var(--ink-faint)] font-semibold">Total rows</div>
                  </div>
                </div>

                {/* Preview table */}
                <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] overflow-hidden shadow-[var(--shadow-raised)]">
                  <div className="px-4 py-3 border-b border-[var(--line-soft)] flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--ink)]">Preview</span>
                    <span className="text-xs text-[var(--ink-faint)]">Showing first 20 rows</span>
                  </div>
                  {/*
                    Deliberately still a table, and the only one left in the
                    portal. This is a CSV preview: the point is to check that
                    each column landed in the right field before importing, and
                    a grid with headers is exactly the tool for that. Cards
                    would break the column alignment that makes a mis-mapped
                    import recorded against its reference.
                  */}
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="rtc w-full">
                      <thead className="bg-[var(--line-soft)] sticky top-0">
                        <tr>
                          {['', 'Name', 'Phone', 'Email', 'Course', 'Source'].map(h => (
                            <th key={h} className="text-left text-[11px] font-bold text-[var(--ink-faint)] uppercase tracking-wide px-3 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.slice(0, 20).map((row, i) => (
                          <tr key={i} className={`border-t border-[var(--line-soft)] ${row.status === 'error' ? 'bg-[var(--danger-soft)]' : 'hover:bg-[var(--line-soft)]'}`}>
                            <td className="px-3 py-2">
                              {row.status === 'valid'
                                ? null : null}
                            </td>
                            <td data-label="Name" className="px-3 py-2 text-xs font-semibold text-[var(--ink)] max-w-32 truncate">{row.full_name || <span className="text-[var(--danger)] italic">missing</span>}</td>
                            <td data-label="Phone" className="px-3 py-2 text-xs text-[var(--ink-faint)]">{row.phone || '—'}</td>
                            <td data-label="Email" className="px-3 py-2 text-xs text-[var(--ink-faint)] max-w-32 truncate">{row.email || '—'}</td>
                            <td data-label="Course" className="px-3 py-2 text-xs text-[var(--ink-faint)] max-w-28 truncate">{row.course_interest || '—'}</td>
                            <td data-label="Source" className="px-3 py-2">
                              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full capitalize bg-[var(--line-soft)] text-[var(--ink-soft)]">{row.source}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Errors */}
                {errorCount > 0 && (
                  <div className="bg-[var(--warn-soft)] border border-yellow-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-[var(--warn)] mb-2">
                       {errorCount} row{errorCount > 1 ? 's' : ''} will be skipped:
                    </div>
                    {parsed.filter(p => p.status === 'error').map((p, i) => (
                      <div key={i} className="text-xs text-[var(--warn)]">{p.error}</div>
                    ))}
                  </div>
                )}

                {/* Import button */}
                <button onClick={importLeads} disabled={importing || validCount === 0}
                  className="w-full h-12 bg-[var(--accent)] text-white rounded-xl text-sm font-bold hover:brightness-110 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {importing
                    ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Importing {validCount} leads...</>
                    : <> Import {validCount} Lead{validCount !== 1 ? 's' : ''}</>}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
