# Running the portal

The portal is a standard Next.js application. It is **not tied to Vercel**:
no `@vercel/*` packages, no `VERCEL_*` environment variables, no edge-runtime
routes. `next.config.ts` sets `output: 'standalone'`, so a build produces a
self-contained server that runs under plain Node anywhere.

This exists because on 15 October 2026 the Vercel account was disabled and the
whole portal returned `402 DEPLOYMENT_DISABLED` — staff and students locked
out, with the code perfectly healthy. One supplier should not be able to do
that silently.

## Build and run, on any host

```bash
npm ci
npm run build

# the build emits a self-contained server:
cp -r .next/static      .next/standalone/.next/static
cp -r public            .next/standalone/public
node .next/standalone/server.js        # listens on PORT, default 3000
```

Node 24. Set `PORT` and `HOSTNAME=0.0.0.0` if the host requires it.

## Environment variables

Read out of `lib/config.server.ts` and `lib/config.ts`, not from memory.

**Required.** `required()` throws when one is missing, so the app does not
start without all six:

| Variable | What it is |
|---|---|
| `SUPABASE_SERVICE_KEY` | Service role key — **server only, never public** |
| `PIN_PEPPER` | Staff PIN pepper. **Must be the same value as the old host, or every staff PIN stops verifying.** |
| `SETUP_SECRET` | First-run setup guard |
| `CRON_SECRET` | Authenticates the automation runner |
| `PAYSTACK_SECRET_KEY` | Payments |
| `ARKESEL_API_KEY` | SMS |

**Public — these are compiled into the browser bundle, so they must be set
BEFORE the build, not after:**

| Variable | |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public by design |
| `NEXT_PUBLIC_APP_URL` | e.g. `https://portal.cambridge.edu.gh` |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | **must belong to the same Paystack account as `PAYSTACK_SECRET_KEY`** |

**Email — the campus mailbox.** Cambridge runs its own mail on its own
domain, through SiteGround. There is no third-party sending service, and the
portal must not be pointed at one: the domain's SPF record authorises
SiteGround and nothing else, so mail sent elsewhere fails alignment and lands
in spam.

| Variable | Value |
|---|---|
| `SMTP_HOST` | `mail.cambridge.edu.gh` — verified: answers on 465 and 587 as `gtxm1322.siteground.biz`, with a valid Let's Encrypt certificate for `*.cambridge.edu.gh` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` (implicit TLS on 465; use `false` with port `587` for STARTTLS) |
| `SMTP_USER` | the full mailbox address, e.g. `portal@cambridge.edu.gh` |
| `SMTP_PASS` | that mailbox's password — from SiteGround Site Tools → Email Accounts |
| `EMAIL_FROM` | `Cambridge CE <portal@cambridge.edu.gh>` — must be on cambridge.edu.gh |

Without these, **PIN recovery cannot send a code**, and anyone locked out stays
locked out.

**Optional, but in use in production:** `WASENDER_API_KEY`,
`WASENDER_WEBHOOK_SECRET` (WhatsApp), `ANTHROPIC_API_KEY` and `AI_PROVIDER`
(the assistant), `FACEBOOK_PAGE_ACCESS_TOKEN` (lead capture),
`ARKESEL_SENDER_ID` (overrides the registered SMS sender id).

Copy every value from the old host before switching. Do not commit them, and
do not paste them into a chat session.

## Moving to a different Vercel account

The repository's `.vercel/project.json` still names the old project, and the
CLI on a machine stays signed in to whichever account it was last logged into
— neither follows a new account automatically. On the machine that deploys:

```bash
npx vercel login      # the NEW account
npx vercel link       # pick the NEW project; rewrites .vercel/project.json
npx vercel --prod
```

Set every variable above on the new project FIRST — the four `NEXT_PUBLIC_`
ones are baked in at build time, so a build without them produces a bundle
that is wrong in ways nothing will report.

Move `portal.cambridge.edu.gh` to the new project **last**, once the new
deployment answers correctly on its own `*.vercel.app` URL.

## The automations

`vercel.json` declares one daily cron. **Vercel's free plan allows no more than
one run per day**, and the task list in `app/api/cron/run/route.ts` wants
intervals of five and ten minutes — so on the free plan every automation ran
once a day whatever it asked for.

Off Vercel, `vercel.json` is ignored entirely. Drive the runner externally,
which is what the code has always expected:

```
POST https://<host>/api/cron/run
Authorization: Bearer $CRON_SECRET
every 5 minutes
```

A free scheduler (cron-job.org, or the host's own) is enough. The Automation
screen reports whether the runner is actually being called at the rate each
task needs.

## What to check after moving

1. `https://<host>/welcome` returns 200.
2. Sign in as staff; the PIN flow needs `PIN_PEPPER` to match the old host, or
   every PIN stops verifying.
3. `POST /api/cron/run` with the bearer token returns a task list.
4. Point `portal.cambridge.edu.gh` at the new host **last**, once the above
   pass on the host's own URL.
5. `node scripts/verify-rls.mjs` — unchanged by a move, but worth knowing.
