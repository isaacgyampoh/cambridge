import { createServiceClient } from '@/lib/supabase/server'

export default async function CertificateDownload({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const sb = createServiceClient()
  const { data: cert } = await sb.from('certificates').select('*').eq('download_token', token).maybeSingle()

  if (!cert) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f8fc', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ color: '#1a2230' }}>Certificate not found</h1>
          <p style={{ color: '#94a3b8' }}>This link may be invalid or expired. Please contact Cambridge Centre of Excellence.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f8fc', fontFamily: 'Inter, sans-serif', padding: 20 }}>
      <div style={{ maxWidth: 460, width: '100%', background: '#fff', borderRadius: 20, border: '1px solid #e6eaf0', padding: 36, textAlign: 'center', boxShadow: '0 4px 24px rgba(26,34,48,0.06)' }}>
        <img src="/brand/logo.png" alt="Cambridge Centre of Excellence" style={{ width: 72, height: 72, objectFit: 'contain', margin: '0 auto 16px' }} />
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1a2230', margin: '0 0 4px', letterSpacing: '-0.02em' }}>Your certificate is ready</h1>
        <p style={{ color: '#4a5568', fontSize: 15, margin: '0 0 24px' }}>Congratulations, {cert.student_name.split(' ')[0]}.</p>

        <div style={{ background: '#f5f8fc', borderRadius: 12, padding: 20, textAlign: 'left', marginBottom: 24 }}>
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
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Your certificate is being prepared. Please check back shortly.</p>
        )}
        <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 24 }}>Cambridge Centre of Excellence</p>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ color: '#94a3b8', fontSize: 13 }}>{label}</span>
      <span style={{ color: '#1a2230', fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  )
}
