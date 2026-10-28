import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getSlaBreaches, getFloorAssignments } from '../api/housekeeping'
import { listHotels } from '../api/hotels'
import StateView from '../components/StateView'
import { useAsync } from '../hooks/useAsync'
import type { FloorAssignment, LateRoom } from '../api/types'

function formatUtc(value: string): string {
  try {
    return `${new Date(value).toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  } catch {
    return value
  }
}

function getSlaTargetMinutes(roomType: string): number {
  const normalized = roomType.toLowerCase()
  if (normalized.includes('suite') || normalized.includes('family')) {
    return 75
  }
  return 45
}

function SlaBreachesForHotel({ hotelId }: { hotelId: number }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedFloor, setSelectedFloor] = useState('all')

  // Fetch both SLA breaches (worst first) and floor assignments to resolve assigned housekeepers
  const combinedState = useAsync(async () => {
    const [breaches, assignments] = await Promise.all([
      getSlaBreaches(hotelId),
      getFloorAssignments(hotelId).catch(() => [] as FloorAssignment[]),
    ])

    const floorMap = new Map<number, string>()
    assignments.forEach(a => {
      floorMap.set(a.floor, a.displayName)
    })

    return { breaches, floorMap }
  }, [hotelId, refreshKey])

  return (
    <StateView
      state={combinedState}
      isEmpty={data => data.breaches.length === 0}
      emptyText="No rooms currently breaching SLA."
      onRetry={() => setRefreshKey(key => key + 1)}
    >
      {data => {
        const { breaches, floorMap } = data
        const totalBreaches = breaches.length
        const maxMinutesOver = Math.max(...breaches.map(r => r.minutesOver), 0)
        const criticalCount = breaches.filter(r => r.minutesOver > 30).length
        const affectedFloors = Array.from(new Set(breaches.map(r => r.floor))).sort((a, b) => a - b)

        const displayedBreaches = selectedFloor === 'all'
          ? breaches
          : breaches.filter(r => r.floor === Number(selectedFloor))

        return (
          <>
            <div className="sla-summary-cards">
              <div className="sla-metric-card">
                <span className="metric-label">Total Breaches</span>
                <span className="metric-value">{totalBreaches}</span>
              </div>
              <div className="sla-metric-card">
                <span className="metric-label">Worst Overrun</span>
                <span className="metric-value metric-critical">+{maxMinutesOver} min</span>
              </div>
              <div className="sla-metric-card">
                <span className="metric-label">Critical (&gt;30m)</span>
                <span className="metric-value">{criticalCount}</span>
              </div>
              <div className="sla-metric-card">
                <span className="metric-label">Affected Floors</span>
                <span className="metric-value">{affectedFloors.join(', ') || 'None'}</span>
              </div>
            </div>

            <div className="filters" style={{ marginTop: '1rem', marginBottom: '0.75rem' }}>
              <label>
                Filter by Floor:{' '}
                <select value={selectedFloor} onChange={e => setSelectedFloor(e.target.value)}>
                  <option value="all">All floors ({totalBreaches} breaches)</option>
                  {affectedFloors.map(fl => (
                    <option key={fl} value={fl}>
                      Floor {fl} ({breaches.filter(r => r.floor === fl).length} breaches)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {displayedBreaches.length === 0 ? (
              <p className="state">No breaching rooms on Floor {selectedFloor}.</p>
            ) : (
              <table className="sla-breaches-table">
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Floor</th>
                    <th>Assigned Housekeeper</th>
                    <th>Room Type</th>
                    <th>SLA Target</th>
                    <th>Status</th>
                    <th>Checked Out</th>
                    <th>Due</th>
                    <th>Minutes Over (Worst First)</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedBreaches.map((room: LateRoom) => {
                    const housekeeper = floorMap.get(room.floor) ?? 'Unassigned'
                    const targetMinutes = getSlaTargetMinutes(room.roomType)
                    const isCritical = room.minutesOver > 30

                    return (
                      <tr key={room.roomId} className={isCritical ? 'row-critical-breach' : ''}>
                        <td><strong>{room.roomNumber}</strong></td>
                        <td>Floor {room.floor}</td>
                        <td>
                          <span className={housekeeper === 'Unassigned' ? 'unassigned-label' : 'housekeeper-name'}>
                            {housekeeper}
                          </span>
                        </td>
                        <td>{room.roomType}</td>
                        <td>
                          <span className="sla-target-badge">{targetMinutes} min</span>
                        </td>
                        <td>
                          <span className={`status-pill pill-${room.status.toLowerCase()}`}>
                            {room.status}
                          </span>
                        </td>
                        <td>{formatUtc(room.checkedOutAt)}</td>
                        <td>{formatUtc(room.dueAt)}</td>
                        <td>
                          <span className={`breach-pill ${isCritical ? 'breach-critical' : 'breach-moderate'}`}>
                            +{room.minutesOver} min over
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )
      }}
    </StateView>
  )
}

export default function SlaBreachesPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedHotel, setSelectedHotel] = useState('')
  const hotels = useAsync(listHotels, [refreshKey])
  const hotelId = selectedHotel ? Number(selectedHotel) : hotels.data?.[0]?.id

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>SLA Breach List</h1>
          <p className="summary">
            Morning turnaround breach list sorted worst-first. Turnaround targets: <strong>45 min</strong> for Standard rooms, <strong>75 min</strong> for Suites &amp; Family rooms from checkout.
          </p>
        </div>
        <Link className="back-link" to="/housekeeping">Back to Housekeeping Board</Link>
      </div>

      <StateView
        state={hotels}
        isEmpty={items => items.length === 0}
        emptyText="No hotels configured."
        onRetry={() => setRefreshKey(key => key + 1)}
      >
        {items => (
          <>
            <label className="filters">
              Hotel{' '}
              <select value={hotelId ?? ''} onChange={event => setSelectedHotel(event.target.value)}>
                {items.map(hotel => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}
              </select>
            </label>
            {hotelId !== undefined && <SlaBreachesForHotel key={hotelId} hotelId={hotelId} />}
          </>
        )}
      </StateView>
    </section>
  )
}
