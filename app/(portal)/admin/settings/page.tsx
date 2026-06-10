'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Settings, Bell, Globe, Shield } from 'lucide-react'

export default function SettingsPage() {
  const [testing, setTesting] = useState<string | null>(null)

  async function testSMS() {
    setTesting('sms')
    const res = await fetch('/api/test/sms', { method: 'POST' })
    const d = await res.json()
    d.success ? toast.success('Test SMS sent!') : toast.error('SMS failed: ' + d.error)
    setTesting(null)
  }

  async function testWhatsApp() {
    setTesting('wa')
    const res = await fetch('/api/test/whatsapp', { method: 'POST' })
    const d = await res.json()
    d.success ? toast.success('Test WhatsApp sent!') : toast.error('WA failed: ' + d.error)
    setTesting(null)
  }

  const webhooks = [
    { label: 'Facebook Lead Ads', url: '/api/webhooks/facebook', method: 'POST + GET (verification)' },
    { label: 'Google Lead Forms', url: '/api/webhooks/google', method: 'POST' },
    { label: 'LinkedIn Lead Gen', url: '/api/webhooks/linkedin', method: 'POST' },
    { label: 'Website Forms', url: '/api/webhooks/website', method: 'POST' },
    { label: 'Paystack Payments', url: '/api/webhooks/paystack', method: 'POST' },
  ]

  return (
    <div className="fade-in max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Configure integrations and system preferences</p>
      </div>

      {/* Integrations status */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Settings size={18} className="text-gray-600" />
          <h3 className="text-sm font-bold text-gray-900">Integration Status</h3>
        </div>
        <div className="space-y-3">
          {[
            { name: 'Supabase', key: 'NEXT_PUBLIC_SUPABASE_URL', status: 'connected' },
            { name: 'Arkesel SMS', key: 'ARKESEL_API_KEY', status: 'connected' },
            { name: 'WAWP WhatsApp', key: 'WAWP_INSTANCE_ID', status: 'configure' },
            { name: 'Paystack', key: 'PAYSTACK_SECRET_KEY', status: 'configure' },
            { name: 'Resend Email', key: 'RESEND_API_KEY', status: 'configure' },
          ].map(i => (
            <div key={i.name} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm font-medium text-gray-900">{i.name}</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${i.status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {i.status === 'connected' ? '✓ Connected' : 'Needs key'}
                </span>
                <code className="text-[10px] text-gray-400 font-mono">{i.key}</code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Test notifications */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={18} className="text-gray-600" />
          <h3 className="text-sm font-bold text-gray-900">Test Notifications</h3>
        </div>
        <p className="text-xs text-gray-400 mb-4">Send a test message to verify your integrations are working.</p>
        <div className="flex gap-3">
          <button onClick={testSMS} disabled={testing === 'sms'}
            className="flex-1 h-10 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition">
            {testing === 'sms' ? 'Sending...' : 'Test SMS'}
          </button>
          <button onClick={testWhatsApp} disabled={testing === 'wa'}
            className="flex-1 h-10 bg-[#25D366] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition">
            {testing === 'wa' ? 'Sending...' : 'Test WhatsApp'}
          </button>
        </div>
      </div>

      {/* Webhook URLs */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Globe size={18} className="text-gray-600" />
          <h3 className="text-sm font-bold text-gray-900">Webhook Endpoints</h3>
        </div>
        <p className="text-xs text-gray-400 mb-4">Configure these URLs in your ad platform dashboards.</p>
        <div className="space-y-3">
          {webhooks.map(w => (
            <div key={w.label} className="p-3 bg-gray-50 rounded-xl">
              <div className="text-xs font-bold text-gray-700 mb-1">{w.label}</div>
              <code className="text-[11px] text-blue-600 break-all block">
                {process.env.NEXT_PUBLIC_APP_URL}{w.url}
              </code>
              <div className="text-[10px] text-gray-400 mt-0.5">Method: {w.method}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
