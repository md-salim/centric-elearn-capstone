import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getLateRooms } from '../api/housekeeping'
import { listHotels } from '../api/hotels'
import StateView from '../components/StateView'
import { useAsync } from '../hooks/useAsync'

function formatUtc(value: string): string {
  return `${new Date(value).toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
}

function LateRoomsForHotel({ hotelId }: { hotelId: number }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const rooms = useAsync(() => getLateRooms(hotelId), [hotelId, refreshKey])

  return (
    <StateView
      state={rooms}
      isEmpty={items => items.length === 0}
      emptyText="No late rooms."
      onRetry={() => setRefreshKey(key => key + 1)}
    >
      {items => (
        <table>
          <thead>
            <tr><th>Room</th><th>Floor</th><th>Room type</th><th>Status</th><th>Checked out</th><th>Due</th><th>Minutes over</th></tr>
          </thead>
          <tbody>
            {items.map(room => (
              <tr key={room.roomId}>
                <td>{room.roomNumber}</td>
                <td>{room.floor}</td>
                <td>{room.roomType}</td>
                <td>{room.status}</td>
                <td>{formatUtc(room.checkedOutAt)}</td>
                <td>{formatUtc(room.dueAt)}</td>
                <td>{room.minutesOver}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </StateView>
  )
}

export default function LateRoomsPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedHotel, setSelectedHotel] = useState('')
  const hotels = useAsync(listHotels, [refreshKey])
  const hotelId = selectedHotel ? Number(selectedHotel) : hotels.data?.[0]?.id

  return (
    <section>
      <h1>Late rooms</h1>
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
            {hotelId !== undefined && <LateRoomsForHotel key={hotelId} hotelId={hotelId} />}
          </>
        )}
      </StateView>
    </section>
  )
}
