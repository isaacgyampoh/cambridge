import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Suspense } from 'react'
import LoginForm from './LoginForm'

/**
 * The sign-in route.
 *
 * ── WHY THIS IS A SERVER COMPONENT ─────────────────────────────────────────
 *
 * Only to answer one question before anything is painted: is there a
 * photograph to show?
 *
 * The client cannot answer it without trying to load the file, and every way
 * of doing that is visible — an onError leaves the browser's broken-image
 * glyph in the corner for a frame, and revealing the panel on load shifts the
 * whole column downwards. Worse, the fallback and the lockup both carry the
 * crest, so a missing file put the same mark on screen twice.
 *
 * Reading the directory once, here, makes it a fact the first paint already
 * knows.
 */

/** Kept in step with HERO in LoginForm. */
const HERO_FILE = 'brand/login-hero.jpg'

export default function LoginPage() {
  const hasHero = existsSync(join(process.cwd(), 'public', HERO_FILE))

  return (
    <Suspense fallback={
      <div className="min-h-screen w-screen flex items-center justify-center"
        style={{ background: 'var(--canvas)' }}>
        <div className="w-6 h-6 border-2 border-[var(--line)] border-t-[var(--accent)]
          rounded-full animate-spin" />
      </div>
    }>
      <LoginForm hasHero={hasHero} />
    </Suspense>
  )
}
