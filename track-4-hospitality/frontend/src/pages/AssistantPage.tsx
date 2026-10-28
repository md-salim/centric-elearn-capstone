import { useState } from 'react'
import { processSofiaQuery } from '../api/mcp'
import type { McpChatMessage } from '../api/types'

const DEFAULT_QUERY = 'Check room status'

const QUICK_PROMPTS = [
  { label: '🛎️ Check room status', query: 'Check room status', isDefault: true },
  { label: '🚪 Arrivals without ready room', query: 'How many arrivals without ready room' },
  { label: '⚠️ Late rooms (SLA breaches)', query: 'Check late rooms breaching SLA' },
  { label: '🧹 Housekeeper workload', query: 'Check housekeeper workload' },
  { label: '🛠️ Out-of-order impact', query: 'Check out of order room impact' },
]

const HOTELS = [
  { id: 1, name: 'Hotel 1 - Grand Larchmont' },
  { id: 2, name: 'Hotel 2 - Larchmont City' },
  { id: 3, name: 'Hotel 3 - Larchmont Suites' },
  { id: 4, name: 'Hotel 4 - Larchmont Waterfront' },
  { id: 5, name: 'Hotel 5 - Larchmont Airport' },
]

export default function AssistantPage() {
  const [hotelId, setHotelId] = useState(1)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<McpChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content:
        'Hello Sofia! I am your **Larchmont Operations Assistant**, connected directly to the Larchmont MCP server.\n\nClick **"🛎️ Check room status"** below to immediately inspect current room turnaround and statuses, or choose any operational query.',
    },
  ])

  const handleSend = async (queryText: string) => {
    const text = queryText.trim()
    if (!text || loading) return

    const userMsg: McpChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: text,
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const response = await processSofiaQuery(text, hotelId)
      setMessages(prev => [...prev, response])
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `Error executing MCP tool: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Sofia's Operations Assistant</h1>
          <p className="summary">
            Direct interface to the <strong>Larchmont MCP Server</strong> (tools: <code>run_readonly_query</code>, <code>arrivals_without_ready_room</code>, <code>rooms_breaching_sla</code>, <code>housekeeper_load</code>, <code>ooo_impact_on_occupancy</code>).
          </p>
        </div>
        <label className="filters">
          Hotel:
          <select value={hotelId} onChange={e => setHotelId(Number(e.target.value))}>
            {HOTELS.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ marginBottom: '1.5rem', background: '#fff', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #cbd2d9' }}>
        <h3 style={{ marginTop: 0 }}>Quick &amp; Default Operations Queries</h3>
        <p style={{ margin: '0 0 0.75rem 0', color: '#52606d', fontSize: '0.9rem' }}>
          Click the default query below to immediately check room status or arrivals:
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {QUICK_PROMPTS.map(p => (
            <button
              key={p.query}
              onClick={() => handleSend(p.query)}
              disabled={loading}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: p.isDefault ? '2px solid #f0b429' : '1px solid #cbd2d9',
                background: p.isDefault ? '#fff8e6' : '#f0f4f8',
                fontWeight: p.isDefault ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {p.label} {p.isDefault && '★ [Recommended Default]'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: '0.5rem', border: '1px solid #cbd2d9', overflow: 'hidden' }}>
        <div style={{ maxHeight: '420px', overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.map(m => (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.sender === 'user' ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '85%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  background: m.sender === 'user' ? '#243b53' : '#f0f4f8',
                  color: m.sender === 'user' ? '#fff' : '#1f2933',
                }}
              >
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                  <strong>{m.sender === 'user' ? 'Sofia Lindqvist' : 'Larchmont Assistant [MCP]'}</strong>
                  <span>{m.timestamp}</span>
                </div>
                {m.toolUsed && (
                  <div style={{ fontSize: '0.75rem', color: m.sender === 'user' ? '#f0b429' : '#2b6cb0', marginBottom: '0.4rem', fontFamily: 'monospace' }}>
                    ⚡ MCP Tool: {m.toolUsed}
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                  {m.content}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <p className="state">Executing Larchmont MCP tool...</p>
          )}
        </div>

        <form
          onSubmit={e => {
            e.preventDefault()
            handleSend(input || DEFAULT_QUERY)
          }}
          style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderTop: '1px solid #e4e7eb', background: '#f8fafc' }}
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={`Ask a question (Default: "${DEFAULT_QUERY}")`}
            style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '0.25rem', border: '1px solid #cbd2d9' }}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ padding: '0.5rem 1.25rem', background: '#243b53', color: '#fff', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 600 }}
          >
            {input ? 'Send' : 'Run Default Query'}
          </button>
        </form>
      </div>
    </section>
  )
}

