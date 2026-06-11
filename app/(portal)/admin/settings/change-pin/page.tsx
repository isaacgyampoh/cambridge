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
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</label>
      <div className="flex gap-3">
        {value.map((digit: string, i: number) => (
          <input key={i} ref={refs[i]}
            type={showPin ? 'text' : 'password'} inputMode="numeric" maxLength={1} value={digit}
            onChange={e => onChange(e.target.value, i)}
            onKeyDown={e => onKeyDown(e, i)}
            className={`w-14 h-14 text-center text-xl font-black rounded-xl border-2 focus:outline-none transition
              ${digit ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50'}
              focus:border-blue-500 focus:bg-white`} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="fade-in max-w-md">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <Shield size={20} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Change PIN</h1>
          <p className="text-gray-500 text-sm">Update your security PIN</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
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
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition">
          {showPin ? <EyeOff size={12} /> : <Eye size={12} />}
          {showPin ? 'Hide PINs' : 'Show PINs'}
        </button>

        {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl py-2 px-3">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={save} disabled={saving}
            className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-blue-700 transition">
            {saving ? 'Saving...' : 'Change PIN'}
          </button>
          <button onClick={() => router.back()}
            className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
