'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Eye, EyeOff, Shield } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState(['', '', '', ''])
  const [showPin, setShowPin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'email' | 'pin'>('email')
  const [mustChange, setMustChange] = useState(false)
  const [newPin, setNewPin] = useState(['', '', '', ''])
  const [confirmPin, setConfirmPin] = useState(['', '', '', ''])
  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const newPinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  function handlePinChange(index: number, value: string, arr: string[], setArr: (a: string[]) => void, refs: any[]) {
    if (!/^\d*$/.test(value)) return
    const next = [...arr]
    next[index] = value.slice(-1)
    setArr(next)
    if (value && index < 3) refs[index + 1].current?.focus()
    if (!value && index > 0) refs[index - 1].current?.focus()
  }

  function handlePinKeyDown(e: React.KeyboardEvent, index: number, refs: any[]) {
    if (e.key === 'Backspace' && !pin[index] && index > 0) refs[index - 1].current?.focus()
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Enter your email address'); return }
    setError('')
    setStep('pin')
    setTimeout(() => pinRefs[0].current?.focus(), 100)
  }

  async function submitPin() {
    const pinStr = pin.join('')
    if (pinStr.length < 4) { setError('Enter your 4-digit PIN'); return }
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), pin: pinStr }),
    })
    const data = await res.json()

    if (!data.success) {
      setError(data.error || 'Incorrect PIN')
      setPin(['', '', '', ''])
      pinRefs[0].current?.focus()
      setLoading(false)
      return
    }

    if (data.mustChangePIN) {
      setMustChange(true)
      setLoading(false)
      setTimeout(() => newPinRefs[0].current?.focus(), 100)
      return
    }

    router.push(data.redirect || '/admin')
  }

  async function submitNewPin() {
    const np = newPin.join('')
    const cp = confirmPin.join('')
    if (np.length < 4) { setError('Enter a 4-digit PIN'); return }
    if (np !== cp) { setError('PINs do not match'); return }
    setLoading(true)
    const res = await fetch('/api/auth/change-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: np }),
    })
    const d = await res.json()
    if (d.success) router.push('/admin')
    else { setError(d.error); setLoading(false) }
  }

  const PinInputs = ({ value, onChange, refs, label }: any) => (
    <div>
      {label && <p className="text-xs text-center text-gray-400 mb-3">{label}</p>}
      <div className="flex gap-3 justify-center">
        {value.map((digit: string, i: number) => (
          <input
            key={i}
            ref={refs[i]}
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={e => onChange(i, e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Backspace' && !value[i] && i > 0) refs[i - 1].current?.focus()
            }}
            className={`w-14 h-16 text-center text-2xl font-black rounded-2xl border-2 focus:outline-none transition-all
              ${digit ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-900'}
              focus:border-blue-500 focus:bg-white focus:shadow-lg`}
          />
        ))}
      </div>
    </div>
  )

  if (mustChange) return (
    <div className="w-full max-w-sm fade-in">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
          <Shield size={28} className="text-white" />
        </div>
        <h1 className="text-white text-xl font-bold">Set Your PIN</h1>
        <p className="text-blue-300 text-sm mt-1">This is your first login — please set a personal PIN</p>
      </div>
      <div className="bg-white rounded-3xl p-8 shadow-2xl">
        <div className="space-y-6">
          <PinInputs value={newPin} onChange={(i: number, v: string) => handlePinChange(i, v, newPin, setNewPin, newPinRefs)} refs={newPinRefs} label="Enter your new PIN (4 digits)" />
          <PinInputs value={confirmPin} onChange={(i: number, v: string) => handlePinChange(i, v, confirmPin, setConfirmPin, newPinRefs)} refs={newPinRefs} label="Confirm your new PIN" />
        </div>
        {error && <p className="text-red-500 text-sm text-center mt-4 bg-red-50 rounded-xl py-2">{error}</p>}
        <button onClick={submitNewPin} disabled={loading}
          className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-sm mt-6 hover:bg-blue-700 disabled:opacity-50 transition">
          {loading ? 'Setting PIN...' : 'Set PIN & Enter System'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="w-full max-w-sm fade-in">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
          <Building2 size={28} className="text-white" />
        </div>
        <h1 className="text-white text-xl font-bold">Cambridge Centre of Excellence</h1>
        <p className="text-blue-300 text-sm mt-1">Staff Portal</p>
      </div>

      <div className="bg-white rounded-3xl p-8 shadow-2xl">
        {step === 'email' ? (
          <>
            <h2 className="text-lg font-bold text-gray-900 mb-1 text-center">Welcome Back</h2>
            <p className="text-gray-400 text-sm text-center mb-6">Enter your email to continue</p>
            <form onSubmit={submitEmail}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@cambridge.edu.gh"
                autoFocus
                className="w-full h-12 px-4 rounded-xl border-2 border-gray-200 text-sm focus:outline-none focus:border-blue-500 transition mb-4"
              />
              {error && <p className="text-red-500 text-sm text-center mb-4 bg-red-50 rounded-xl py-2 px-3">{error}</p>}
              <button type="submit"
                className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition">
                Continue →
              </button>
            </form>
          </>
        ) : (
          <>
            <button onClick={() => { setStep('email'); setPin(['','','','']); setError('') }}
              className="text-xs text-gray-400 hover:text-gray-600 mb-4 flex items-center gap-1 transition">
              ← {email}
            </button>
            <h2 className="text-lg font-bold text-gray-900 mb-1 text-center">Enter Your PIN</h2>
            <p className="text-gray-400 text-sm text-center mb-6">Enter your 4-digit security PIN</p>

            <PinInputs
              value={pin}
              onChange={(i: number, v: string) => handlePinChange(i, v, pin, setPin, pinRefs)}
              refs={pinRefs}
              label={null}
            />

            <button onClick={() => setShowPin(!showPin)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mx-auto mt-3 transition">
              {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
              {showPin ? 'Hide PIN' : 'Show PIN'}
            </button>

            {error && <p className="text-red-500 text-sm text-center mt-4 bg-red-50 rounded-xl py-2 px-3">{error}</p>}

            <button
              onClick={submitPin}
              disabled={loading || pin.join('').length < 4}
              className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-sm mt-6 hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {loading
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying...</>
                : <><Shield size={16} /> Enter System</>}
            </button>

            <p className="text-center text-xs text-gray-300 mt-4">
              Forgot your PIN? Contact your administrator.
            </p>
          </>
        )}
      </div>

      <p className="text-center text-blue-400/40 text-xs mt-6">
        © {new Date().getFullYear()} Cambridge Centre of Excellence · Secured
      </p>
    </div>
  )
}
