'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Badge, Spinner, EmptyState, StatCard, inputClass } from '@/components/ui'
import { MessageSquare, User, Search } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

export default function ConversationsPage() {
  const { data: convos, loading } = useData<any>({
    table: 'ai_conversations',
    select: '*, lead:lead_id(full_name), marketer:marketer_id(full_name)',
    orderBy: 'created_at', orderAsc: false, limit: 500,
  })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const todayCount = convos.filter((c: any) => c.created_at?.startsWith(today)).length
  const aiAnswered = convos.filter((c: any) => c.answered_by === 'ai').length

  // Group by phone into threads
  const threads: Record<string, any> = {}
  convos.forEach((c: any) => {
    const key = c.phone
    if (!threads[key]) threads[key] = { phone: key, name: c.lead?.full_name, marketer: c.marketer?.full_name, messages: [], last: c.created_at }
    threads[key].messages.push(c)
  })
  let threadList = Object.values(threads)
  if (search) threadList = threadList.filter((t: any) =>
    [t.name, t.phone, t.marketer].some(v => v?.toLowerCase().includes(search.toLowerCase())))

  const activeThread = selected ? threads[selected] : null

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="AI Assistant"
        title="Conversations"
        description="Every WhatsApp exchange the assistant has handled. Review what it's telling your leads."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Conversations today" value={todayCount} icon={<MessageSquare size={18} />} accent />
        <StatCard label="Total exchanges" value={convos.length} />
        <StatCard label="AI answered" value={aiAnswered} sub={`${convos.length ? Math.round(aiAnswered / convos.length * 100) : 0}% handled`} icon={<MessageSquare size={18} />} />
        <StatCard label="Active threads" value={Object.keys(threads).length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Thread list */}
        <div className="lg:col-span-1">
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search threads" className={inputClass.replace('h-11', 'h-10') + ' pl-9'} />
          </div>
          {loading ? <Spinner /> : threadList.length === 0 ? (
            <EmptyState icon={<MessageSquare size={20} />} title="No conversations yet" description="Once leads start messaging, the assistant's replies appear here." />
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {threadList.map((t: any) => (
                <Card key={t.phone} hover onClick={() => setSelected(t.phone)}
                  className={`p-3 ${selected === t.phone ? 'border-[var(--accent)]' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-[var(--ink)] truncate">{t.name || t.phone.replace(/^233/, '0')}</div>
                      <div className="text-xs text-[var(--ink-faint)] truncate">{t.messages.length} message{t.messages.length === 1 ? '' : 's'}{t.marketer ? ` · ${t.marketer.split(' ')[0]}` : ''}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Thread detail */}
        <div className="lg:col-span-2">
          {!activeThread ? (
            <Card className="p-16 text-center">
              <MessageSquare size={26} className="mx-auto text-[var(--ink-faint)] opacity-40 mb-3" />
              <p className="text-sm text-[var(--ink-faint)]">Select a conversation to read the exchange</p>
            </Card>
          ) : (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-[var(--line-soft)]">
                <div>
                  <div className="font-medium text-[var(--ink)]">{activeThread.name || activeThread.phone.replace(/^233/, '0')}</div>
                  <div className="text-xs text-[var(--ink-faint)]">{activeThread.phone.replace(/^233/, '0')}{activeThread.marketer ? ` · handled in ${activeThread.marketer.split(' ')[0]}'s voice` : ''}</div>
                </div>
              </div>
              <div className="space-y-4 max-h-[520px] overflow-y-auto">
                {[...activeThread.messages].reverse().map((m: any) => (
                  <div key={m.id} className="space-y-3">
                    {/* Incoming */}
                    {m.incoming_text && (
                      <div className="flex gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-[var(--line-soft)] flex items-center justify-center flex-shrink-0"><User size={13} className="text-[var(--ink-soft)]" /></div>
                        <div className="bg-[var(--line-soft)] rounded-2xl rounded-tl-sm px-3.5 py-2 max-w-[80%]">
                          <div className="text-sm text-[var(--ink)] whitespace-pre-line">{m.incoming_text}</div>
                          <div className="text-[10px] text-[var(--ink-faint)] mt-1">{formatDateTime(m.created_at)}</div>
                        </div>
                      </div>
                    )}
                    {/* Reply */}
                    {m.reply_text && (
                      <div className="flex gap-2.5 flex-row-reverse">
                        <div className="w-7 h-7 rounded-full bg-[var(--accent)] flex items-center justify-center flex-shrink-0 text-white text-[10px] font-semibold">CCE</div>
                        <div className="bg-[var(--accent)] text-white rounded-2xl rounded-tr-sm px-3.5 py-2 max-w-[80%]">
                          <div className="text-sm whitespace-pre-line">{m.reply_text}</div>
                          <div className="text-[10px] text-white/55 mt-1">
                            {m.answered_by === 'ai' ? 'Auto-reply' : m.answered_by}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
