import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getHousekeepingBoard, getReadyBy } from '../api/housekeeping'
import { listHotels } from '../api/hotels'
import StateView from '../components/StateView'
import { useAsync } from '../hooks/useAsync'

function formatUtc(value: string): string {
  return `${new Date(value).toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
}

function ReadyByResult({ roomId }: { roomId: number }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const result = useAsync(() => getReadyBy(roomId), [roomId, refreshKey])

  return (
    <StateView
      state={result}
      isEmpty={() => false}
      emptyText="No ready-by information is available."
      onRetry={() => setRefreshKey(key => key + 1)}
    >
      {data => (
        <div className="ready-by-result">
          <h2>Room {data.roomId}</h2>
          <p>Current state: {data.state}</p>
          <p>{data.basedOn}</p>
          {data.readyBy && <p>Ready by: {formatUtc(data.readyBy)}</p>}
          {data.estimatedReadyAt && <p>Estimated ready: {formatUtc(data.estimatedReadyAt)}</p>}
          {data.expectedReturnAt && <p>Expected return: {formatUtc(data.expectedReturnAt)}</p>}
        </div>
      )}
    </StateView>
  )
}

function ReadyByForHotel({ hotelId }: { hotelId: number }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [requestedRoomId, setRequestedRoomId] = useState<number | null>(null)
  const board = useAsync(() => getHousekeepingBoard(hotelId), [hotelId, refreshKey])

  return (
    <StateView
      state={board}
      isEmpty={data => data.floors.every(floor => floor.rooms.length === 0)}
      emptyText="No rooms for this hotel."
      onRetry={() => setRefreshKey(key => key + 1)}
    >
      {data => {
        const rooms = data.floors.flatMap(floor =>
          floor.rooms.map(room => ({ ...room, floorNumber: floor.floor })),
        ).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
        return (
          <>
            <form
              className="lookup-form"
              onSubmit={event => {
                event.preventDefault()
                const id = Number(selectedRoomId)
                if (Number.isSafeInteger(id) && id > 0) setRequestedRoomId(id)
              }}
            >
              <label>
                Room
                <select required value={selectedRoomId} onChange={event => setSelectedRoomId(event.target.value)}>
                  <option value="">Select a room</option>
                  {rooms.map(room => (
                    <option key={room.roomId} value={room.roomId}>
                      Room {room.roomNumber} - Floor {room.floorNumber}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={!selectedRoomId}>Check ready-by</button>
            </form>
            {requestedRoomId !== null && <ReadyByResult key={requestedRoomId} roomId={requestedRoomId} />}
          </>
        )
      }}
    </StateView>
  )
}

export default function ReadyByPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedHotel, setSelectedHotel] = useState('')
  const hotels = useAsync(listHotels, [refreshKey])
  const hotelId = selectedHotel ? Number(selectedHotel) : hotels.data?.[0]?.id

  return (
    <section>
      <h1>Ready-by lookup</h1>
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
            {hotelId !== undefined && <ReadyByForHotel key={hotelId} hotelId={hotelId} />}
          </>
        )}
      </StateView>
    </section>
  )
}
