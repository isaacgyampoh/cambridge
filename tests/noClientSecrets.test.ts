import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A SHARED SECRET NEVER REACHES THE BROWSER.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * The automation screen called
 *
 *     fetch('/api/cron/run?key=1024')
 *
 * straight from the browser, and printed the same URL for an operator to paste
 * into cron-job.org.
 *
 * CRON_SECRET is not 1024. So the "Run due now" button had never worked once —
 * every press was a silent 401 that the screen reported as "failed" without
 * saying why — and any scheduler configured from that screen was being
 * rejected every five minutes while the page claimed the automations were set
 * up. Nothing surfaced either failure.
 *
 * The deeper point is that it could not have been fixed by pasting the real
 * secret in. Client code is public. The real value would have handed anybody
 * who opened the page the ability to trigger every automation in the system,
 * including the ones that send SMS to real students.
 *
 * The shape that works: the browser proves WHO you are with the session the
 * rest of the product already uses, and the server holds the secret.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/** Source with comments blanked — these files explain the rule in prose. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(l => (l.trim().startsWith('//') || l.trim().startsWith('*') ? '' : l))
    .join('\n')
}

/** Files that ship to the browser: a client component, or anything it imports. */
function clientFiles(): string[] {
  return [...sourceFiles('app'), ...sourceFiles('components')].filter(f => {
    const src = readFileSync(f, 'utf8')
    return /^['"]use client['"]/m.test(src)
  })
}

describe('no secret is shipped to the browser', () => {
  test('no client file sends a key or secret query parameter', () => {
    /*
     * `?key=` and `?secret=` are how the cron and setup endpoints are
     * authorised. A client file carrying either is shipping a credential, or
     * — as here — shipping a WRONG one and silently failing forever.
     */
    const offenders: string[] = []

    for (const file of clientFiles()) {
      const src = code(readFileSync(file, 'utf8'))
      src.split('\n').forEach((line, i) => {
        if (!/fetch\(|href=|<code/.test(line)) return
        for (const m of line.matchAll(/[?&](key|secret)=([A-Za-z0-9_$-]{2,})/g)) {
          // A named placeholder is the documented way to show the shape.
          if (/^(YOUR|SECRET|CRON|PLACEHOLDER|\$\{)/i.test(m[2])) continue
          offenders.push(`${file}:${i + 1} — ${m[0]}`)
        }
      })
    }

    assert.deepEqual(offenders, [],
      'a shared secret cannot live in client code — call a session-guarded ' +
      'route and let the server hold it:\n  ' + offenders.join('\n  '))
  })

  test('the automation screen runs tasks through a guarded route', () => {
    const page = code(readFileSync('app/(portal)/admin/automation/page.tsx', 'utf8'))

    assert.match(page, /\/api\/admin\/run-cron/,
      'the automation screen does not use the guarded route')
    assert.ok(!/fetch\(`?\/api\/cron\/run/.test(page),
      'the automation screen calls the cron runner directly from the browser')
  })

  test('that route checks the session before it uses the secret', () => {
    const route = code(readFileSync('app/api/admin/run-cron/route.ts', 'utf8'))

    assert.match(route, /withGuard\(\s*\{\s*roles:/,
      'the run-cron route is not role-guarded')
    assert.match(route, /super_admin/,
      'the run-cron route is not restricted to a super admin')

    // The secret goes in a header: query strings are kept in access logs.
    assert.match(route, /authorization[\s\S]*Bearer[\s\S]*cronSecret/,
      'the route does not pass the secret as an Authorization header')
    assert.ok(!/cron\/run\?key=/.test(route),
      'the route puts the secret in a query string, where logs will keep it')
  })

  test('no client file reads a server-only secret', () => {
    const offenders: string[] = []

    for (const file of clientFiles()) {
      const src = code(readFileSync(file, 'utf8'))
      // SECRETS is server-only; NEXT_PUBLIC_* is public by definition.
      if (/\bSECRETS\./.test(src)) offenders.push(`${file} reads SECRETS`)
      for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (!m[1].startsWith('NEXT_PUBLIC_')) offenders.push(`${file} reads process.env.${m[1]}`)
      }
    }

    assert.deepEqual(offenders, [],
      'these would be inlined into the JavaScript bundle:\n  ' + offenders.join('\n  '))
  })
})
