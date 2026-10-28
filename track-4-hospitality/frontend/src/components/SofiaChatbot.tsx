import { useState, useRef, useEffect, type FormEvent } from 'react'
import { processSofiaQuery } from '../api/mcp'
import type {
  McpChatMessage,
  McpArrivalsWithoutReadyRoomResult,
  McpRoomsBreachingSlaResult,
  McpHousekeeperLoadResult,
  McpOooImpactResult,
  McpReadonlyQueryResult,
} from '../api/types'

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

export default function SofiaChatbot() {
  const [isOpen, setIsOpen] = useState(false)
  const [hotelId, setHotelId] = useState(1)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<McpChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content:
        'Hello Sofia! I am your **Larchmont Operations Assistant**, connected to the Larchmont MCP server.\n\nClick **"🛎️ Check room status"** below to immediately inspect current room turnaround and statuses, or ask any operational query.',
    },
  ])

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  const handleSendQuery = async (queryToSend: string) => {
    const text = queryToSend.trim()
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
      const errorMsg: McpChatMessage = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `Sorry Sofia, I encountered an error executing the MCP tool: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    handleSendQuery(input || DEFAULT_QUERY)
  }

  const handleClear = () => {
    setMessages([
      {
        id: 'welcome-reset',
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content:
          'Chat reset. Click **"🛎️ Check room status"** to immediately check the current room status via Larchmont MCP.',
      },
    ])
  }

  return (
    <aside className="sofia-chatbot-container" aria-label="Sofia's Assistant">
      {!isOpen && (
        <button
          className="chatbot-fab"
          onClick={() => setIsOpen(true)}
          title="Open Sofia's Operations Assistant"
        >
          <span className="fab-icon">🤖</span>
          <span className="fab-text">Ask MCP Assistant</span>
          <span className="fab-badge">Sofia</span>
        </button>
      )}

      {isOpen && (
        <div className="chatbot-window">
          <header className="chatbot-header">
            <div className="header-info">
              <span className="assistant-avatar">🤖</span>
              <div>
                <h3 className="assistant-title">Sofia's Operations Assistant</h3>
                <span className="mcp-server-indicator">
                  <span className="status-dot online"></span>
                  Larchmont MCP Server Active
                </span>
              </div>
            </div>

            <div className="header-controls">
              <label className="hotel-select-label">
                Hotel:
                <select
                  value={hotelId}
                  onChange={e => setHotelId(Number(e.target.value))}
                  className="hotel-select"
                >
                  {HOTELS.map(h => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="chatbot-btn-close"
                onClick={() => setIsOpen(false)}
                title="Close chat"
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="chatbot-quick-prompts">
            <span className="quick-prompt-label">Default / Quick queries:</span>
            <div className="prompt-chips">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p.query}
                  className={`prompt-chip ${p.isDefault ? 'default-chip' : ''}`}
                  onClick={() => handleSendQuery(p.query)}
                  disabled={loading}
                >
                  {p.label}
                  {p.isDefault && <span className="chip-badge">Default</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="chatbot-messages">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`chat-bubble-row ${msg.sender === 'user' ? 'row-user' : 'row-assistant'}`}
              >
                <div className={`chat-bubble ${msg.sender === 'user' ? 'bubble-user' : 'bubble-assistant'}`}>
                  <div className="bubble-header">
                    <span className="bubble-sender">
                      {msg.sender === 'user' ? 'Sofia Lindqvist' : 'Larchmont Assistant'}
                    </span>
                    <span className="bubble-time">{msg.timestamp}</span>
                  </div>

                  {msg.toolUsed && (
                    <div className="mcp-tool-badge" title="Invoked MCP Tool">
                      <span className="tool-icon">⚡</span>
                      <span>MCP Tool: <code>{msg.toolUsed}</code></span>
                    </div>
                  )}

                  <div className="bubble-content">
                    {msg.content.split('\n').map((line, idx) => (
                      <p key={idx} className="content-line">
                        {renderFormattedText(line)}
                      </p>
                    ))}
                  </div>

                  {msg.toolData && (
                    <div className="mcp-structured-view">
                      {renderStructuredToolData(msg.toolUsed, msg.toolData)}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-bubble-row row-assistant">
                <div className="chat-bubble bubble-assistant loading-bubble">
                  <span className="spinner"></span> Querying Larchmont MCP server...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="chatbot-input-form">
            <div className="input-row">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={`Ask a question (Default: "${DEFAULT_QUERY}")`}
                className="chatbot-input"
                disabled={loading}
              />
              <button
                type="submit"
                className="chatbot-send-btn"
                disabled={loading}
              >
                {input ? 'Send' : 'Run Default'}
              </button>
            </div>
            <div className="input-footer">
              <span className="footer-tip">Tip: Press &quot;Run Default&quot; to immediately check room status</span>
              <button
                type="button"
                onClick={handleClear}
                className="chatbot-clear-btn"
                title="Clear conversation"
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}

function renderFormattedText(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>
    }
    return part
  })
}

function renderStructuredToolData(
  tool?: string,
  data?:
    | McpArrivalsWithoutReadyRoomResult
    | McpRoomsBreachingSlaResult
    | McpHousekeeperLoadResult
    | McpOooImpactResult
    | McpReadonlyQueryResult,
) {
  if (!data) return null

  // 1. Arrivals Without Ready Room
  if (tool === 'arrivals_without_ready_room') {
    const arrivals = data as McpArrivalsWithoutReadyRoomResult
    return (
      <div className="mcp-card">
        <h4 className="mcp-card-title">Arrivals Shortfall Breakdown</h4>
        {arrivals.roomTypes.length === 0 ? (
          <p className="mcp-empty-notice">✅ No room types have a shortfall. All arrivals covered by ready rooms.</p>
        ) : (
          <table className="mcp-mini-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Room Type</th>
                <th>Arrivals</th>
                <th>Ready</th>
                <th>Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {arrivals.roomTypes.map(rt => (
                <tr key={rt.roomTypeCode} className={rt.shortfall > 0 ? 'row-alert' : ''}>
                  <td><strong>{rt.roomTypeCode}</strong></td>
                  <td>{rt.roomType}</td>
                  <td>{rt.arrivals}</td>
                  <td>{rt.readyRooms}</td>
                  <td>
                    <span className="shortfall-badge">+{rt.shortfall} needed</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  // 2. Rooms Breaching SLA
  if (tool === 'rooms_breaching_sla') {
    const breaches = data as McpRoomsBreachingSlaResult
    return (
      <div className="mcp-card">
        <h4 className="mcp-card-title">SLA Breach List (Worst First)</h4>
        {breaches.rooms.length === 0 ? (
          <p className="mcp-empty-notice">✅ No rooms are currently breaching SLA.</p>
        ) : (
          <table className="mcp-mini-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Floor</th>
                <th>Type</th>
                <th>Status</th>
                <th>Minutes Over</th>
              </tr>
            </thead>
            <tbody>
              {breaches.rooms.map(r => (
                <tr key={r.roomId} className="row-breach">
                  <td><strong>{r.roomNumber}</strong></td>
                  <td>{r.floor}</td>
                  <td>{r.roomType}</td>
                  <td>
                    <span className={`status-pill pill-${r.status.toLowerCase()}`}>{r.status}</span>
                  </td>
                  <td>
                    <span className="breach-pill">+{r.minutesOver} min</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  // 3. Readonly Query (Default Room Status from vw_rooms_status)
  if (tool === 'run_readonly_query') {
    const queryResult = data as McpReadonlyQueryResult
    return (
      <div className="mcp-card">
        <h4 className="mcp-card-title">vw_rooms_status Data ({queryResult.rowCount} rooms)</h4>
        <div className="table-scroll-wrapper">
          <table className="mcp-mini-table">
            <thead>
              <tr>
                {queryResult.columns.map(c => (
                  <th key={c}>{c.replace(/_/g, ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queryResult.rows.map((row, idx) => (
                <tr key={idx}>
                  {row.map((val, cellIdx) => {
                    const str = val !== null && val !== undefined ? String(val) : '—'
                    const isStatus = queryResult.columns[cellIdx] === 'status'
                    return (
                      <td key={cellIdx}>
                        {isStatus ? (
                          <span className={`status-pill pill-${str.toLowerCase()}`}>{str}</span>
                        ) : (
                          str
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // 4. Housekeeper Load
  if (tool === 'housekeeper_load') {
    const load = data as McpHousekeeperLoadResult
    return (
      <div className="mcp-card">
        <h4 className="mcp-card-title">Housekeeper Load Summary</h4>
        <table className="mcp-mini-table">
          <thead>
            <tr>
              <th>Housekeeper</th>
              <th>Floors</th>
              <th>Assigned</th>
              <th>Done</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {load.housekeepers.map(h => (
              <tr key={h.housekeeperId}>
                <td><strong>{h.displayName}</strong></td>
                <td>{h.floors.join(', ')}</td>
                <td>{h.assigned}</td>
                <td>{h.completed}</td>
                <td>
                  <strong className={h.outstanding > 0 ? 'outstanding-count' : ''}>
                    {h.outstanding}
                  </strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // 5. Out of Order Impact
  if (tool === 'ooo_impact_on_occupancy') {
    const ooo = data as McpOooImpactResult
    return (
      <div className="mcp-card">
        <h4 className="mcp-card-title">Out of Order Rooms</h4>
        <table className="mcp-mini-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Type</th>
              <th>Nights Lost</th>
            </tr>
          </thead>
          <tbody>
            {ooo.byRoom.map(r => (
              <tr key={r.roomId}>
                <td><strong>{r.roomNumber}</strong></td>
                <td>{r.roomType}</td>
                <td>{r.nightsLost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return null
}

