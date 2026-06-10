'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

const ROLE_ROUTES: Record<string, string> = {
  super_admin: '/admin',
  project_manager: '/pm',
  marketing_officer: '/marketer',
  admissions_officer: '/admission',
  accountant: '/finance',
  receptionist: '/receptionist',
  trainer: '/trainer',
  student: '/student',
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const sb = createClient()
    const { error } = await sb.auth.signInWithPassword({ email, password })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    // Get role and redirect
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single()
      const dest = profile ? ROLE_ROUTES[profile.role] || '/login' : '/login'
      router.push(dest)
    }
  }

  return (
    <div className="w-full max-w-sm fade-in">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
          <span className="text-white text-2xl font-black">CC</span>
        </div>
        <h1 className="text-white text-xl font-bold">Cambridge Centre of Excellence</h1>
        <p className="text-blue-300 text-sm mt-1">Staff Portal</p>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl p-8 shadow-2xl">
        <h2 className="text-lg font-bold text-gray-900 mb-6">Sign in to your account</h2>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@cambridge.edu.gh"
              className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin" />
                Signing in…
              </>
            ) : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Forgot your password? Contact your administrator.
        </p>
      </div>

      <p className="text-center text-blue-400/60 text-xs mt-6">
        © {new Date().getFullYear()} Cambridge Centre of Excellence
      </p>
    </div>
  )
}
