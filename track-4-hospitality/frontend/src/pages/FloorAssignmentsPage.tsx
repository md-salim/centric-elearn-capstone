import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getFloorAssignments, getHousekeepingBoard, replaceFloorAssignments } from '../api/housekeeping'
import { listHotels } from '../api/hotels'
import { listHousekeepers } from '../api/users'
import type { BoardFloor, FloorAssignment, StaffUser } from '../api/types'
import StateView from '../components/StateView'
import { useAsync } from '../hooks/useAsync'

interface AssignmentData {
  floors: BoardFloor[]
  assignments: FloorAssignment[]
  housekeepers: StaffUser[]
}

function AssignmentsForHotel({ hotelId }: { hotelId: number }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [values, setValues] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const data = useAsync(
    async (): Promise<AssignmentData> => {
      const [board, assignments, housekeepers] = await Promise.all([
        getHousekeepingBoard(hotelId),
        getFloorAssignments(hotelId),
        listHousekeepers(hotelId),
      ])
      return {
        floors: board.floors,
        assignments,
        housekeepers: housekeepers.filter(user => user.active),
      }
    },
    [hotelId, refreshKey],
  )

  useEffect(() => {
    if (!data.data) return
    setValues(Object.fromEntries(data.data.assignments.map(item => [item.floor, String(item.housekeeperId)])))
  }, [data.data])

  async function saveAssignments(floors: BoardFloor[]) {
    setSaving(true)
    setError(null)
    setMessage(null)
    const assignments = floors.flatMap(item => {
      const housekeeperId = values[item.floor]
      return housekeeperId ? [{ floor: item.floor, housekeeperId: Number(housekeeperId) }] : []
    })
    try {
      await replaceFloorAssignments(hotelId, assignments)
      setMessage('Floor assignments saved.')
      setRefreshKey(key => key + 1)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Floor assignments could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      {error && <p className="state error" role="alert">{error}</p>}
      {message && <p className="state success" role="status">{message}</p>}
      <StateView
        state={data}
        isEmpty={result => result.floors.length === 0}
        emptyText="No floors with rooms are configured for this hotel."
        onRetry={() => setRefreshKey(key => key + 1)}
      >
        {result => (
          <form onSubmit={event => { event.preventDefault(); void saveAssignments(result.floors) }}>
            <table>
              <thead><tr><th>Floor</th><th>Rooms</th><th>Housekeeper</th></tr></thead>
              <tbody>
                {result.floors.map(floor => (
                  <tr key={floor.floor}>
                    <td>{floor.floor}</td>
                    <td>{floor.rooms.length}</td>
                    <td>
                      <select
                        aria-label={`Housekeeper for floor ${floor.floor}`}
                        value={values[floor.floor] ?? ''}
                        onChange={event => setValues(current => ({ ...current, [floor.floor]: event.target.value }))}
                      >
                        <option value="">Unassigned</option>
                        {result.housekeepers.map(person => (
                          <option key={person.id} value={person.id}>{person.displayName}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button disabled={saving}>{saving ? 'Saving…' : 'Save assignments'}</button>
          </form>
        )}
      </StateView>
    </section>
  )
}

export default function FloorAssignmentsPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedHotel, setSelectedHotel] = useState('')
  const hotels = useAsync(listHotels, [refreshKey])
  const hotelId = selectedHotel ? Number(selectedHotel) : hotels.data?.[0]?.id

  return (
    <section>
      <h1>Floor assignments</h1>
      <Link className="back-link" to="/housekeeping">Back to Housekeeping Board</Link>
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
            {hotelId !== undefined && <AssignmentsForHotel key={hotelId} hotelId={hotelId} />}
          </>
        )}
      </StateView>
    </section>
  )
}
