import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getHousekeepingBoard, markRoomOutOfOrder, transitionRoom } from '../api/housekeeping'
import { listHotels } from '../api/hotels'
import type { BoardRoom, HousekeepingBoard } from '../api/types'
import StateView from '../components/StateView'
import { useAsync } from '../hooks/useAsync'
import { useBoardHub } from '../hooks/useBoardHub'

const legalMoves: Record<string, string[]> = {
  Dirty: ['Cleaning'],
  Cleaning: ['Inspected', 'Ready'],
  Inspected: ['Ready'],
  Ready: [],
  OutOfOrder: ['Dirty'],
}

function targetSummary(room: BoardRoom, generatedAt: string): string {
  if (room.status === 'OutOfOrder') return 'Out of order'
  if (room.status === 'Ready') return room.selfMarked ? 'Ready (self-marked)' : 'Ready'
  if (room.minutesOver !== null && room.minutesOver > 0) return `${room.minutesOver} min over target`
  if (!room.dueAt) return 'No checkout time recorded'
  const minutesLeft = Math.max(0, Math.ceil((Date.parse(room.dueAt) - Date.parse(generatedAt)) / 60000))
  return `${minutesLeft} min left`
}

function BoardForHotel({ hotelId }: { hotelId: number }) {
  const [floor, setFloor] = useState('all')
  const [refreshKey, setRefreshKey] = useState(0)
  const [outOfOrderRoomId, setOutOfOrderRoomId] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [busyRoomId, setBusyRoomId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const board = useAsync(() => getHousekeepingBoard(hotelId), [hotelId, refreshKey])
  const onRoomUpdated = () => setRefreshKey(key => key + 1)
  const connectionStatus = useBoardHub(hotelId, onRoomUpdated)

  useEffect(() => {
    if (connectionStatus === 'live') return
    const timer = window.setInterval(() => setRefreshKey(key => key + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [connectionStatus])

  async function moveRoom(roomId: number, to: string) {
    setBusyRoomId(roomId)
    setActionError(null)
    setActionMessage(null)
    try {
      await transitionRoom(roomId, { to })
      setActionMessage(`Room ${roomId} moved to ${to}.`)
      setRefreshKey(key => key + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Room status could not be updated.')
    } finally {
      setBusyRoomId(null)
    }
  }

  async function submitOutOfOrder(roomId: number) {
    setBusyRoomId(roomId)
    setActionError(null)
    setActionMessage(null)
    try {
      await markRoomOutOfOrder(roomId, {
        reason,
        ...(until ? { until: new Date(until).toISOString() } : {}),
      })
      setOutOfOrderRoomId(null)
      setReason('')
      setUntil('')
      setActionMessage(`Room ${roomId} marked out of order.`)
      setRefreshKey(key => key + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Room could not be marked out of order.')
    } finally {
      setBusyRoomId(null)
    }
  }

  return (
    <section>
      <div className="page-heading">
        <h1>Housekeeping board</h1>
        <div className={`connection-status ${connectionStatus}`} role="status">
          {connectionStatus === 'live' ? 'Live' : connectionStatus === 'connecting' ? 'Connecting…' : 'Reconnecting'}
        </div>
      </div>
      <div className="filters">
        <label>
          Floor{' '}
          <select value={floor} onChange={event => setFloor(event.target.value)}>
            <option value="all">All floors</option>
            {(board.data?.floors ?? []).map(item => (
              <option key={item.floor} value={item.floor}>Floor {item.floor}</option>
            ))}
          </select>
        </label>
        <Link to="/housekeeping/sla-breaches">SLA breach list</Link>
        <Link to="/housekeeping/floor-assignments">Floor assignments</Link>
        <Link to="/housekeeping/ready-by">Ready-by lookup</Link>
      </div>
      <p className="state">Login and role-based permissions are not configured; available actions are not access-controlled.</p>
      {connectionStatus !== 'live' && <p className="state">Live updates are unavailable. The board will refresh every 30 seconds.</p>}
      {actionError && <p className="state error" role="alert">{actionError}</p>}
      {actionMessage && <p className="state success" role="status">{actionMessage}</p>}
      <StateView
        state={board}
        isEmpty={(data: HousekeepingBoard) => data.floors.every(item => item.rooms.length === 0)}
        emptyText="No rooms for this hotel."
        onRetry={() => setRefreshKey(key => key + 1)}
      >
        {data => {
          const floors = data.floors
            .filter(item => floor === 'all' || item.floor === Number(floor))
            .sort((a, b) => {
              const busyDifference =
                b.rooms.filter(room => room.status === 'Dirty' || room.status === 'Cleaning').length -
                a.rooms.filter(room => room.status === 'Dirty' || room.status === 'Cleaning').length
              return busyDifference || a.floor - b.floor
            })
          const busiestCount = Math.max(0, ...floors.map(item =>
            item.rooms.filter(room => room.status === 'Dirty' || room.status === 'Cleaning').length))

          return (
            <div className="housekeeping-floors">
              {floors.map(item => {
                const busyCount = item.rooms.filter(room => room.status === 'Dirty' || room.status === 'Cleaning').length
                return (
                  <section className={`floor-section${busyCount === busiestCount && busyCount > 0 ? ' busiest' : ''}`} key={item.floor}>
                    <div className="floor-heading">
                      <h2>Floor {item.floor}</h2>
                      <span>{busyCount} rooms being turned</span>
                      <span>{item.housekeeper?.displayName ?? 'No housekeeper assigned'}</span>
                    </div>
                    <div className="room-grid">
                      {item.rooms.map(room => (
                        <article className={`room-card status-${room.status.toLowerCase()}`} key={room.roomId}>
                          <div className="room-card-heading">
                            <strong>Room {room.roomNumber}</strong>
                            <span className="room-status">{room.status}</span>
                          </div>
                          <p>{room.roomType}</p>
                          <p>{targetSummary(room, data.generatedAt)}</p>
                          {room.selfMarked && <span className="badge">Self-marked</span>}
                          {room.oooReason && <p>Reason: {room.oooReason}</p>}
                          <div className="room-actions">
                            {legalMoves[room.status]?.map(move => (
                              <button
                                key={move}
                                disabled={busyRoomId === room.roomId}
                                onClick={() => void moveRoom(room.roomId, move)}
                              >
                                {busyRoomId === room.roomId ? 'Saving…' : `Move to ${move}`}
                              </button>
                            ))}
                            {room.status !== 'OutOfOrder' && (
                              <button
                                disabled={busyRoomId === room.roomId}
                                onClick={() => {
                                  setOutOfOrderRoomId(current => current === room.roomId ? null : room.roomId)
                                  setReason('')
                                  setUntil('')
                                  setActionError(null)
                                }}
                              >
                                Out of order
                              </button>
                            )}
                          </div>
                          {outOfOrderRoomId === room.roomId && (
                            <form
                              className="ooo-form"
                              onSubmit={event => {
                                event.preventDefault()
                                void submitOutOfOrder(room.roomId)
                              }}
                            >
                              <label>
                                Reason
                                <input required value={reason} onChange={event => setReason(event.target.value)} />
                              </label>
                              <label>
                                Expected return (optional, local time)
                                <input type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} />
                              </label>
                              <button disabled={busyRoomId === room.roomId}>
                                {busyRoomId === room.roomId ? 'Saving…' : 'Confirm out of order'}
                              </button>
                            </form>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          )
        }}
      </StateView>
    </section>
  )
}

export default function HousekeepingBoardPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedHotel, setSelectedHotel] = useState('')
  const hotels = useAsync(listHotels, [refreshKey])
  const hotelId = selectedHotel ? Number(selectedHotel) : hotels.data?.[0]?.id

  return (
    <section>
      <StateView
        state={hotels}
        isEmpty={items => items.length === 0}
        emptyText="No hotels configured."
        onRetry={() => setRefreshKey(key => key + 1)}
      >
        {items => (
          <>
            <label>
              Hotel{' '}
              <select value={hotelId ?? ''} onChange={event => setSelectedHotel(event.target.value)}>
                {items.map(hotel => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}
              </select>
            </label>
            {hotelId !== undefined && <BoardForHotel key={hotelId} hotelId={hotelId} />}
          </>
        )}
      </StateView>
    </section>
  )
}
