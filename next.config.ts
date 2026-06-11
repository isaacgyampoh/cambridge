import type { NextConfig } from 'next'

// All public config baked in — no Vercel env vars needed for these
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://gejtxkbatldxbbqynpfg.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlanR4a2JhdGxkeGJicXlucGZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTg2MzksImV4cCI6MjA5NjY5NDYzOX0.wKs4_UCaxpIi2a0g9eor_KTmkkzzytNi0KsSf9tJgZI',
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: 'pk_live_0c562178b2e71a90ecd8bd78d78310e159ea0f69',
    NEXT_PUBLIC_APP_URL: 'https://cambridge-cce.vercel.app',
    NEXT_PUBLIC_APP_NAME: 'Cambridge Centre of Excellence',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'gejtxkbatldxbbqynpfg.supabase.co' },
    ],
  },
}

export default nextConfig
