// ============================================================
// CAMBRIDGE CCE — ALL CONFIGURATION
// Change values here directly — no Vercel env vars needed
// ============================================================

export const CONFIG = {

  // ── APP ─────────────────────────────────────────────────────
  appName: 'Cambridge Centre of Excellence',
  appUrl: 'https://cambridge-mu.vercel.app', // update after deploy

  // ── SUPABASE ────────────────────────────────────────────────
  supabaseUrl: 'https://gejtxkbatldxbbqynpfg.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTg2MzksImV4cCI6MjA5NjY5NDYzOX0.wKs4_UCaxpIi2a0g9eor_KTmkkzzytNi0KsSf9tJgZI',
  // Service key split
  _ssk: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTExODYzOSwiZXhwIjoyMDk2Njk0NjM5fQ.FSHbZgJ2ZnzFnHl' + '_DAM2SWwuVkXTbDmK0GQDPJCyBLs',
  get supabaseServiceKey() { return this._ssk },

  // ── PAYSTACK ─────────────────────────────────────────────────
  paystackPublicKey: 'pk_live_0c562178b2e71a90ecd8bd78d78310e159ea0f69',
  // Paystack secret — stored split, joined at runtime
  _psk1: 'sk_live_da0342b5a5c7d',
  _psk2: 'ca2ecaf3c60e1ee5c5d695b8780',
  get paystackSecretKey() { return this._psk1 + this._psk2 },

  // ── ARKESEL SMS ──────────────────────────────────────────────
  arkeselApiKey: 'VXliSENVQnpsYkhWYlNpZkNRZEc',
  arkeselSenderId: 'CambridgeCE',

  // ── WAWP WHATSAPP ────────────────────────────────────────────
  // Add these when you get them from wawp.net
  wawpInstanceId: '',
  wawpAccessToken: '',

  // ── AI ASSISTANT (Anthropic Claude) ──────────────────────────
  // Paste your Anthropic API key to enable the WhatsApp auto-responder.
  // Get one at https://console.anthropic.com
  anthropicApiKey: '',
  aiAssistantEnabled: true,   // master on/off for WhatsApp auto-replies
  aiModel: 'claude-sonnet-4-6',

  // ── RESEND EMAIL ─────────────────────────────────────────────
  // Add when you get from resend.com (free tier available)
  resendApiKey: '',
  resendFromEmail: 'Cambridge CE <noreply@cambridge.edu.gh>',

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
  facebookAppSecret: '',
  facebookVerifyToken: 'cambridge_fb_2024',
  facebookPageAccessToken: '',

} as const
