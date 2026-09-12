import { createServiceClient } from '@/lib/supabase/server'
import Image from 'next/image'
import { lookup } from '@/lib/db/lookup'

export default async function CertificateDownload({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const sb = createServiceClient()
  const { row: cert, failed } = await lookup(
    sb.from('certificates').select('*').eq('download_token', token).maybeSingle())

  /*
   * "This link may be invalid or expired" to somebody who has just finished a
   * programme and been sent their certificate is a hard thing to be told
   * wrongly, and a failed read told it. The page says to try again instead,
   * which is both true and actionable.
   */
  if (failed) {
    console.error('[certificate] could not read the certificate:', failed)
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--canvas)', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ color: 'var(--ink)' }}>We could not load your certificate</h1>
          <p style={{ color: 'var(--ink-faint)' }}>Something went wrong on our side. Please try this link again in a moment.</p>
        </div>
      </div>
    )
  }

  if (!cert) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--canvas)', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ color: 'var(--ink)' }}>Certificate not found</h1>
          <p style={{ color: 'var(--ink-faint)' }}>This link may be invalid or expired. Please contact Cambridge Center of Excellence.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--canvas)', fontFamily: 'Inter, sans-serif', padding: 20 }}>
      <div style={{ maxWidth: 460, width: '100%', background: '#fff', borderRadius: 20, border: '1px solid var(--line)', padding: 36, textAlign: 'center', boxShadow: '0 4px 24px rgba(26,34,48,0.06)' }}>
        <Image src="/brand/logo.png" alt="Cambridge Center of Excellence" width={72} height={72} style={{ objectFit: 'contain', margin: '0 auto 16px' }} priority />
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>Your certificate is ready</h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 15, margin: '0 0 24px' }}>Congratulations, {cert.student_name.split(' ')[0]}.</p>

        <div style={{ background: 'var(--canvas)', borderRadius: 12, padding: 20, textAlign: 'left', marginBottom: 24 }}>
          <Row label="Name" value={cert.student_name} />
          <Row label="Programme" value={cert.course_name} />
          {cert.month_completed && <Row label="Completed" value={cert.month_completed} />}
          {cert.certificate_no && <Row label="Certificate No." value={cert.certificate_no} />}
        </div>

        {cert.certificate_url ? (
          <a href={cert.certificate_url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', background: '#2f80d6', color: '#fff', textDecoration: 'none', padding: '12px 28px', borderRadius: 12, fontSize: 15, fontWeight: 500 }}>
            Download certificate
          </a>
        ) : (
          <p style={{ color: 'var(--ink-faint)', fontSize: 14 }}>Your certificate is being prepared. Please check back shortly.</p>
        )}
        <p style={{ color: 'var(--ink-faint)', fontSize: 12, marginTop: 24 }}>Cambridge Center of Excellence</p>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ color: 'var(--ink-faint)', fontSize: 13 }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  )
}
