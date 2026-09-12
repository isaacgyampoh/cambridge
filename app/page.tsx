import { redirect } from 'next/navigation'

/**
 * The front door of the staff portal.
 *
 * ── WHY THIS IS A REDIRECT AND NOT A PAGE ──────────────────────────────────
 *
 * This application is the centre's ERP: the staff portal is the product, and
 * `/` is how everybody who works here reaches it. It was briefly replaced
 * with a public marketing page, which did not delete a single portal route —
 * all eighty-one pages stayed exactly where they were — but it did take away
 * the door. Staff opening portal.cambridge.edu.gh got a page about courses
 * instead of the sign-in box, and from where they were standing the portal
 * had gone.
 *
 * The public page was not thrown away; it lives at /welcome, which is public,
 * and can be linked from anywhere that wants it. What it must not be is the
 * thing standing between the people who work here and their work.
 *
 * The redirect is deliberately unconditional. The proxy already knows who is
 * signed in and where their role belongs, and /login already forwards anyone
 * who arrives with a live session, so deciding it a second time here would be
 * a second place for that rule to drift.
 */
export default function Home() {
  redirect('/login')
}
