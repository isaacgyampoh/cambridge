// ============================================================
// CAMBRIDGE CCE — PUBLIC CONFIGURATION
//
// Everything in this file is safe to ship to the browser. It is imported by
// client components, so ANY value added here WILL end up in the JavaScript
// bundle that every visitor downloads — including anonymous visitors on the
// public /apply and /signin pages.
//
//   *** NEVER PUT A SECRET IN THIS FILE. ***
//
// Server-side secrets live in lib/config.server.ts, which carries
// `import 'server-only'` so that importing it from a client component is a
// build error rather than a silent leak.
//
// Note on env vars: only NEXT_PUBLIC_* variables exist in the browser, and
// Next.js inlines them at build time only when referenced as a full static
// expression (`process.env.NEXT_PUBLIC_FOO`). Reading them through a helper
// with a dynamic key does NOT get inlined — it silently yields undefined on
// the client and falls through to the default. That is why each one below is
// written out literally.
// ============================================================

export const CONFIG = {

  // ── APP ─────────────────────────────────────────────────────
  appName: 'Cambridge Center of Excellence',
  appUrl:
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://portal.cambridge.edu.gh',

  // ── SUPABASE ────────────────────────────────────────────────
  // The project URL and the anon key are public by design: the anon key is
  // meant to be seen by browsers, and is only safe because Row Level Security
  // constrains what it can read. See supabase/migrations — RLS must stay on.
  supabaseUrl:
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://gejtxkbatldxbbqynpfg.supabase.co',
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTg2MzksImV4cCI6MjA5NjY5NDYzOX0.wKs4_UCaxpIi2a0g9eor_KTmkkzzytNi0KsSf9tJgZI',

  // ── PAYSTACK (publishable key only) ─────────────────────────
  // Deliberately has NO hardcoded default. The repository previously carried
  // two DIFFERENT live publishable keys (one here, one in next.config.ts), so
  // payments could initialise against either account depending on which value
  // the calling code happened to read. Set NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY to
  // the one key that matches the PAYSTACK_SECRET_KEY used to verify webhooks.
  paystackPublicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',

  // ── CLOUDINARY (unsigned browser uploads — no secret involved) ──
  cloudinaryCloudName: 'dafiojcq6',
  cloudinaryUploadPreset: 'cce_uploads',

  // ── BANK DETAILS (shown to students paying by transfer) ─────
  bankName: 'Cambridge CE Bank',
  bankAccountName: 'Cambridge Center of Excellence',
  bankAccountNumber: '1234567890',
  bankBranch: '',

  // ── NON-SECRET OPERATIONAL FLAGS ────────────────────────────
  arkeselSenderId: 'CambridgeCE',
  superAdminEmail: 'admin@cambridge.edu.gh',

} as const
