import { createServiceClient } from '@/lib/supabase/server'
import { GraduationCap, Briefcase, Star } from 'lucide-react'

export default async function PublicAlumniPage() {
  const sb = createServiceClient()
  const { data: alumni } = await sb.from('alumni')
    .select('*')
    .eq('is_published', true)
    .order('is_featured', { ascending: false })
    .order('graduation_date', { ascending: false })

  const featured = (alumni || []).filter((a: any) => a.is_featured)
  const rest = (alumni || []).filter((a: any) => !a.is_featured)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 text-white py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/20 backdrop-blur mb-4">
            <GraduationCap size={28} className="text-white" />
          </div>
          <h1 className="text-4xl font-black mb-3">Our Alumni</h1>
          <p className="text-blue-200 text-lg max-w-xl mx-auto">
            Real people, real results. Meet the graduates of Cambridge Centre of Excellence who are making an impact.
          </p>
          <div className="flex items-center justify-center gap-8 mt-8">
            <div className="text-center">
              <div className="text-3xl font-black">{(alumni || []).length}+</div>
              <div className="text-blue-300 text-sm">Graduates</div>
            </div>
            <div className="w-px h-10 bg-white/20" />
            <div className="text-center">
              <div className="text-3xl font-black">100%</div>
              <div className="text-blue-300 text-sm">Certified</div>
            </div>
            <div className="w-px h-10 bg-white/20" />
            <div className="text-center">
              <div className="text-3xl font-black">5</div>
              <div className="text-blue-300 text-sm">Rating</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-12">
        {/* Featured alumni */}
        {featured.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center gap-2 mb-6">
              <Star size={18} className="text-yellow-500"fill="currentColor" />
              <h2 className="text-xl font-bold text-gray-900">Featured Success Stories</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {featured.map((a: any) => (
                <div key={a.id} className="bg-white rounded-3xl border-2 border-yellow-200 overflow-hidden shadow-sm">
                  <div className="bg-gradient-to-r from-blue-600 to-blue-700 h-20 relative">
                    <div className="absolute -bottom-8 left-6">
                      <div className="w-16 h-16 rounded-2xl border-4 border-white overflow-hidden bg-blue-200">
                        {a.photo_url
                          ? <img src={a.photo_url} alt={a.full_name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-blue-600 font-bold text-2xl">{a.full_name.charAt(0)}</div>}
                      </div>
                    </div>
                    <div className="absolute top-3 right-3 bg-yellow-400 rounded-full p-1.5">
                      <Star size={14} className="text-yellow-900"fill="currentColor" />
                    </div>
                  </div>
                  <div className="pt-10 px-6 pb-6">
                    <h3 className="text-lg font-bold text-gray-900">{a.full_name}</h3>
                    {(a.current_job_title || a.current_company) && (
                      <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-0.5">
                        <Briefcase size={13} />
                        {[a.current_job_title, a.current_company].filter(Boolean).join('at ')}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-sm text-blue-600 mt-0.5">
                      <GraduationCap size={13} />
                      {a.course_completed}
                    </div>

                    {a.testimonial && (
                      <blockquote className="text-sm text-gray-600 italic mt-4 leading-relaxed border-l-4 border-blue-200 pl-4">
                        "{a.testimonial}"
                      </blockquote>
                    )}

                    {a.success_story && (
                      <p className="text-sm text-gray-500 mt-3 leading-relaxed">{a.success_story}</p>
                    )}

                    {a.linkedin_url && (
                      <a href={a.linkedin_url} target="_blank"
                        className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-blue-600 hover:text-blue-800 transition">
                         View LinkedIn Profile
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All alumni */}
        {rest.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-6">All Graduates</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {rest.map((a: any) => (
                <div key={a.id} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-blue-100 flex-shrink-0">
                      {a.photo_url
                        ? <img src={a.photo_url} alt={a.full_name} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-blue-600 font-bold">{a.full_name.charAt(0)}</div>}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-gray-900 truncate">{a.full_name}</div>
                      <div className="text-xs text-blue-600">{a.course_completed}</div>
                    </div>
                  </div>

                  {(a.current_job_title || a.current_company) && (
                    <div className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                      <Briefcase size={11} />
                      {[a.current_job_title, a.current_company].filter(Boolean).join('at ')}
                    </div>
                  )}

                  {a.testimonial && (
                    <p className="text-xs text-gray-500 italic line-clamp-3">"{a.testimonial}"</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(alumni || []).length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <GraduationCap size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">Alumni stories coming soon</p>
          </div>
        )}
      </div>
    </div>
  )
}
