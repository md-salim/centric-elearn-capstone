import { listRoomTypes } from '../api/roomTypes'
import StateView from '../components/StateView'
import { useAsync } from '../hooks/useAsync'

export default function RoomTypesPage() {
  const roomTypes = useAsync(listRoomTypes, [])

  return (
    <section>
      <h1>Room Types</h1>
      <StateView state={roomTypes} isEmpty={items => items.length === 0} emptyText="No room types found.">
        {items => (
          <table>
            <thead>
              <tr><th>Code</th><th>Name</th><th>Max occupancy</th><th>Base rate</th><th>Turnaround target</th></tr>
            </thead>
            <tbody>
              {items.map(roomType => (
                <tr key={roomType.id}>
                  <td>{roomType.code}</td>
                  <td>{roomType.name}</td>
                  <td>{roomType.maxOccupancy} guests</td>
                  <td>£{roomType.baseRate.toFixed(2)}</td>
                  <td>{roomType.slaMinutes} minutes</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </StateView>
    </section>
  )
}
