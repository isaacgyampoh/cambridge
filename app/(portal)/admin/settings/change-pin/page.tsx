'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Shield, Eye, EyeOff } from 'lucide-react'

export default function ChangePINPage() {
  const router = useRouter()
  const [currentPin, setCurrentPin] = useState(['', '', '', ''])
  const [newPin, setNewPin] = useState(['', '', '', ''])
  const [confirmPin, setConfirmPin] = useState(['', '', '', ''])
  const [showPin, setShowPin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const currentRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const newRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const confirmRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  function handleInput(val: string, index: number, arr: string[], setArr: (a: string[]) => void, refs: any[]) {
    if (!/^\d*$/.test(val)) return
    const next = [...arr]; next[index] = val.slice(-1); setArr(next)
    if (val && index < 3) refs[index + 1].current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number, arr: string[], refs: any[]) {
    if (e.key === 'Backspace' && !arr[index] && index > 0) refs[index - 1].current?.focus()
  }

  async function save() {
    const cp = currentPin.join(''); const np = newPin.join(''); const cnp = confirmPin.join('')
    if (cp.length < 4) { setError('Enter your current PIN'); return }
    if (np.length < 4) { setError('Enter a new PIN (4 digits)'); return }
    if (np !== cnp) { setError('New PINs do not match'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/auth/change-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin: cp, newPin: np }),
    })
    const d = await res.json()
    if (d.success) { toast.success('PIN changed successfully!'); router.back() }
    else { setError(d.error); setSaving(false) }
  }

  const PinRow = ({ label, value, onChange, refs, onKeyDown }: any) => (
    <div>
      <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase tracking-wide mb-2">{label}</label>
      <div className="flex gap-3">
        {value.map((digit: string, i: number) => (
          <input key={i} ref={refs[i]}
            type={showPin ? 'text' : 'password'} inputMode="numeric" maxLength={1} value={digit}
            onChange={e => onChange(e.target.value, i)}
            onKeyDown={e => onKeyDown(e, i)}
            className={`w-14 h-14 text-center text-xl font-bold rounded-xl border-2 focus:outline-none transition
              ${digit ? 'border-blue-600 bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--line)] bg-[var(--line-soft)]'}
              focus:border-[var(--accent)] focus:bg-white`} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="fade-in w-full">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center">
          <Shield size={20} className="text-[var(--accent)]" />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Change PIN</h1>
          <p className="text-[var(--ink-faint)] text-sm">Update your security PIN</p>
        </div>
      </div>

      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-6 space-y-5">
        <PinRow label="Current PIN" value={currentPin}
          onChange={(v: string, i: number) => handleInput(v, i, currentPin, setCurrentPin, currentRefs)}
          onKeyDown={(e: any, i: number) => handleKeyDown(e, i, currentPin, currentRefs)}
          refs={currentRefs} />
        <PinRow label="New PIN (4 digits)" value={newPin}
          onChange={(v: string, i: number) => handleInput(v, i, newPin, setNewPin, newRefs)}
          onKeyDown={(e: any, i: number) => handleKeyDown(e, i, newPin, newRefs)}
          refs={newRefs} />
        <PinRow label="Confirm New PIN" value={confirmPin}
          onChange={(v: string, i: number) => handleInput(v, i, confirmPin, setConfirmPin, confirmRefs)}
          onKeyDown={(e: any, i: number) => handleKeyDown(e, i, confirmPin, confirmRefs)}
          refs={confirmRefs} />

        <button onClick={() => setShowPin(!showPin)}
          className="flex items-center gap-1.5 text-xs text-[var(--ink-faint)] hover:text-[var(--ink-soft)] transition">
          {showPin ? <EyeOff size={12} /> : <Eye size={12} />}
          {showPin ? 'Hide PINs' : 'Show PINs'}
        </button>

        {error && <p className="text-[var(--danger)] text-sm bg-[var(--danger-soft)] rounded-xl py-2 px-3">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={save} disabled={saving}
            className="flex-1 h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">
            {saving ? 'Saving...' : 'Change PIN'}
          </button>
          <button onClick={() => router.back()}
            className="flex-1 h-11 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
