'use client'
import { useState, useEffect } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { PageHeader, Card, Badge, Spinner, EmptyState, Button, inputClass } from '@/components/ui'
import { useConfirm } from '@/hooks/useConfirm'
import { canonicalContact } from '@/lib/ui/contact'
import { toast } from 'sonner'

const TONE: Record<string, any> = {
  replied: 'success', ignored_not_lead: 'warning', paused: 'neutral',
  handoff: 'warning', no_reply: 'danger', error: 'danger',
  wrong_fee_withheld: 'danger',
  unknown_line: 'warning', line_lookup_failed: 'warning',
}
const LABEL: Record<string, string> = {
  replied: 'Replied',
  ignored_not_lead: 'Not a lead — ignored',
  paused: 'Assistant paused',
  handoff: 'Handed to staff',
  no_reply: 'No reply produced',
  error: 'Could not read message',
  // The assistant produced a price nothing on file supports, so it was not
  // sent. Almost always a course record with no fee recorded.
  wrong_fee_withheld: 'Wrong fee — not sent',
  // A message arrived on a number no marketer has connected; usually a
  // marketer changed their line and their profile still holds the old one.
  unknown_line: 'Unrecognised WhatsApp line',
  line_lookup_failed: 'Could not check the line',
}

export default function WebhookLogPage() {
  const { notify, dialog } = useConfirm()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  /*
   * The number to test against, as a field on the page.
   *
   * This was a window.prompt(). Beyond being unstyled and thread-blocking, a
   * browser that has been told to suppress further dialogs returns null from
   * it — and the handler treated null as "cancelled", so the button quietly
   * did nothing forever. A field cannot be switched off by the browser, and
   * it keeps the number between attempts, which matters when the whole point
   * is to try the same number twice.
   */
  const [testPhone, setTestPhone] = useState('')
  const [testing, setTesting] = useState(false)
  const load = () => {
    setLoading(true)
    fetch('/api/admin/inbound-log').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  const refetch = load
  const rows = data?.events || []

  /*
   * Send one synthetic inbound message and report every step.
   *
   * The result is a list of steps with a verdict — far too much for a toast,
   * and it used to be printed with alert(), newlines and all. It is shown in
   * the application's own dialog now, so it can be read, kept open beside the
   * log below it, and copied.
   */
  async function runTest() {
    const phone = canonicalContact(testPhone)
    if (!phone) { toast.error('That is not a Ghanaian mobile number.'); return }

    setTesting(true)
    try {
      const d = await fetch('/api/test/inbound', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message: 'Hello, I want to know more' }),
      }).then(r => r.json()).catch(() => ({ error: 'The test request failed.' }))

      if (d.error) { toast.error(d.error); return }

      const steps: Array<{ ok: boolean; step: string; detail: string }> = d.steps || []
      await notify({
        title: d.verdict || 'Test complete',
        confirmLabel: 'Close',
        message: steps.length === 0 ? (
          <p>The test ran but reported no steps.</p>
        ) : (
          <ol className="space-y-2.5">
            {steps.map((st, i) => (
              <li key={i} className="flex gap-2.5">
                <Badge tone={st.ok ? 'success' : 'danger'}>{st.ok ? 'OK' : 'Failed'}</Badge>
                <span className="min-w-0">
                  <span className="block font-medium text-[var(--ink)]">{st.step}</span>
                  <span className="block text-[13px] text-[var(--ink-soft)] break-words">{st.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        ),
      })
      refetch()
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {dialog}
      <PageHeader eyebrow="Diagnostics" title="Incoming WhatsApp"
        description="Every message WhatsApp delivers to the system, and what happened to it. If a lead says they got no reply, look here first."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              placeholder="Lead's number, e.g. 0244 000 000"
              aria-label="A lead's phone number to test a reply against"
              inputMode="tel"
              className={inputClass + ' w-[220px]'}
            />
            <Button disabled={testing || !canonicalContact(testPhone)} onClick={runTest}>
              {testing ? 'Testing…' : 'Test a reply'}
            </Button>
            <Button variant="secondary" onClick={() => refetch()}>Refresh</Button>
          </div>
        } />

      {data && (
        <Card className="p-4 mb-5">
          <div className="text-[13px] text-[var(--ink)] font-medium mb-2">{data.verdict}</div>
          <div className="text-[12px] text-[var(--ink-soft)] space-y-0.5">
            <div>From leads in 24h: <b>{data.last24h?.messagesFromLeads ?? 0}</b> · sent by us: <b>{data.last24h?.messagesWeSent ?? 0}</b></div>
            <div>WaSender key: <b>{data.setup?.wasenderKey}</b> · AI key: <b>{data.setup?.openaiKey}</b></div>
            <div className="break-all">Webhook URL: <b>{data.setup?.webhookUrl}</b></div>
          </div>
        </Card>
      )}

      {loading ? <Spinner /> : !rows?.length ? (
        <EmptyState title="Nothing received yet"
          description="If leads are messaging and nothing appears here, WhatsApp is not delivering to the system — check the webhook URL in WaSender." />
      ) : (
        <div className="space-y-2">
          {rows.map((r: any) => (
            <Card key={r.at + String(r.phone)} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--ink)] text-[14px]">
                    {r.phone ? displayPhone(String(r.phone)) : 'unknown'}
                  </div>
                  {r.text && <div className="text-[13px] text-[var(--ink-soft)] mt-1 line-clamp-2">{r.text}</div>}
                  {r.detail && <div className="text-[12px] text-[var(--ink-faint)] mt-1.5 break-all">{r.detail}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  <Badge tone={TONE[r.outcome] || 'neutral'}>{LABEL[r.outcome] || r.outcome}</Badge>
                  <div className="text-[11px] text-[var(--ink-faint)] mt-1.5">
                    {new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
