import type { Metadata, Viewport } from 'next'
import { BRAND } from '@/lib/brand'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './globals.css'
import { Toaster } from 'sonner'
import ServiceWorker from '@/components/shared/ServiceWorker'
import InstallPrompt from '@/components/shared/InstallPrompt'

export const metadata: Metadata = {
  metadataBase: new URL('https://portal.cambridge.edu.gh'),
  title: {
    default: BRAND.name,
    template: '%s · Cambridge Center of Excellence',
  },
  description: `${BRAND.name} — ${BRAND.description}`,
  manifest: '/manifest.json',
  applicationName: BRAND.shortName,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: BRAND.shortName,
  },
  icons: {
    icon: '/favicon.png',
    apple: '/icons/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: BRAND.name,
    description: BRAND.description,
    url: 'https://portal.cambridge.edu.gh',
    images: [{ url: '/brand/logo.png', width: 512, height: 512, alt: BRAND.name }],
  },
  twitter: {
    card: 'summary',
    title: BRAND.name,
    description: BRAND.description,
    images: ['/brand/logo.png'],
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  /*
   * A literal, because this is a meta tag and not a stylesheet.
   *
   * It was `var(--accent)`. The browser cannot resolve a CSS variable here, so
   * the tag was ignored and the phone fell back to the manifest — which still
   * carried a colour from an older palette. That is why a teal band once sat above the
   * sign-in screen on iOS.
   *
   * Kept in step with --brand in globals.css and theme_color in
   * public/manifest.json; all three must say the same thing.
   */
  /*
   * Must agree with public/manifest.json. Two copies of one colour is how the
   * browser chrome ends up a different green from the application it frames.
   */
  themeColor: '#15664D',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">
        {children}
        <Toaster position="top-right" richColors closeButton />
        <ServiceWorker />
        <InstallPrompt />
      </body>
    </html>
  )
}
