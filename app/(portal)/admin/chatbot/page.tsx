'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { PageHeader, Card, Badge, Spinner, Button } from '@/components/ui'

/**
 * CHATBOT — OVERVIEW.
 *
 * ── WHY THIS PAGE AND NOT ANOTHER ──────────────────────────────────────────
 *
 * Everything the assistant needs already had a home in this portal before
 * this page existed: the connected lines at /admin/whatsapp, what it knows at
 * /admin/knowledge, what it has said at /admin/conversations, what arrived at
 * /admin/webhook-log, and the people waiting on a human in the marketer's own
 * "Waiting for you" queue. None of that is duplicated here and none of it was
 * moved.
 *
 * What was missing was the one question a manager actually opens a portal to
 * ask — "is it working?" — which could only be answered by visiting five
 * screens and inferring. /api/admin/chatbot-check already computed the whole
 * answer and nothing rendered it.
 *
 * ── THE DISTINCTION THIS PAGE REFUSES TO BLUR ──────────────────────────────
 *
 * A channel that has deliberately not been connected is NOT a fault. WhatsApp
 * and SMS credentials are held back on purpose, so the readiness endpoint
 * reports core health and integrations separately and the verdict comes from
 * core alone. A page that showed one red total would be reporting a decision
 * the centre made as a failure of the system — and warnings nobody believes
 * are warnings nobody reads.
 */

type Check = {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  fix?: string
  scope: 'core' | 'integration'
}

type Readiness = {
  status: 'ok' | 'warn' | 'fail'
  summary: string
  integrationSummary: string
  checks: Check[]
  integrations: Check[]
}

const TONE = { ok: 'success', warn: 'warning', fail: 'danger' } as const
const WORD = { ok: 'Ready', warn: 'Partly ready', fail: 'Needs attention' } as const

/** The places the assistant's work actually lives. Nothing here is new. */
const GOES_TO = [
  { href: '/admin/whatsapp', label: 'Connected WhatsApp lines',
    note: 'Which marketer each number belongs to.' },
  { href: '/admin/conversations', label: 'Conversations',
    note: 'Every exchange, with the lead it belongs to.' },
  { href: '/admin/knowledge', label: 'Knowledge',
    note: 'What the assistant is allowed to answer from.' },
  { href: '/admin/webhook-log', label: 'Incoming activity',
    note: 'What arrived, and what was done with it.' },
  { href: '/admin/leads', label: 'Leads',
    note: 'Where every conversation becomes a person. There is no separate list.' },
]

export default function ChatbotOverviewPage() {
  const [data, setData] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)
  /** Bumped by "Re-check" to ask the effect below to run again. */
  const [attempt, setAttempt] = useState(0)

  /*
   * Try it, without a WhatsApp account.
   *
   * Everything except the transport can be exercised today — lead resolution,
   * the real fees, the knowledge base, intent, the money guard, the handover
   * decision. Waiting for credentials to find out whether any of it is right
   * would mean discovering it in front of a customer.
   */
  type Sim = {
    lead: { found: boolean; name: string | null; assigned: boolean }
    programme: { name: string; feeInPerson: number | null; feeOnline: number | null } | null
    reply: {
      text: string | null; intent: string; stage: string
      handoff: string | null; skipped: string | null
      attachment: string | null; actions: string[]
    }
    whatsappConnected: boolean
  }
  const [simPhone, setSimPhone] = useState('')
  const [simText, setSimText] = useState('')
  const [sim, setSim] = useState<Sim | null>(null)
  const [simError, setSimError] = useState<string | null>(null)
  const [simBusy, setSimBusy] = useState(false)

  async function runSimulation() {
    setSimBusy(true); setSimError(null); setSim(null)
    try {
      const res = await fetch('/api/admin/chatbot-simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: simPhone, message: simText }),
      })
      const d = await res.json()
      if (!res.ok) setSimError(d.error || 'That did not run.')
      else setSim(d)
    } catch {
      setSimError('That did not run. Please try again.')
    } finally {
      setSimBusy(false)
    }
  }

  /*
   * The effect starts the request and nothing else.
   *
   * `loading` already begins true, so there is no state to set on the way in —
   * which keeps this clear of set-state-in-effect rather than suppressing it.
   * `alive` matters for real here: a manager who clicks Re-check and leaves
   * would otherwise have the response land on an unmounted page.
   */
  useEffect(() => {
    let alive = true
    fetch('/api/admin/chatbot-check')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { if (alive) { setData(d); setFailed(null); setLoading(false) } })
      .catch(() => {
        if (!alive) return
        // Not "everything is fine" and not "everything is broken" — say which.
        setFailed('The readiness check could not be reached. This page cannot tell you whether the assistant is working.')
        setLoading(false)
      })
    return () => { alive = false }
  }, [attempt])

  // An event handler, so setting state here is exactly where it belongs.
  const recheck = () => { setLoading(true); setAttempt(n => n + 1) }

  return (
    <div>
      <PageHeader
        eyebrow="Chatbot"
        title="Overview"
        description="Whether the assistant can do its job, and where its work is kept."
        actions={<Button onClick={recheck} variant="secondary">Re-check</Button>}
      />

      {/*
        Deliberately says "nothing is sent" on the panel itself, not only in
        the response. An administrator testing a phrasing against a real
        lead's context must never wonder whether they just texted them.
      */}
      <Card className="p-4 sm:p-5 mb-5">
        <h2 className="text-[14px] font-semibold text-[var(--ink)]">Try the assistant</h2>
        <p className="t-sub mt-1">
          Runs the real assistant against a real lead&rsquo;s context. Nothing is sent,
          nothing is saved, and the lead is not contacted.
        </p>

        <div className="mt-3 space-y-2.5">
          <input
            value={simPhone} onChange={e => setSimPhone(e.target.value)}
            inputMode="tel" placeholder="Lead's phone, e.g. 0201234567"
            className="w-full h-11 rounded-xl border border-[var(--line)] bg-[var(--canvas)]
              px-3.5 text-[14px] text-[var(--ink)]" />
          <textarea
            value={simText} onChange={e => setSimText(e.target.value)}
            rows={2} placeholder="What would they say? e.g. How much is virtual PMP?"
            className="w-full rounded-xl border border-[var(--line)] bg-[var(--canvas)]
              px-3.5 py-2.5 text-[14px] text-[var(--ink)] resize-y" />
          <Button onClick={runSimulation} disabled={simBusy || !simPhone.trim() || !simText.trim()}>
            {simBusy ? 'Running…' : 'Run'}
          </Button>
        </div>

        {simError && <p className="mt-3 text-[13px] text-[var(--bad)]">{simError}</p>}

        {sim && (
          <div className="mt-4 space-y-3 border-t border-[var(--line-soft)] pt-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={sim.lead.found ? 'success' : 'warning'}>
                {sim.lead.found ? `Lead: ${sim.lead.name || 'unnamed'}` : 'Not a lead yet'}
              </Badge>
              {sim.programme && <Badge tone="neutral">{sim.programme.name}</Badge>}
              <Badge tone="neutral">{sim.reply.intent}</Badge>
              <Badge tone="neutral">{sim.reply.stage}</Badge>
              {sim.reply.handoff && <Badge tone="warning">Hands over: {sim.reply.handoff}</Badge>}
              {sim.reply.skipped && <Badge tone="danger">Withheld: {sim.reply.skipped}</Badge>}
            </div>

            <div className="rounded-xl bg-[var(--canvas)] border border-[var(--line)] p-3.5">
              <p className="text-[14px] text-[var(--ink)] whitespace-pre-wrap">
                {sim.reply.text || <span className="text-[var(--ink-faint)]">No reply — see the badges above.</span>}
              </p>
            </div>

            <p className="t-meta">
              Not sent. WhatsApp is {sim.whatsappConnected ? 'connected' : 'not connected yet'}.
            </p>
          </div>
        )}
      </Card>

      {loading && <div className="py-12 flex justify-center"><Spinner /></div>}

      {!loading && failed && (
        <Card className="p-5 mb-5">
          <div className="flex items-start gap-3">
            <Badge tone="warning">Unknown</Badge>
            <p className="text-sm text-[var(--ink-soft)] flex-1 min-w-0">{failed}</p>
          </div>
        </Card>
      )}

      {!loading && data && (
        <>
          {/* ── The verdict, from core checks only ── */}
          <Card className="p-5 mb-5">
            <div className="flex flex-wrap items-center gap-3 mb-1.5">
              <Badge tone={TONE[data.status]}>{WORD[data.status]}</Badge>
            </div>
            <p className="text-sm text-[var(--ink-soft)]">{data.summary}</p>
          </Card>

          <CheckList title="The assistant itself" checks={data.checks} />

          {/* ── Deferred, and labelled as a decision rather than a fault ── */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold mb-1">Outside connections</h2>
            <p className="text-xs text-[var(--ink-faint)] mb-3">
              {data.integrationSummary} A channel that has not been connected yet is deferred,
              not broken — messages are recorded so everything else still works end to end.
            </p>
            <CheckList checks={data.integrations} deferred />
          </div>
        </>
      )}

      {/* ── Where the work lives. Links, not copies. ── */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold mb-1">Where the assistant&rsquo;s work is kept</h2>
        <p className="text-xs text-[var(--ink-faint)] mb-3">
          These are the portal&rsquo;s own screens. The assistant writes into them —
          it keeps no separate list of leads, conversations or courses.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {GOES_TO.map(l => (
            <Link key={l.href} href={l.href} className="block">
              <Card hover className="p-4 h-full">
                <div className="text-sm font-medium">{l.label}</div>
                <div className="text-xs text-[var(--ink-faint)] mt-0.5">{l.note}</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function CheckList({ title, checks, deferred = false }: {
  title?: string
  checks: Check[]
  deferred?: boolean
}) {
  if (!checks?.length) return null
  return (
    <div>
      {title && <h2 className="text-sm font-semibold mb-3">{title}</h2>}
      <div className="grid gap-2">
        {checks.map(c => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 pt-0.5">
                <Badge tone={deferred && c.status !== 'ok' ? 'muted' : TONE[c.status]}>
                  {deferred && c.status !== 'ok' ? 'Deferred' : WORD[c.status]}
                </Badge>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-xs text-[var(--ink-soft)] mt-0.5">{c.detail}</div>
                {c.fix && c.status !== 'ok' && (
                  <div className="text-xs text-[var(--ink-faint)] mt-1.5">{c.fix}</div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
