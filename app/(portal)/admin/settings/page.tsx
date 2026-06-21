'use client'
import { CONFIG } from '@/lib/config'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Globe, Send, CheckCircle2, AlertCircle, Copy, MessageSquare, CreditCard, Mail, Database, Smartphone, Sparkles } from 'lucide-react'
import { PageHeader, Card, Button, Badge, SectionLabel, Field, inputClass, Spinner } from '@/components/ui'

export default function SettingsPage() {
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<string | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [result, setResult] = useState<any>(null)
  const [autoAssign, setAutoAssign] = useState(true)
  const [savingToggle, setSavingToggle] = useState(false)

  async function loadStatus() {
    try {
      const r = await fetch('/api/config-status').then(r => r.json())
      setStatus(r)
    } catch {} finally { setLoading(false) }
  }
  useEffect(() => { loadStatus() }, [])

  useEffect(() => {
    // Load the auto-assign toggle
    const params = new URLSearchParams({ table: 'settings', select: '*', filters: JSON.stringify([{ col: 'key', op: 'eq', val: 'auto_assign_leads' }]), limit: '1' })
    fetch(`/api/data?${params}`).then(r => r.ok ? r.json() : { data: [] }).then(d => {
      const v = d.data?.[0]?.value
      if (v != null) setAutoAssign(v !== 'false')
    }).catch(() => {})
  }, [])

  async function toggleAutoAssign(next: boolean) {
    setAutoAssign(next)
    setSavingToggle(true)
    try {
      // upsert the setting
      await fetch('/api/data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'settings', data: { key: 'auto_assign_leads', value: next ? 'true' : 'false' }, upsert: true, onConflict: 'key' }),
      })
    } catch {}
    finally { setSavingToggle(false) }
  }

  async function testSMS() {
    if (!testPhone) { toast.error('Enter a phone number to test'); return }
    setTesting('sms'); setResult(null)
    try {
      const res = await fetch('/api/test/sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: testPhone }) })
      const d = await res.json()
      setResult({ channel: 'SMS', ...d })
      d.success ? toast.success('Test SMS sent — check the phone') : toast.error(d.hint || 'SMS failed')
    } catch (e: any) { toast.error(e.message) }
    finally { setTesting(null) }
  }

  async function testWhatsApp() {
    setTesting('wa'); setResult(null)
    try {
      const res = await fetch('/api/test/whatsapp', { method: 'POST' })
      const d = await res.json()
      setResult({ channel: 'WhatsApp', ...d })
      d.success ? toast.success('Test WhatsApp sent') : toast.error('WhatsApp not connected yet')
    } catch (e: any) { toast.error(e.message) }
    finally { setTesting(null) }
  }

  const integrations = status ? [
    { name: 'Database', desc: 'Supabase', icon: Database, ok: status.supabase, detail: status.supabase ? 'Connected' : 'Not configured' },
    { name: 'SMS', desc: `Arkesel · sender "${status.senderId}"`, icon: Smartphone, ok: status.arkesel, detail: status.arkesel ? 'Active' : 'No API key' },
    { name: 'Payments', desc: 'Paystack', icon: CreditCard, ok: status.paystack, detail: status.paystack ? (status.paystackLive ? 'Live keys active' : 'Test keys') : 'Not configured' },
    { name: 'WhatsApp', desc: `${status.wawpLines} line${status.wawpLines === 1 ? '' : 's'} connected`, icon: MessageSquare, ok: status.wawpLines > 0 || status.wawpCentral, detail: status.wawpLines > 0 ? `${status.wawpLines} connected` : status.wawpCentral ? 'Central line set' : 'No lines yet' },
    { name: 'AI assistant', desc: 'Auto-answers WhatsApp inquiries', icon: Sparkles, ok: status.ai, detail: status.ai ? 'Active' : 'Add Anthropic key' },
    { name: 'Email', desc: 'Resend', icon: Mail, ok: status.resend, detail: status.resend ? 'Active' : 'Optional — not set' },
    { name: 'File storage', desc: 'Cloudinary · certificates, receipts, brochures', icon: Database, ok: status.cloudinary, detail: status.cloudinary ? 'Connected' : 'Add Cloudinary keys' },
  ] : []

  const webhooks = [
    { label: 'Facebook Lead Ads', url: '/api/webhooks/facebook' },
    { label: 'Google Lead Forms', url: '/api/webhooks/google' },
    { label: 'Paystack Payments', url: '/api/webhooks/paystack' },
    { label: 'Website Forms', url: '/api/webhooks/website' },
    { label: 'WhatsApp Replies (AI assistant)', url: '/api/webhooks/whatsapp' },
  ]

  function copy(text: string) { navigator.clipboard.writeText(text); toast.success('Copied') }

  return (
    <div className="fade-in w-full max-w-4xl mx-auto">
      <PageHeader eyebrow="System" title="Settings" description="Integrations, delivery tests and webhook endpoints." />

      {/* Lead assignment */}
      <SectionLabel>Lead assignment</SectionLabel>
      <Card className="p-5 mb-10">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--ink)]">Auto-assign new leads</div>
            <p className="text-sm text-[var(--ink-soft)] mt-0.5">When on, leads from Facebook, the website and other sources are automatically shared out to your marketers (round-robin, lightest workload first). When off, new leads stay unassigned for a manager to distribute.</p>
          </div>
          <button
            role="switch" aria-checked={autoAssign} disabled={savingToggle}
            onClick={() => toggleAutoAssign(!autoAssign)}
            className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors ${autoAssign ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'} disabled:opacity-60`}>
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${autoAssign ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </Card>

      {/* Integrations */}
      <SectionLabel>Integrations</SectionLabel>
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
          {integrations.map(i => (
            <Card key={i.name} className="p-4 flex items-center gap-3.5">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${i.ok ? 'bg-[var(--accent-soft)]' : 'bg-[var(--line-soft)]'}`}>
                <i.icon size={18} className={i.ok ? 'text-[var(--accent)]' : 'text-[var(--ink-faint)]'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[var(--ink)] text-sm">{i.name}</div>
                <div className="text-xs text-[var(--ink-faint)] truncate">{i.desc}</div>
              </div>
              {i.ok
                ? <span className="flex items-center gap-1 text-[var(--ok)] text-xs font-medium flex-shrink-0"><CheckCircle2 size={14} />{i.detail}</span>
                : <span className="flex items-center gap-1 text-[var(--ink-faint)] text-xs font-medium flex-shrink-0"><AlertCircle size={14} />{i.detail}</span>}
            </Card>
          ))}
        </div>
      )}

      {/* Delivery test */}
      <SectionLabel>Test delivery</SectionLabel>
      <Card className="p-5 mb-10">
        <p className="text-sm text-[var(--ink-soft)] mb-4">Send a real test message to confirm your providers are working.</p>
        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="Your phone, e.g. 0244 000 000" className={inputClass + ' flex-1'} />
          <Button onClick={testSMS} disabled={testing === 'sms'} icon={<Send size={14} />}>{testing === 'sms' ? 'Sending…' : 'Test SMS'}</Button>
          <Button variant="secondary" onClick={testWhatsApp} disabled={testing === 'wa'} icon={<MessageSquare size={14} />}>{testing === 'wa' ? 'Sending…' : 'Test WhatsApp'}</Button>
        </div>
        {result && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${result.success ? 'bg-[var(--ok-soft)] text-emerald-800' : 'bg-[var(--warn-soft)] text-amber-800'}`}>
            <div className="font-medium mb-1">{result.channel}: {result.success ? 'Delivered to provider' : 'Not delivered'}</div>
            {result.hint && <div className="text-xs">{result.hint}</div>}
            {result.arkeselResponse && <div className="text-[11px] font-mono mt-1 opacity-70">{JSON.stringify(result.arkeselResponse)}</div>}
          </div>
        )}
      </Card>

      {/* Webhooks */}
      <SectionLabel>Webhook endpoints</SectionLabel>
      <Card className="divide-y divide-[var(--line-soft)]">
        {webhooks.map(w => (
          <div key={w.url} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--ink)]">{w.label}</div>
              <code className="text-xs text-[var(--ink-faint)] font-mono break-all">{CONFIG.appUrl}{w.url}</code>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copy(`${CONFIG.appUrl}${w.url}`)} icon={<Copy size={13} />}>Copy</Button>
          </div>
        ))}
      </Card>
    </div>
  )
}
