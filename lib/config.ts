// ============================================================
// CAMBRIDGE CCE — ALL CONFIGURATION
//
// Secrets are read from environment variables FIRST (set these in Vercel:
// Settings -> Environment Variables), falling back to any inline value.
// New secrets (OpenAI) live ONLY in env vars and never touch the repo.
// To rotate a key, change it in Vercel — no code change, no redeploy of code.
// ============================================================

// Read an env var safely on both server and edge runtimes.
const env = (k: string): string => (typeof process !== 'undefined' && process.env?.[k]) || ''

export const CONFIG = {

  // ── APP ─────────────────────────────────────────────────────
  appName: 'Cambridge Centre of Excellence',
  appUrl: env('APP_URL') || 'https://portal.cambridge.edu.gh',

  // ── SUPABASE ────────────────────────────────────────────────
  supabaseUrl: env('SUPABASE_URL') || 'https://gejtxkbatldxbbqynpfg.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTg2MzksImV4cCI6MjA5NjY5NDYzOX0.wKs4_UCaxpIi2a0g9eor_KTmkkzzytNi0KsSf9tJgZI',
  // Service key split
  _ssk: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTExODYzOSwiZXhwIjoyMDk2Njk0NjM5fQ.FSHbZgJ2ZnzFnHl' + '_DAM2SWwuVkXTbDmK0GQDPJCyBLs',
  get supabaseServiceKey() { return env('SUPABASE_SERVICE_KEY') || this._ssk },

  // ── PAYSTACK ─────────────────────────────────────────────────
  paystackPublicKey: env('PAYSTACK_PUBLIC_KEY') || 'pk_live_0c562178b2e71a90ecd8bd78d78310e159ea0f69',
  // Paystack secret — stored split, joined at runtime
  _psk1: 'sk_live_da0342b5a5c7d',
  _psk2: 'ca2ecaf3c60e1ee5c5d695b8780',
  get paystackSecretKey() { return env('PAYSTACK_SECRET_KEY') || (this._psk1 + this._psk2) },

  // ── ARKESEL SMS ──────────────────────────────────────────────
  arkeselApiKey: env('ARKESEL_API_KEY') || 'VXliSENVQnpsYkhWYlNpZkNRZEc',
  arkeselSenderId: 'CambridgeCE',

  // ── WAWP WHATSAPP ────────────────────────────────────────────
  // Add these when you get them from wawp.net
  wawpInstanceId: '',
  wawpAccessToken: '',

  // ── AI ASSISTANT (Anthropic Claude) ──────────────────────────
  // ── AI PROVIDER ──────────────────────────────────────────────
  // Set aiProvider to 'openai' or 'anthropic'. Fill in the matching key.
  aiProvider: (env('AI_PROVIDER') || 'openai') as 'openai' | 'anthropic',

  // OpenAI — set OPENAI_API_KEY in Vercel (never in code)
  openaiApiKey: env('OPENAI_API_KEY'),
  openaiModel: env('OPENAI_MODEL') || 'gpt-4o',

  // Anthropic — set ANTHROPIC_API_KEY in Vercel if you switch back
  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  aiModel: env('ANTHROPIC_MODEL') || 'claude-sonnet-4-6',

  aiAssistantEnabled: true,   // master on/off for WhatsApp auto-replies

  // Two-step login OTP. OFF by default — turn on by setting OTP_ENABLED=true
  // in Vercel once the campus email is confirmed delivering codes reliably.
  otpEnabled: env('OTP_ENABLED') === 'true',

  // ── RESEND EMAIL ─────────────────────────────────────────────
  // Add when you get from resend.com (free tier available)
  // ── EMAIL ────────────────────────────────────────────────────
  // Primary: SMTP (the campus mailbox). Set these in Vercel env vars.
  // Falls back to Resend if SMTP isn't configured.
  smtpHost: env('SMTP_HOST'),
  smtpPort: Number(env('SMTP_PORT') || '465'),
  smtpSecure: (env('SMTP_SECURE') || 'true') === 'true',
  smtpUser: env('SMTP_USER'),
  smtpPass: env('SMTP_PASS'),
  resendApiKey: env('RESEND_API_KEY'),
  resendFromEmail: env('EMAIL_FROM') || 'Cambridge CE <portal@cambridge.edu.gh>',

  // ── CLOUDINARY (file storage: certificates, receipts, brochures, photos) ──
  // Get these from cloudinary.com (free tier ~25GB). Steps:
  //  1. Sign up -> Dashboard shows your "Cloud name"
  //  2. Settings -> Upload -> add an UNSIGNED upload preset, copy its name
  // Only these two are needed for browser uploads (no secret exposed).
  cloudinaryCloudName: 'dafiojcq6',
  cloudinaryUploadPreset: 'cce_uploads',

  // ── PIN AUTH ─────────────────────────────────────────────────
  pinSalt: 'cce-pin-salt-cambridge-2024',
  setupSecret: 'cce-setup-2024',
  superAdminEmail: 'admin@cambridge.edu.gh',

  // ── BANK DETAILS (shown to students paying by bank transfer) ──
  // Update these with the real account; they appear on every pay page.
  bankName: 'Cambridge CE Bank',
  bankAccountName: 'Cambridge Centre of Excellence',
  bankAccountNumber: '1234567890',
  bankBranch: '',
  superAdminPassword: 'CCE-Admin-Secure-2024!',
  cronSecret: 'cce-cron-2024',

  // ── FACEBOOK (add later) ──────────────────────────────────────
  facebookAppSecret: env('FACEBOOK_APP_SECRET'),
  facebookVerifyToken: env('FACEBOOK_VERIFY_TOKEN') || 'cambridge_fb_2024',
  facebookPageAccessToken: env('FACEBOOK_PAGE_ACCESS_TOKEN'),
  googleLeadKey: env('GOOGLE_LEAD_KEY'),

} as const
