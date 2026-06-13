'use client'
import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Loader, Copy, ExternalLink, RefreshCw } from 'lucide-react'

export default function SetupPage() {
  const [status, setStatus] = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<any>(null)

  async function checkStatus() {
    setChecking(true)
    try {
      const res = await fetch('/api/setup/status')
      setStatus(await res.json())
    } catch (e: any) {
      setStatus({ error: e.message })
    } finally {
      setChecking(false)
    }
  }

  async function runSetup() {
    setCreating(true)
    try {
      const res = await fetch('/api/auth/first-run?secret=cce-setup-2024')
      setResult(await res.json())
      checkStatus()
    } catch (e: any) {
      setResult({ error: e.message })
    } finally {
      setCreating(false)
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
  }

  useEffect(() => { checkStatus() }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 flex items-start justify-center">
      <div className="w-full max-w-2xl pt-10">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-black">CC</span>
          </div>
          <h1 className="text-2xl font-black text-white">Cambridge CCE — System Setup</h1>
          <p className="text-slate-400 mt-2">Follow these steps to get the system running</p>
        </div>

        {/* Step 1 — Database */}
        <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="font-bold text-white">Step 1 — Run Database Schema</h2>
              <p className="text-slate-400 text-sm mt-0.5">Set up all tables in Supabase</p>
            </div>
            {status?.schema ? (
              <span className="flex items-center gap-1.5 text-green-400 text-sm font-bold">
                <CheckCircle size={16}/> Done
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-yellow-400 text-sm font-bold">
                <XCircle size={16}/> Pending
              </span>
            )}
          </div>

          <ol className="text-sm text-slate-300 space-y-2 mb-4">
            <li>1. Go to <a href="https://supabase.com/dashboard/project/gejtxkbatldxbbqynpfg/sql/new"target="_blank"className="text-blue-400 underline">Supabase SQL Editor ↗</a></li>
            <li>2. Copy and paste the SQL below</li>
            <li>3. Click <strong>Run</strong></li>
          </ol>

          <div className="relative">
            <div className="bg-slate-800 rounded-xl p-4 max-h-32 overflow-y-auto font-mono text-xs text-slate-300">
              {`-- Paste the full content of FULL-SCHEMA.sql\n-- from your GitHub repo:\n-- github.com/isaacgyampoh/cambridge/blob/main/supabase/FULL-SCHEMA.sql\n\n-- Then also run:\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS portals TEXT[] DEFAULT NULL;`}
            </div>
            <button onClick={() => copy('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS portals TEXT[] DEFAULT NULL;')}
              className="absolute top-2 right-2 p-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
              <Copy size={13} className="text-slate-300"/>
            </button>
          </div>

          <a href="https://github.com/isaacgyampoh/cambridge/blob/main/supabase/FULL-SCHEMA.sql"
            target="_blank"
            className="flex items-center gap-2 mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors">
            <ExternalLink size={14}/> View FULL-SCHEMA.sql on GitHub
          </a>
        </div>

        {/* Step 2 — Create Admin */}
        <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="font-bold text-white">Step 2 — Create Super Admin Account</h2>
              <p className="text-slate-400 text-sm mt-0.5">Set up the first admin login</p>
            </div>
            {status?.admin ? (
              <span className="flex items-center gap-1.5 text-green-400 text-sm font-bold">
                <CheckCircle size={16}/> Done
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-yellow-400 text-sm font-bold">
                <XCircle size={16}/> Pending
              </span>
            )}
          </div>

          <button onClick={runSetup} disabled={creating}
            className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2 mb-3">
            {creating ? <><Loader size={16} className="animate-spin"/> Creating...</> : 'Create Super Admin Account'}
          </button>

          {result && (
            <div className={`rounded-xl p-4 text-sm ${result.success ? 'bg-green-900/30 border border-green-700': 'bg-red-900/30 border border-red-700'}`}>
              {result.success ? (
                <>
                  <div className="font-bold text-green-400 mb-2"> {result.message}</div>
                  <div className="text-slate-300 space-y-1">
                    <div>Phone: <strong className="text-white">{result.login?.phone}</strong></div>
                    <div>PIN: <strong className="text-white text-xl tracking-widest">{result.login?.pin}</strong></div>
                    <div className="text-slate-400 text-xs mt-2">{result.login?.note}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-bold text-red-400 mb-1"> {result.error}</div>
                  {result.hint && <div className="text-yellow-300 text-xs">{result.hint}</div>}
                </>
              )}
            </div>
          )}
        </div>

        {/* Step 3 — Login */}
        <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
          <h2 className="font-bold text-white mb-3">Step 3 — Login</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: 'Phone Number', value: '0201024000'},
              { label: 'Initial PIN', value: '1024'},
            ].map(item => (
              <div key={item.label} className="bg-slate-800 rounded-xl p-3">
                <div className="text-xs text-slate-400 mb-1">{item.label}</div>
                <div className="flex items-center justify-between">
                  <span className="text-white font-bold tracking-widest">{item.value}</span>
                  <button onClick={() => copy(item.value)} className="p-1 text-slate-400 hover:text-white transition">
                    <Copy size={13}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
          <a href="/login"
            className="flex items-center justify-center gap-2 w-full h-12 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition">
            Go to Login →
          </a>
        </div>

        {/* Status check */}
        <div className="flex items-center justify-between">
          <button onClick={checkStatus} disabled={checking}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition">
            <RefreshCw size={14} className={checking ? 'animate-spin': ''}/> Refresh status
          </button>
          {status && (
            <div className="text-xs text-slate-500">
              Schema: {status.schema ? '': ''} · Admin: {status.admin ? '': ''} · Sessions: {status.sessions ? '': ''}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
