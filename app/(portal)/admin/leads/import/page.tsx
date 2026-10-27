'use client'
import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  FIELDS, guessMapping, readRow, cellToText, rowIsEmpty, unmappedHeaders,
  type ColumnMapping, type FieldKey,
} from '@/lib/leads/importMapping'
import { INDUSTRIES, parseIndustry, industryLabel } from '@/lib/leads/industry'
import { validateRow } from '@/lib/leads/importValidation'
import { mayNameAnotherOwner } from '@/lib/leads/ownership'

/**
 * BULK LEAD IMPORT.
 *
 * ── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 *
 * The previous version read columns BY POSITION from pasted CSV text: first
 * column a name, second a phone, and so on. It worked for a file made from
 * our own template and for nothing else — and the files that actually arrive
 * are Google Sheets exported from Facebook lead forms and spreadsheets bought
 * from somebody else, in whatever order their columns happened to be. A file
 * whose second column was an email imported every email as a phone number,
 * and the operator found out afterwards.
 *
 * It also could not open a .xlsx at all, which is what a spreadsheet is.
 *
 * ── THE SHAPE OF IT NOW ────────────────────────────────────────────────────
 *
 *   choose a file  →  check what each column is  →  import  →  what happened
 *
 * The middle step is the point. Nothing is written until somebody has seen
 * what the system decided each column means, what industry and course it read
 * for each person, which rows are already on file, and which rows it cannot
 * use. Every one of those is correctable on that screen.
 */

type Step = 'choose' | 'map' | 'done'

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
  withoutIndustry: number
  industryRecorded: boolean
}

type Staff = { id: string; full_name: string; email?: string | null }

type RowIssue = 'no_name' | 'no_contact' | 'industry_unreadable' | 'assignee_unknown'

const TEMPLATE_CSV = `Full Name,Phone,Email,Course of Interest,Industry,Company,City,Notes
Kwame Mensah,0241234567,kwame@email.com,PMP,Energy Oil and Gas,Ghana Gas,Accra,Interested in weekend classes
Abena Owusu,0551234567,abena@email.com,PHRi,Financial Services,GCB Bank,Kumasi,
John Doe,0201234567,,PMP,Construction/Engineering,,Takoradi,Called the office`

/** How many rows the preview table shows. Every row is still imported. */
const PREVIEW_ROWS = 60

export default function ImportLeadsPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('choose')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<unknown[][]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [parsing, setParsing] = useState(false)

  /** The industry for the whole upload, and whether it overrules the file. */
  const [defaultIndustry, setDefaultIndustry] = useState('')
  const [overrideRowIndustry, setOverrideRowIndustry] = useState(false)
  /** Corrections the operator made to individual rows, by row index. */
  const [industryFix, setIndustryFix] = useState<Record<number, string>>({})

  const [staff, setStaff] = useState<Staff[]>([])
  const [me, setMe] = useState<{ role?: string; portals?: string[] } | null>(null)
  const [duplicates, setDuplicates] = useState<(string | null)[]>([])
  const [checkedDuplicates, setCheckedDuplicates] = useState(false)

  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<(ImportResult & { requestsFailed: number; withoutIndustry: number }) | null>(null)

  const mayAssign = mayNameAnotherOwner(me?.role, me?.portals || [])

  useEffect(() => {
    fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)).then(d => {
      if (d?.valid) setMe({ role: d.role, portals: d.portals || [] })
    }).catch(() => {})
  }, [])

  useEffect(() => {
    // Only fetched by somebody who may actually assign: an ordinary marketer
    // has no business holding a list of their colleagues' ids.
    if (!mayAssign) return
    fetch('/api/data?table=profiles&select=id,full_name,email&filters=' + encodeURIComponent(JSON.stringify([
      { col: 'is_active', op: 'eq', val: true },
    ])) + '&orderBy=full_name&orderAsc=true')
      .then(r => r.json()).then(d => setStaff(d.data || [])).catch(() => setStaff([]))
  }, [mayAssign])

  /* ── reading the file ─────────────────────────────────────────────────── */

  /**
   * One parser for .xlsx, .xls and .csv.
   *
   * SheetJS reads all three, so a CSV is not a second code path with its own
   * quoting bugs — which is what the hand-rolled comma splitter here used to
   * be. Loaded on demand: it is 268 KB, and most visits to this page are
   * somebody looking at a past import.
   */
  const parseWorkbook = useCallback(async (input: ArrayBuffer | string, name: string) => {
    setParsing(true)
    try {
      const XLSX = await import('xlsx')
      const wb = typeof input === 'string'
        ? XLSX.read(input, { type: 'string', raw: false })
        : XLSX.read(new Uint8Array(input), { type: 'array', raw: false })

      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) { toast.error('That file has no sheets in it.'); return }

      /*
       * `raw: false` asks for the FORMATTED text of each cell, which is what
       * keeps a phone number stored as text with its leading zero. A number
       * that lost its zero in Excel long ago arrives as nine digits, which
       * the phone rule already understands as a local number.
       */
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1, blankrows: false, defval: '', raw: false,
      })

      const nonEmpty = aoa.filter(r => !rowIsEmpty(r))
      if (nonEmpty.length < 2) {
        toast.error('That file needs a header row and at least one lead.')
        return
      }

      const head = (nonEmpty[0] as unknown[]).map(cellToText)
      const body = nonEmpty.slice(1)
      const guessed = guessMapping(head)

      setFileName(name)
      setHeaders(head)
      setRows(body)
      setMapping(guessed)
      setIndustryFix({})
      setDuplicates([])
      setCheckedDuplicates(false)
      setResult(null)
      setStep('map')

      if (!Object.values(guessed).includes('full_name')) {
        toast.warning('No name column was recognised. Say which one it is below.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? `That file could not be read: ${e.message}` : 'That file could not be read.')
    } finally {
      setParsing(false)
    }
  }, [])

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onerror = () => toast.error('That file could not be opened.')
    reader.onload = e => {
      const data = e.target?.result
      if (data instanceof ArrayBuffer) parseWorkbook(data, file.name)
      else if (typeof data === 'string') parseWorkbook(data, file.name)
    }
    reader.readAsArrayBuffer(file)
  }

  /* ── what each row will become ────────────────────────────────────────── */

  const mappedFields = useMemo(() => new Set(Object.values(mapping)), [mapping])
  const fileNamesIndustry = mappedFields.has('industry')

  const prepared = useMemo(() => rows.map((cells, i) => {
    const v = readRow(cells, mapping)
    const check = validateRow({ full_name: v.full_name, phone: v.phone, email: v.email })

    const fromFile = parseIndustry(v.industry)
    const corrected = industryFix[i]
    const industry = corrected !== undefined
      ? (corrected || null)
      : overrideRowIndustry
        ? (defaultIndustry || fromFile)
        : (fromFile || defaultIndustry || null)

    // Named in the file, matched against real staff. Never guessed at.
    const wanted = String(v.assigned_to || '').trim().toLowerCase()
    const match = wanted
      ? staff.find(s =>
          s.full_name?.trim().toLowerCase() === wanted ||
          String(s.email || '').trim().toLowerCase() === wanted)
      : undefined

    const issues: RowIssue[] = []
    if (!check.ok && check.reason === 'No name') issues.push('no_name')
    else if (!check.ok) issues.push('no_contact')
    // Only a flag when the file HAS an industry column and this row's value
    // could not be read. A file with no such column is not a row problem.
    if (fileNamesIndustry && !industry) issues.push('industry_unreadable')
    if (wanted && !match) issues.push('assignee_unknown')

    return {
      index: i,
      values: v,
      valid: check.ok,
      industry,
      industryFromFile: fromFile,
      assignedTo: mayAssign ? match?.id ?? null : null,
      assigneeName: match?.full_name ?? null,
      wantedAssignee: wanted || null,
      issues,
    }
  }), [rows, mapping, industryFix, overrideRowIndustry, defaultIndustry, staff, mayAssign, fileNamesIndustry])

  const validRows = useMemo(() => prepared.filter(p => p.valid), [prepared])
  const invalidRows = useMemo(() => prepared.filter(p => !p.valid), [prepared])
  const needsIndustryReview = useMemo(
    () => validRows.filter(p => p.issues.includes('industry_unreadable')), [validRows])
  const unknownAssignees = useMemo(
    () => validRows.filter(p => p.issues.includes('assignee_unknown')), [validRows])
  const duplicateCount = duplicates.filter(Boolean).length

  const industryTally = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of validRows) {
      const key = p.industry || '—'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [validRows])

  /* ── duplicates, before anything is written ───────────────────────────── */

  const checkDuplicates = useCallback(async () => {
    if (!validRows.length) return
    const found: (string | null)[] = new Array(rows.length).fill(null)
    try {
      for (let i = 0; i < validRows.length; i += 500) {
        const slice = validRows.slice(i, i + 500)
        const d = await fetch('/api/leads/import/check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contacts: slice.map(p => ({ phone: p.values.phone || null, email: p.values.email || null })),
          }),
        }).then(r => r.json())
        if (!d?.success) throw new Error(d?.error || 'The check failed.')
        slice.forEach((p, n) => { found[p.index] = d.duplicates[n] })
      }
      setDuplicates(found)
      setCheckedDuplicates(true)
    } catch (e) {
      // Not silently "no duplicates": that is the answer that makes somebody
      // import a list they would otherwise have stopped to look at.
      setCheckedDuplicates(false)
      toast.error(e instanceof Error ? e.message : 'Existing leads could not be checked.')
    }
  }, [validRows, rows.length])

  useEffect(() => {
    if (step === 'map' && validRows.length && !checkedDuplicates) checkDuplicates()
    // Re-run only when the mapping changes what a row's contact details are.
  }, [step, mapping, validRows.length, checkedDuplicates, checkDuplicates])

  /* ── the import itself ────────────────────────────────────────────────── */

  async function runImport() {
    if (!validRows.length) { toast.error('There are no rows that can be imported.'); return }
    if (!mappedFields.has('full_name')) { toast.error('Say which column holds the name first.'); return }

    setImporting(true)
    setResult(null)
    setProgress({ done: 0, total: validRows.length })

    const BATCH = 50
    let reference: string | null = null
    let latest: ImportResult | null = null
    let requestsFailed = 0
    let withoutIndustry = 0

    for (let i = 0; i < validRows.length; i += BATCH) {
      const batch = validRows.slice(i, i + BATCH)
      try {
        const res: Response = await fetch('/api/leads/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference,
            filename: fileName || undefined,
            rowOffset: i,
            defaultIndustry: defaultIndustry || null,
            overrideRowIndustry,
            leads: batch.map(p => ({
              full_name: p.values.full_name || '',
              phone: p.values.phone || null,
              email: p.values.email || null,
              course_interest: p.values.course_interest || null,
              source: p.values.source || 'manual',
              city: p.values.city || null,
              notes: p.values.notes || null,
              company: p.values.company || null,
              // The code this screen showed, so what is imported is what was
              // previewed — including a correction made to this row.
              industry: p.industry || null,
              assigned_to: p.assignedTo || null,
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
        withoutIndustry += d.withoutIndustry || 0
      } catch {
        requestsFailed += batch.length
        toast.error(`Rows ${i + 1}–${i + batch.length} could not be sent. Check your connection.`)
      } finally {
        setProgress({ done: Math.min(i + BATCH, validRows.length), total: validRows.length })
      }
    }

    setImporting(false)
    setProgress(null)

    if (!latest) { toast.error('Nothing was imported.'); return }

    setResult({ ...latest, requestsFailed, withoutIndustry })
    setStep('done')
    toast.success(`${latest.reference} — ${latest.assigned} assigned of ${latest.totalReceived} received.`)
    if (latest.industryRecorded === false) {
      toast.warning('The leads landed, but this database has no industry column yet, so the industry was not recorded.')
    }
  }

  /* ── the rows this import cannot use, as a file ───────────────────────── */

  function downloadProblemRows() {
    const problems = prepared.filter(p => p.issues.length)
    if (!problems.length) { toast.info('There is nothing wrong with any row.'); return }
    const lines = [
      'Row,Name,Phone,Email,Problem',
      ...problems.map(p => [
        p.index + 2,                       // +2: a header row, and humans count from one
        p.values.full_name || '',
        p.values.phone || '',
        p.values.email || '',
        p.issues.map(describeIssue).join('; '),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    a.download = `rows-needing-attention-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  function downloadTemplate() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }))
    a.download = 'cambridge-leads-template.csv'
    a.click()
  }

  function setColumn(index: number, key: string) {
    setMapping(current => {
      const next: ColumnMapping = { ...current }
      // A field belongs to one column. Choosing it here takes it off whichever
      // column had it, rather than silently having two columns feed one field.
      for (const [col, field] of Object.entries(next)) {
        if (field === key) delete next[Number(col)]
      }
      if (key) next[index] = key as FieldKey
      else delete next[index]
      return next
    })
    setCheckedDuplicates(false)
  }

  function fixAllFlagged(code: string) {
    setIndustryFix(current => {
      const next = { ...current }
      for (const p of needsIndustryReview) next[p.index] = code
      return next
    })
  }

  /* ── render ───────────────────────────────────────────────────────────── */

  return (
    <div className="w-full fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/leads"
          className="flex items-center gap-1.5 h-9 px-3 bg-[var(--paper)] border border-[var(--line)] text-[var(--ink-soft)] rounded-xl text-sm font-medium hover:bg-[var(--line-soft)] transition">
          Leads
        </Link>
        <div>
          <h1 className="font-display text-[22px] font-semibold text-[var(--ink)]">Import leads</h1>
          <p className="text-[13px] text-[var(--ink-soft)]">
            An Excel or CSV file from a Google Sheet, a Facebook lead form, or a list you were sent.
          </p>
        </div>
      </div>

      {step === 'choose' && (
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6 sm:p-8 max-w-xl mx-auto">
          <label className="flex flex-col items-center justify-center h-40 rounded-2xl border-2 border-dashed border-[var(--line)] cursor-pointer hover:border-[var(--accent)] transition mb-4">
            <span className="text-[15px] font-semibold text-[var(--ink)]">
              {parsing ? 'Reading the file…' : 'Choose a spreadsheet'}
            </span>
            <span className="text-[13px] text-[var(--ink-faint)] mt-1">.xlsx, .xls or .csv</span>
            <input ref={fileRef} type="file" className="hidden"
              accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>

          <p className="text-[13px] text-[var(--ink-soft)] leading-relaxed mb-3">
            The columns can be in any order and named however the file names them —
            you will be shown what each one was understood as before anything is imported.
          </p>

          <button onClick={downloadTemplate}
            className="text-[13px] font-medium text-[var(--accent)] hover:underline">
            Download a template
          </button>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-5 max-w-5xl mx-auto">
          {/* What each column is */}
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="font-display text-[17px] font-semibold text-[var(--ink)]">What each column is</h2>
              <span className="text-[12px] text-[var(--ink-faint)] truncate">{fileName}</span>
            </div>
            <p className="text-[13px] text-[var(--ink-soft)] mb-4">
              {rows.length} row{rows.length === 1 ? '' : 's'}. Correct anything that was read wrongly —
              a course and an industry are different things and must not share a column.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {headers.map((header, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-[var(--line-soft)] p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[var(--ink)] truncate">{header || `Column ${i + 1}`}</div>
                    <div className="text-[11px] text-[var(--ink-faint)] truncate">
                      {cellToText(rows[0]?.[i]) || '—'}
                    </div>
                  </div>
                  <select value={mapping[i] || ''} onChange={e => setColumn(i, e.target.value)}
                    className="h-9 px-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] text-[13px] text-[var(--ink)] shrink-0">
                    <option value="">Ignore</option>
                    {FIELDS.map(f => (
                      <option key={f.key} value={f.key}
                        disabled={mapping[i] !== f.key && mappedFields.has(f.key)}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {unmappedHeaders(headers, mapping).length > 0 && (
              <p className="text-[12px] text-[var(--ink-faint)] mt-3 leading-snug">
                Not imported: {unmappedHeaders(headers, mapping).join(', ')}.
              </p>
            )}
            {!mappedFields.has('full_name') && (
              <p className="text-[13px] text-[var(--danger)] font-medium mt-3">
                Say which column holds the name. Nothing can be imported without one.
              </p>
            )}
          </div>

          {/* Industry */}
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5">
            <h2 className="font-display text-[17px] font-semibold text-[var(--ink)] mb-1">Industry</h2>
            {fileNamesIndustry ? (
              <p className="text-[13px] text-[var(--ink-soft)] mb-3">
                This file states an industry per row, and those are kept.
                {needsIndustryReview.length > 0 && (
                  <> <span className="text-[var(--warn)] font-medium">
                    {needsIndustryReview.length} row{needsIndustryReview.length === 1 ? '' : 's'} could not be read
                    and need{needsIndustryReview.length === 1 ? 's' : ''} your answer.
                  </span></>
                )}
              </p>
            ) : (
              <p className="text-[13px] text-[var(--ink-soft)] mb-3">
                This file has no industry column. Choose one for the whole list, or leave it unstated.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <select value={defaultIndustry} onChange={e => setDefaultIndustry(e.target.value)}
                className="h-11 px-3 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] text-[14px] text-[var(--ink)] min-w-[16rem]">
                <option value="">Not stated</option>
                {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
              </select>
              {needsIndustryReview.length > 0 && defaultIndustry && (
                <button onClick={() => fixAllFlagged(defaultIndustry)}
                  className="h-11 px-3 rounded-xl bg-[var(--line-soft)] text-[13px] font-semibold text-[var(--ink)] hover:brightness-95 transition">
                  Use it for the {needsIndustryReview.length} unreadable row{needsIndustryReview.length === 1 ? '' : 's'}
                </button>
              )}
            </div>

            {fileNamesIndustry && defaultIndustry && (
              <label className="flex items-start gap-2 text-[13px] text-[var(--ink-soft)]">
                <input type="checkbox" checked={overrideRowIndustry} className="mt-0.5"
                  onChange={e => setOverrideRowIndustry(e.target.checked)} />
                <span>
                  Use <strong>{industryLabel(defaultIndustry)}</strong> for every row, overruling what the file says.
                  Off unless you mean it — the file is usually the better authority.
                </span>
              </label>
            )}

            {industryTally.length > 0 && (
              <p className="text-[12px] text-[var(--ink-faint)] mt-3 leading-snug">
                Will import as: {industryTally.map(([code, n]) =>
                  `${code === '—' ? 'Not stated' : industryLabel(code)} (${n})`).join(', ')}
              </p>
            )}
          </div>

          {/* What will happen */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              { label: 'Ready to import', value: validRows.length - duplicateCount, tone: 'var(--ok)' },
              { label: 'Already on file', value: checkedDuplicates ? duplicateCount : '—', tone: 'var(--ink-soft)' },
              { label: 'Cannot be used', value: invalidRows.length, tone: invalidRows.length ? 'var(--danger)' : 'var(--ink-soft)' },
              { label: 'Rows in the file', value: rows.length, tone: 'var(--ink-soft)' },
            ].map(s => (
              <div key={s.label} className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-3 text-center">
                <div className="font-display text-[22px] font-semibold tabular-nums" style={{ color: s.tone }}>{s.value}</div>
                <div className="text-[12px] text-[var(--ink-faint)] mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {unknownAssignees.length > 0 && (
            <div className="bg-[var(--warn-soft)] border border-[var(--warn)]/20 rounded-xl p-3">
              <p className="text-[13px] text-[var(--ink)]">
                {unknownAssignees.length} row{unknownAssignees.length === 1 ? '' : 's'} name a colleague who could not be
                matched{mayAssign ? '' : ', and you are not able to assign leads to other people'}. Those leads will be
                assigned the usual way instead.
              </p>
            </div>
          )}

          {/* The rows themselves */}
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 p-4 pb-2">
              <h2 className="font-display text-[17px] font-semibold text-[var(--ink)]">
                The first {Math.min(PREVIEW_ROWS, rows.length)} rows
              </h2>
              <button onClick={downloadProblemRows}
                className="text-[13px] font-medium text-[var(--accent)] hover:underline">
                Download rows needing attention
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ink-faint)] border-b border-[var(--line)]">
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Phone</th>
                    <th className="px-3 py-2 font-semibold">Course</th>
                    <th className="px-3 py-2 font-semibold">Industry</th>
                    {mayAssign && <th className="px-3 py-2 font-semibold">Assign to</th>}
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {prepared.slice(0, PREVIEW_ROWS).map(p => {
                    const dup = duplicates[p.index]
                    return (
                      <tr key={p.index} className="border-b border-[var(--line-soft)] last:border-0">
                        <td className="px-3 py-2 text-[var(--ink)] font-medium">{p.values.full_name || <span className="text-[var(--danger)]">—</span>}</td>
                        <td className="px-3 py-2 text-[var(--ink-soft)] tabular-nums">{p.values.phone || '—'}</td>
                        <td className="px-3 py-2 text-[var(--ink-soft)]">{p.values.course_interest || '—'}</td>
                        <td className="px-3 py-2">
                          <select
                            value={industryFix[p.index] ?? p.industry ?? ''}
                            onChange={e => setIndustryFix(c => ({ ...c, [p.index]: e.target.value }))}
                            className={`h-8 px-1.5 rounded-lg border text-[12px] bg-[var(--paper)] max-w-[11rem]
                              ${p.issues.includes('industry_unreadable')
                                ? 'border-[var(--warn)] text-[var(--warn)]'
                                : 'border-[var(--line)] text-[var(--ink-soft)]'}`}>
                            <option value="">Not stated</option>
                            {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
                          </select>
                          {p.issues.includes('industry_unreadable') && p.values.industry && (
                            <div className="text-[11px] text-[var(--warn)] mt-0.5 truncate max-w-[11rem]">
                              file says “{p.values.industry}”
                            </div>
                          )}
                        </td>
                        {mayAssign && (
                          <td className="px-3 py-2 text-[var(--ink-soft)]">
                            {p.assigneeName || (p.wantedAssignee
                              ? <span className="text-[var(--warn)]">no match</span>
                              : <span className="text-[var(--ink-faint)]">automatic</span>)}
                          </td>
                        )}
                        <td className="px-3 py-2">
                          {!p.valid
                            ? <span className="text-[var(--danger)]">{p.issues.map(describeIssue)[0]}</span>
                            : dup
                              ? <span className="text-[var(--ink-faint)]">already on file ({dup})</span>
                              : <span className="text-[var(--ok)]">will import</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {importing && progress && (
            <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-5" role="status" aria-live="polite">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <span className="text-[15px] font-semibold text-[var(--ink)]">Importing…</span>
                <span className="text-[13px] text-[var(--ink-soft)] tabular-nums">{progress.done} of {progress.total}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--line-soft)] overflow-hidden">
                <div className="h-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
              <p className="text-[12px] text-[var(--ink-faint)] mt-3">
                Sent in batches so a long list cannot time out. Please keep this page open.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={runImport} disabled={importing || !validRows.length || !mappedFields.has('full_name')}
              className="flex-1 min-w-[14rem] h-12 bg-[var(--accent)] text-white rounded-xl text-[15px] font-semibold hover:brightness-110 disabled:opacity-50 transition">
              {importing
                ? `Importing ${validRows.length} leads…`
                : `Import ${validRows.length - duplicateCount} lead${validRows.length - duplicateCount === 1 ? '' : 's'}`}
            </button>
            <button onClick={() => { setStep('choose'); setRows([]); setHeaders([]) }} disabled={importing}
              className="h-12 px-4 rounded-xl bg-[var(--line-soft)] text-[var(--ink-soft)] text-[14px] font-semibold hover:brightness-95 disabled:opacity-50 transition">
              Choose another file
            </button>
          </div>
          <p className="text-[12px] text-[var(--ink-faint)] text-center">
            Leads already on file are skipped. Nothing existing is overwritten or reassigned.
          </p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6 sm:p-8 max-w-lg mx-auto">
          <h2 className="font-display text-xl font-semibold text-[var(--ink)] mb-1">
            {result.status === 'complete' ? 'Import complete' : 'Import finished with problems'}
          </h2>
          <p className="text-[13px] font-mono text-[var(--ink-faint)] mb-5">{result.reference}</p>

          <dl className="space-y-2 mb-6 text-[14px]">
            {[
              { label: 'Rows received', value: result.totalReceived },
              { label: 'Assigned to a marketer', value: result.assigned },
              { label: 'Imported but unassigned', value: result.unassigned },
              { label: 'Already in the system', value: result.duplicates },
              { label: 'Could not be read', value: result.invalid },
              { label: 'Failed', value: result.failed },
              { label: 'Never reached the server', value: result.requestsFailed },
              { label: 'No industry recorded', value: result.withoutIndustry },
            ].map(r => (
              <div key={r.label} className="flex justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">{r.label}</dt>
                <dd className="font-semibold text-[var(--ink)] tabular-nums">{r.value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/leads/import/${result.reference}`}
              className="flex-1 min-w-[12rem] h-11 flex items-center justify-center rounded-xl bg-[var(--accent)] text-white text-[14px] font-semibold hover:brightness-110 transition">
              See every row and what happened to it
            </Link>
            <button onClick={() => { setStep('choose'); setRows([]); setHeaders([]); setResult(null) }}
              className="h-11 px-4 rounded-xl bg-[var(--line-soft)] text-[var(--ink-soft)] text-[14px] font-semibold hover:brightness-95 transition">
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function describeIssue(issue: RowIssue): string {
  switch (issue) {
    case 'no_name': return 'no name'
    case 'no_contact': return 'no usable phone or email'
    case 'industry_unreadable': return 'industry not recognised'
    case 'assignee_unknown': return 'the named colleague could not be matched'
  }
}
