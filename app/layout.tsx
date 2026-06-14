import type { Metadata, Viewport } from 'next'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/fraunces/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './globals.css'
import { Toaster } from 'sonner'
import ServiceWorker from '@/components/shared/ServiceWorker'
import InstallPrompt from '@/components/shared/InstallPrompt'

export const metadata: Metadata = {
  title: 'Cambridge Centre of Excellence',
  description: 'Institutional management system',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Cambridge CCE',
  },
  icons: {
    icon: '/favicon.png',
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1d4d44',
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
