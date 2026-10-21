import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Cambridge sends through its own mailbox, on its own domain.
 *
 * Evidence, not preference. The domain's SPF record is
 *
 *   v=spf1 +a +mx +a:siteground215.com include:…dnssmarthost.net ~all
 *
 * which authorises SiteGround and nothing else — so mail sent through any
 * other service fails SPF alignment and is treated as spam. MX points at
 * SiteGround's filter, and mail.cambridge.edu.gh answers on 465 and 587 as
 * gtxm1322.siteground.biz with a valid certificate for *.cambridge.edu.gh.
 *
 * A third-party sender was present as a fallback. It is gone, and these stop
 * it coming back by the usual route: somebody adding "just a fallback".
 */

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}
const read = (p: string) => readFileSync(p, 'utf8')

describe('no third-party email sender anywhere', () => {
  const files = ['app', 'lib'].flatMap(d => sources(d))

  test('nothing calls a hosted email API', () => {
    const offenders = files.filter(f =>
      /api\.resend\.com|api\.sendgrid\.com|api\.mailgun|api\.postmarkapp\.com/.test(read(f)))
    assert.deepEqual(offenders, [])
  })

  test('no RESEND_API_KEY is read', () => {
    const offenders = files.filter(f => /RESEND_API_KEY|resendApiKey/.test(read(f)))
    assert.deepEqual(offenders, [])
  })

  test('it is not a dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.equal(pkg.dependencies?.resend, undefined)
    assert.equal(pkg.devDependencies?.resend, undefined)
    assert.ok(pkg.dependencies?.nodemailer, 'the SMTP client must remain')
  })

  test('the "resend OTP" feature is untouched — it is a different thing', () => {
    // Resending a one-time code has nothing to do with the mail vendor, and
    // a careless search-and-replace would have taken it out.
    assert.ok(files.some(f => f.endsWith('resend-otp/route.ts')),
      'the resend-otp route must still exist')
  })
})

describe('the campus mailbox', () => {
  const email = read('lib/integrations/email.ts')

  test('one transport, and it is SMTP', () => {
    assert.match(email, /nodemailer\.createTransport/)
    assert.match(email, /host: SECRETS\.smtpHost/)
  })

  test('TLS verification is not disabled', () => {
    /*
     * mail.cambridge.edu.gh presents a valid Let's Encrypt certificate for
     * *.cambridge.edu.gh, so there is nothing to work around — and turning
     * verification off would make the connection trivially interceptable,
     * with mailbox credentials on it.
     */
    assert.doesNotMatch(email, /rejectUnauthorized:\s*false/)
    assert.doesNotMatch(email, /NODE_TLS_REJECT_UNAUTHORIZED/)
  })

  test('the From address is a variable, defaulting to the centre’s own domain', () => {
    assert.match(email, /SECRETS\.emailFrom/)
    const cfg = read('lib/config.server.ts')
    assert.match(cfg, /emailFrom\(\) \{ return optional\('EMAIL_FROM', 'Cambridge CE <portal@cambridge\.edu\.gh>'\) \}/)
  })

  test('credentials come from the environment, never the source', () => {
    for (const k of ['smtpHost', 'smtpUser', 'smtpPass', 'smtpPort', 'smtpSecure']) {
      assert.match(email, new RegExp(`SECRETS\\.${k}`), `${k} must come from config`)
    }
    /*
     * CODE only. The comments in that file name the host and the provider on
     * purpose — that is the evidence for why SMTP is the transport — and an
     * assertion over the whole file failed on my own prose rather than on
     * anything that runs.
     */
    const code = email.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, /mail\.cambridge\.edu\.gh/, 'no hostname hardcoded')
    assert.doesNotMatch(code, /password\s*[:=]\s*['\"]/i, 'no password in the source')
  })

  test('the document sender goes through it too, rather than its own path', () => {
    // That route had its own fetch to a hosted API: a second email path that
    // never wrote to email_logs and would have outlived the removal.
    const docs = read('app/api/documents/route.ts')
    assert.match(docs, /sendEmail\(/)
    assert.doesNotMatch(docs, /api\.resend\.com/)
  })

  test('readiness is reported as "email", not as a vendor', () => {
    const status = read('app/api/config-status/route.ts')
    assert.match(status, /email: emailConfigured\(\)/)
    assert.doesNotMatch(status, /resend/i)
  })
})
