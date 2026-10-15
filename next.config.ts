import type { NextConfig } from 'next'

/*
 * Public configuration lives in lib/config.ts and reads NEXT_PUBLIC_* variables
 * from the environment.
 *
 * The `env` block that used to sit here inlined values at build time, and it
 * carried a live Paystack publishable key that DIFFERED from the one in
 * lib/config.ts — so payments could initialise against either of two accounts
 * depending on which value the calling code happened to read. There is now one
 * source for each value, and no payment key is hardcoded anywhere: set
 * NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY to the key belonging to the same account as
 * PAYSTACK_SECRET_KEY.
 *
 * Security headers are set in proxy.ts, so that the Content-Security-Policy
 * can vary between development and production.
 */
const nextConfig: NextConfig = {
  /*
   * A server this project can run anywhere.
   *
   * `standalone` emits .next/standalone with its own minimal node_modules and
   * a server.js, so the portal runs under plain `node server.js` on any host
   * that can run Node — Railway, Render, Fly, a VPS, a container. Vercel
   * ignores it and builds as it always has, so setting it costs nothing there
   * and removes the single-supplier risk that took the portal offline when
   * the Vercel account was disabled.
   *
   * Nothing else in this codebase is Vercel-specific: no @vercel packages, no
   * VERCEL_* environment variables, no edge-runtime routes. Only vercel.json
   * is, and the cron it declares already has to be driven by an external
   * pinger on the free plan.
   */
  output: 'standalone',

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname:
          (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gejtxkbatldxbbqynpfg.supabase.co')
            .replace(/^https?:\/\//, ''),
      },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
    ],
  },
}

export default nextConfig
