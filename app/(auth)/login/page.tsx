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

/**
 * Where the sign-in photograph goes.
 *
 * Save the photograph of the centre as ONE of these, in public/brand/. The
 * first that exists is used, so it does not matter which format the picture
 * is exported in — a phone will hand you a .jpg, a design tool a .png, and a
 * modern export a .webp, and any of the three works with no code change.
 *
 * Nothing else needs editing. There is no config, no import and no build step.
 */
const HERO_CANDIDATES = [
  'brand/login-hero.jpg',
  'brand/login-hero.jpeg',
  'brand/login-hero.png',
  'brand/login-hero.webp',
] as const

export default function LoginPage() {
  /*
   * Resolved once on the server. The result is a URL for the client to render
   * or null, and null is a supported state: the screen falls back to the calm
   * centred composition rather than showing a broken image or an empty
   * coloured block.
   */
  const heroFile = HERO_CANDIDATES.find(f =>
    existsSync(join(process.cwd(), 'public', f)))
  const heroSrc = heroFile ? `/${heroFile}` : null

  return (
    <Suspense fallback={
      <div className="min-h-screen w-screen flex items-center justify-center"
        style={{ background: 'var(--canvas)' }}>
        <div className="w-6 h-6 border-2 border-[var(--line)] border-t-[var(--accent)]
          rounded-full animate-spin" />
      </div>
    }>
      <LoginForm heroSrc={heroSrc} />
    </Suspense>
  )
}
