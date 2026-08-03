'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Badge, Spinner, EmptyState } from '@/components/ui'

const TONE: Record<string, any> = {
  replied: 'success', ignored_not_lead: 'warning', paused: 'neutral',
  handoff: 'warning', no_reply: 'danger', error: 'danger',
}
const LABEL: Record<string, string> = {
  replied: 'Replied',
  ignored_not_lead: 'Not a lead — ignored',
  paused: 'Assistant paused',
  handoff: 'Handed to staff',
  no_reply: 'No reply produced',
  error: 'Could not read message',
}

export default function WebhookLogPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const load = () => {
    setLoading(true)
    fetch('/api/admin/inbound-log').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  const refetch = load
  const rows = data?.events || []

  return (
    <div className="fade-in w-full max-w-3xl">
      <PageHeader eyebrow="Diagnostics" title="Incoming WhatsApp"
        description="Every message WhatsApp delivers to the system, and what happened to it. If a lead says they got no reply, look here first."
        actions={<>
          <button onClick={async () => {
            const num = prompt('Enter a LEAD phone number to test with (their number, not staff):')
            if (!num) return
            const d = await fetch('/api/test/inbound', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: num.trim(), message: 'Hello, I want to know more' }),
            }).then(r => r.json()).catch(() => ({ error: 'failed' }))
            if (d.error) return alert(d.error)
            const lines = (d.steps || []).map((s: any) => `${s.ok ? 'OK  ' : 'FAIL'}  ${s.step}\n      ${s.detail}`).join('\n\n')
            alert(`${d.verdict}\n\n${lines}`)
            refetch()
          }} className="h-10 px-4 rounded-xl bg-[var(--accent)] text-white text-[13.5px] font-semibold">Test a reply</button>
          <button onClick={() => refetch()} className="h-10 px-4 rounded-xl border border-[var(--line)] text-[13.5px] font-semibold text-[var(--ink-soft)]">Refresh</button>
        </>} />

      {data && (
        <Card className="p-4 mb-5">
          <div className="text-[13.5px] text-[var(--ink)] font-medium mb-2">{data.verdict}</div>
          <div className="text-[12.5px] text-[var(--ink-soft)] space-y-0.5">
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
                  <div className="font-medium text-[var(--ink)] text-[14.5px]">
                    {String(r.phone || 'unknown').replace(/^233/, '0')}
                  </div>
                  {r.text && <div className="text-[13.5px] text-[var(--ink-soft)] mt-1 line-clamp-2">{r.text}</div>}
                  {r.detail && <div className="text-[12px] text-[var(--ink-faint)] mt-1.5 break-all">{r.detail}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  <Badge tone={TONE[r.outcome] || 'neutral'}>{LABEL[r.outcome] || r.outcome}</Badge>
                  <div className="text-[11.5px] text-[var(--ink-faint)] mt-1.5">
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
