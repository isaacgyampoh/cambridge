import type { Metadata, Viewport } from 'next'
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
    default: 'Cambridge Center of Excellence',
    template: '%s · Cambridge Center of Excellence',
  },
  description: 'Cambridge Center of Excellence — professional and executive certification training in Ghana. PMP, HR (PHRi/SPHRi) and more.',
  manifest: '/manifest.json',
  applicationName: 'Cambridge CCE',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Cambridge CCE',
  },
  icons: {
    icon: '/favicon.png',
    apple: '/icons/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'Cambridge Center of Excellence',
    title: 'Cambridge Center of Excellence',
    description: 'Professional and executive certification training in Ghana — PMP, HR (PHRi/SPHRi) and more.',
    url: 'https://portal.cambridge.edu.gh',
    images: [{ url: '/brand/logo.png', width: 512, height: 512, alt: 'Cambridge Center of Excellence' }],
  },
  twitter: {
    card: 'summary',
    title: 'Cambridge Center of Excellence',
    description: 'Professional and executive certification training in Ghana.',
    images: ['/brand/logo.png'],
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1a7a85',
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
