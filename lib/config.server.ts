// ============================================================
// CAMBRIDGE CCE — SERVER-ONLY SECRETS
//
// `import 'server-only'` makes importing this file from a Client Component a
// BUILD ERROR. That is the whole point: the previous single CONFIG object
// mixed secrets with public values, and because a bundler cannot tree-shake
// individual properties off an object literal, one client component importing
// it for a single field pulled the Supabase service_role key, the SMS API key,
// the cron secret and the PIN salt into 14 browser-served chunks.
//
// Rules for this file:
//   1. Every value comes from the environment. No hardcoded fallbacks.
//   2. Required secrets throw a clear error when read but unset, so a
//      misconfiguration fails loudly instead of silently falling back to a
//      value that has already leaked.
//   3. Values are exposed as GETTERS so the throw happens at first use, not
//      at import time — a route that never touches Paystack still works when
//      only the Paystack key is missing.
// ============================================================

import 'server-only'

/** A secret the app cannot safely operate without. Throws when missing. */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
      `Set it in your deployment environment — this value has no fallback ` +
      `because the previous hardcoded default was exposed publicly and must ` +
      `be considered compromised.`
    )
  }
  return value
}

/** A secret for an optional integration. Returns '' when unset. */
function optional(name: string, fallback = ''): string {
  return process.env[name] || fallback
}

/**
 * True when an optional integration is configured. Use this to skip a feature
 * cleanly rather than calling out with an empty credential.
 */
export function isConfigured(...names: string[]): boolean {
  return names.every(n => Boolean(process.env[n]))
}

export const SECRETS = {

  // ── SUPABASE ────────────────────────────────────────────────
  // Bypasses Row Level Security entirely. Never send it anywhere but Supabase.
  get supabaseServiceKey() { return required('SUPABASE_SERVICE_KEY') },

  // ── PAYSTACK ────────────────────────────────────────────────
  get paystackSecretKey() { return required('PAYSTACK_SECRET_KEY') },

  // ── ARKESEL SMS ─────────────────────────────────────────────
  get arkeselApiKey() { return required('ARKESEL_API_KEY') },

  // ── WHATSAPP (WaSender) ─────────────────────────────────────
  get wasenderApiKey() { return optional('WASENDER_API_KEY') },
  get wasenderUrl() { return optional('WASENDER_URL', 'https://wasenderapi.com/api/send-message') },
  get wasenderWebhookSecret() { return optional('WASENDER_WEBHOOK_SECRET') },

  // ── AI PROVIDER ─────────────────────────────────────────────
  get aiProvider() { return (optional('AI_PROVIDER', 'openai')) as 'openai' | 'anthropic' },
  get openaiApiKey() { return optional('OPENAI_API_KEY') },
  get openaiModel() { return optional('OPENAI_MODEL', 'gpt-4o') },
  get anthropicApiKey() { return optional('ANTHROPIC_API_KEY') },
  get aiModel() { return optional('ANTHROPIC_MODEL', 'claude-sonnet-4-6') },
  aiAssistantEnabled: true,

  // ── EMAIL ───────────────────────────────────────────────────
  get smtpHost() { return optional('SMTP_HOST') },
  get smtpPort() { return Number(optional('SMTP_PORT', '465')) },
  get smtpSecure() { return optional('SMTP_SECURE', 'true') === 'true' },
  get smtpUser() { return optional('SMTP_USER') },
  get smtpPass() { return optional('SMTP_PASS') },
  get resendApiKey() { return optional('RESEND_API_KEY') },
  get resendFromEmail() { return optional('EMAIL_FROM', 'Cambridge CE <portal@cambridge.edu.gh>') },

  // ── AUTH ────────────────────────────────────────────────────
  // Used as pepper alongside a per-user salt. Rotating it invalidates every
  // stored PIN hash, so treat a change as a forced PIN reset for all staff.
  get pinPepper() { return required('PIN_PEPPER') },
  get otpEnabled() { return optional('OTP_ENABLED') !== 'false' },

  // ── SCHEDULED JOBS ──────────────────────────────────────────
  // Previously hardcoded as 'cce-cron-2024' / 'cce-setup-2024' AND shipped to
  // the browser, so anyone could trigger mass WhatsApp and SMS sends.
  get cronSecret() { return required('CRON_SECRET') },
  get setupSecret() { return required('SETUP_SECRET') },

  // ── FACEBOOK / GOOGLE LEAD INGEST ───────────────────────────
  get facebookAppSecret() { return optional('FACEBOOK_APP_SECRET') },
  get facebookVerifyToken() { return optional('FACEBOOK_VERIFY_TOKEN') },
  get facebookPageAccessToken() { return optional('FACEBOOK_PAGE_ACCESS_TOKEN') },
  get googleLeadKey() { return optional('GOOGLE_LEAD_KEY') },
  // Optional shared secrets for the two lead webhooks that had no check at
  // all. Until one is set, guardLeadWebhook falls back to throttling alone.
  get websiteLeadKey() { return optional('WEBSITE_LEAD_KEY') },
  get linkedinLeadKey() { return optional('LINKEDIN_LEAD_KEY') },
}
