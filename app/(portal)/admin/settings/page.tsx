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
  const [fbPage, setFbPage] = useState<any>(null)
  const [fbBusy, setFbBusy] = useState(false)

  async function checkFbPage() {
    setFbBusy(true)
    try {
      const d = await fetch('/api/facebook/connect-page').then(r => r.json())
      setFbPage(d)
      if (d.error) toast.error(d.error); else toast.success(`Token points to: ${d.name}`)
    } catch { toast.error('Could not check') } finally { setFbBusy(false) }
  }
  async function connectFbPage() {
    setFbBusy(true)
    try {
      const d = await fetch('/api/facebook/connect-page', { method: 'POST' }).then(r => r.json())
      if (d.error) { setFbPage(d); toast.error(d.error) }
      else { setFbPage(d.page); toast.success(`Connected ${d.page?.name}! Real leads will now flow in.`) }
    } catch { toast.error('Could not connect') } finally { setFbBusy(false) }
  }
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
    { label: 'Facebook Lead Ads', url: '/api/webhooks/facebook', platform: 'facebook', hint: 'In Meta Events Manager, add this as your Lead Ads webhook callback URL and subscribe to the "leadgen" field.' },
    { label: 'Instagram Lead Ads', url: '/api/webhooks/facebook', platform: 'facebook', hint: 'Instagram lead ads use the same Meta webhook as Facebook.' },
    { label: 'Google Lead Forms', url: '/api/webhooks/google', platform: 'google', hint: 'In your Google Lead Form extension, set this as the webhook URL and add your secret key.' },
    { label: 'LinkedIn Lead Gen', url: '/api/webhooks/linkedin', platform: 'linkedin', hint: 'Connect via LinkedIn lead sync (often through Zapier/Make) pointing at this URL.' },
    { label: 'Website Forms', url: '/api/webhooks/website', platform: 'website', hint: 'POST your landing-page form submissions here (full_name, email, phone, course_interest, referrer_code).' },
    { label: 'Paystack Payments', url: '/api/webhooks/paystack', platform: 'paystack', hint: 'In your Paystack dashboard, set this as the webhook URL.' },
    { label: 'WhatsApp Replies (AI assistant)', url: '/api/webhooks/whatsapp', platform: 'whatsapp', hint: 'In WAWP, point the incoming-message webhook here so the AI can reply to leads.' },
  ]

  function copy(text: string) { navigator.clipboard.writeText(text); toast.success('Copied') }

  return (
    <div className="fade-in w-full">
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
                ? <span className="flex items-center gap-1 text-[var(--ok)] text-xs font-medium flex-shrink-0">{i.detail}</span>
                : <span className="flex items-center gap-1 text-[var(--ink-faint)] text-xs font-medium flex-shrink-0">{i.detail}</span>}
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
          <Button onClick={testSMS} disabled={testing === 'sms'} >{testing === 'sms' ? 'Sending…' : 'Test SMS'}</Button>
          <Button variant="secondary" onClick={testWhatsApp} disabled={testing === 'wa'} >{testing === 'wa' ? 'Sending…' : 'Test WhatsApp'}</Button>
        </div>
        {result && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${result.success ? 'bg-[var(--ok-soft)] text-emerald-800' : 'bg-[var(--warn-soft)] text-amber-800'}`}>
            <div className="font-medium mb-1">{result.channel}: {result.success ? 'Delivered to provider' : 'Not delivered'}</div>
            {result.hint && <div className="text-xs">{result.hint}</div>}
            {result.arkeselResponse && <div className="text-[12px] font-mono mt-1 opacity-70">{JSON.stringify(result.arkeselResponse)}</div>}
          </div>
        )}
      </Card>

      {/* Lead connections / Webhooks */}
      <SectionLabel>Lead connections</SectionLabel>
      <p className="text-sm text-[var(--ink-soft)] mb-4 -mt-2">
        Connect your ad platforms so leads flow straight into the system and auto-assign to your team. Copy each URL into that platform's lead/webhook settings.
      </p>

      {/* Facebook Page subscription — the step that makes REAL leads flow */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--ink)]">Facebook Page connection</div>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              {fbPage ? (fbPage.error ? <span className="text-[var(--danger)]">{fbPage.error}</span> : <>Connected to <b>{fbPage.name}</b></>) : 'Subscribe your Page so real lead-ad submissions reach the system.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={checkFbPage} disabled={fbBusy}>Check</Button>
            <Button size="sm" onClick={connectFbPage} disabled={fbBusy}>{fbBusy ? 'Connecting…' : 'Connect Page'}</Button>
          </div>
        </div>
      </Card>

      <Card className="divide-y divide-[var(--line-soft)]">
        {webhooks.map((w, i) => (
          <div key={w.label + i} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--ink)]">{w.label}</div>
                <code className="text-xs text-[var(--ink-faint)] font-mono break-all">{CONFIG.appUrl}{w.url}</code>
              </div>
              <Button variant="ghost" size="sm" onClick={() => copy(`${CONFIG.appUrl}${w.url}`)} >Copy</Button>
            </div>
            {w.hint && <p className="text-[12px] text-[var(--ink-faint)] mt-2 leading-relaxed">{w.hint}</p>}
          </div>
        ))}
      </Card>
    </div>
  )
}
