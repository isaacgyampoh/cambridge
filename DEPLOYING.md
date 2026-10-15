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

Required — the app refuses to start sensibly without them:

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_KEY` | Service role key — **server only, never public** |
| `PIN_PEPPER` | Staff PIN hashing pepper |
| `SETUP_SECRET` | First-run setup guard |
| `CRON_SECRET` | Authenticates the automation runner |
| `NEXT_PUBLIC_APP_URL` | Public base URL, e.g. `https://portal.cambridge.edu.gh` |

Also used: `ARKESEL_API_KEY` (SMS), `PAYSTACK_SECRET_KEY` and
`NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (payments, same account as each other),
`WASENDER_API_KEY` (WhatsApp), `RESEND_API_KEY` (email), `ANTHROPIC_API_KEY`
(the assistant).

Copy them from the current host before switching. Do not commit them.

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
