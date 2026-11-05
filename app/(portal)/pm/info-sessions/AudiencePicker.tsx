'use client'
import { useEffect, useState } from 'react'
import { Field, inputClass } from '@/components/ui'
import { DATE_PRESETS, type AudienceFilter } from '@/lib/leads/audienceFilter'
import { industryLabel } from '@/lib/leads/industry'
import { describeStatus } from '@/lib/ui/status'

/**
 * CHOOSING EXACTLY WHO AN INVITATION GOES TO.
 *
 * ── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 *
 * One dropdown with three entries: all active leads, uncontacted, or
 * interested. "The people who came in last month who want PMP" could not be
 * asked for, so the invitation went to everybody.
 *
 * ── HOW IT READS ───────────────────────────────────────────────────────────
 *
 * Within a row, the values chosen are alternatives. Between rows, they narrow
 * each other. That is the only combination rule, because a filter whose
 * result nobody can predict is a filter nobody should trust with eight
 * hundred text messages — and it is stated on the screen, not just here.
 */

export type Options = {
  statuses: string[]; sources: string[]; landingSources: string[]
  courses: string[]; industries: string[]
  owners: Array<{ id: string; name: string }>
}

/**
 * One condition: a label, the values it can take, and which are chosen.
 *
 * Defined here rather than inside AudiencePicker — a component created during
 * a render is a new type on every render, so React throws its state away and
 * remounts it, which on a filter means losing focus mid-click.
 */
function Row({
  label, hint, values, chosen, onToggle, onClear, labelFor,
}: {
  label: string
  hint?: string
  values: string[]
  chosen: string[]
  onToggle: (value: string) => void
  onClear: () => void
  labelFor?: (value: string) => string
}) {
  if (!values.length) return null
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[13px] font-medium text-[var(--ink-soft)]">{label}</span>
        {chosen.length > 0 && (
          <button type="button" onClick={onClear}
            className="text-[12px] text-[var(--accent)] hover:underline">Clear</button>
        )}
      </div>
      {hint && <p className="text-[12px] text-[var(--ink-faint)] mb-1.5">{hint}</p>}
      <div className="flex flex-wrap gap-1.5">
        {values.map(v => {
          const on = chosen.includes(v)
          return (
            <button key={v} type="button" onClick={() => onToggle(v)} aria-pressed={on}
              className={`h-11 sm:h-8 px-2.5 rounded-lg border text-[12px] font-medium transition
                ${on
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--ink-faint)]'}`}>
              {labelFor ? labelFor(v) : v.replace(/_/g, ' ')}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function AudiencePicker({
  filter, onChange,
}: {
  filter: AudienceFilter
  onChange: (next: AudienceFilter) => void
}) {
  const [options, setOptions] = useState<Options | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/info-sessions/audience')
      .then(r => r.json())
      .then(d => (d.success ? setOptions(d) : setError(d.error || 'The filter options could not be loaded.')))
      .catch(() => setError('The filter options could not be loaded.'))
  }, [])

  const toggle = (key: keyof AudienceFilter, value: string) => {
    const current = (filter[key] as string[] | undefined) || []
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value]
    onChange({ ...filter, [key]: next.length ? next : undefined })
  }

  const chosen = (key: keyof AudienceFilter) => ((filter[key] as string[] | undefined) || [])

  if (error) return <p className="text-[13px] text-[var(--danger)]">{error}</p>
  if (!options) return <p className="text-[13px] text-[var(--ink-faint)]">Loading the lead details…</p>

  return (
    <div className="space-y-4">
      <Field label="Added to the system">
        <select className={inputClass} value={filter.addedWithin || 'any'}
          onChange={e => onChange({ ...filter, addedWithin: e.target.value as AudienceFilter['addedWithin'] })}>
          {DATE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </Field>

      {filter.addedWithin === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <input type="date" className={inputClass} value={filter.addedFrom || ''}
              onChange={e => onChange({ ...filter, addedFrom: e.target.value })} />
          </Field>
          <Field label="To">
            <input type="date" className={inputClass} value={filter.addedTo || ''}
              onChange={e => onChange({ ...filter, addedTo: e.target.value })} />
          </Field>
        </div>
      )}

      <Row label="Lead status" values={options.statuses} chosen={chosen('statuses')} onToggle={v => toggle('statuses', v)} onClear={() => onChange({ ...filter, statuses: undefined })}
        labelFor={v => describeStatus('lead', v).label} />
      <Row label="Source" values={options.sources} chosen={chosen('sources')} onToggle={v => toggle('sources', v)} onClear={() => onChange({ ...filter, sources: undefined })} />
      <Row label="Came in through" hint="How the lead arrived — a named import, or entered by hand."
        values={options.landingSources} chosen={chosen('landingSources')} onToggle={v => toggle('landingSources', v)} onClear={() => onChange({ ...filter, landingSources: undefined })} />
      <Row label="Course of interest" values={options.courses} chosen={chosen('courses')} onToggle={v => toggle('courses', v)} onClear={() => onChange({ ...filter, courses: undefined })} />
      <Row label="Industry" values={options.industries} chosen={chosen('industries')} onToggle={v => toggle('industries', v)} onClear={() => onChange({ ...filter, industries: undefined })}
        labelFor={v => industryLabel(v)} />
      <Row label="Assigned to" values={options.owners.map(o => o.id)}
        chosen={chosen('owners')} onToggle={v => toggle('owners', v)}
        onClear={() => onChange({ ...filter, owners: undefined })}
        labelFor={v => options.owners.find(o => o.id === v)?.name || 'Unknown'} />

      <p className="text-[12px] text-[var(--ink-faint)] leading-snug border-t border-[var(--line-soft)] pt-3">
        Within a row, any of the choices counts. Between rows, each one narrows the last —
        so “last month” and “PMP” means leads added last month <em>and</em> interested in PMP.
      </p>
    </div>
  )
}
