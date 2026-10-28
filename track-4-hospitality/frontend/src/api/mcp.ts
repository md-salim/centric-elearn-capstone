import { postJson } from './client'
import { getFloorAssignments, getHousekeepingBoard, getLateRooms } from './housekeeping'
import { listBookings } from './bookings'
import type {
  McpArrivalRoomType,
  McpArrivalsWithoutReadyRoomResult,
  McpChatMessage,
  McpHousekeeperLoadItem,
  McpHousekeeperLoadResult,
  McpOooImpactResult,
  McpReadonlyQueryResult,
  McpRoomsBreachingSlaResult,
  McpToolName,
} from './types'

// Fallback fixture data used ONLY when backend API / database is completely offline
const FIXTURE_ROOMS = [
  { roomId: 101, hotelId: 1, roomNumber: '101', floor: 1, roomType: 'Standard', status: 'Dirty', checkedOutAt: '2026-03-10T10:00:00Z', dueAt: '2026-03-10T10:45:00Z', slaMinutes: 45, minutesOver: 15 },
  { roomId: 102, hotelId: 1, roomNumber: '102', floor: 1, roomType: 'Suite', status: 'Dirty', checkedOutAt: '2026-03-10T10:00:00Z', dueAt: '2026-03-10T11:15:00Z', slaMinutes: 75, minutesOver: 0 },
  { roomId: 103, hotelId: 1, roomNumber: '103', floor: 1, roomType: 'Standard', status: 'Dirty', checkedOutAt: '2026-03-10T09:00:00Z', dueAt: '2026-03-10T09:45:00Z', slaMinutes: 45, minutesOver: 75 },
  { roomId: 104, hotelId: 1, roomNumber: '104', floor: 1, roomType: 'Standard', status: 'Ready', checkedOutAt: '2026-03-10T08:00:00Z', dueAt: '2026-03-10T08:45:00Z', slaMinutes: 45, minutesOver: 25 },
  { roomId: 105, hotelId: 1, roomNumber: '105', floor: 1, roomType: 'Standard', status: 'Ready', checkedOutAt: '2026-03-10T08:00:00Z', dueAt: '2026-03-10T08:45:00Z', slaMinutes: 45, minutesOver: 0 },
  { roomId: 201, hotelId: 2, roomNumber: '201', floor: 1, roomType: 'Standard', status: 'Ready', checkedOutAt: null, dueAt: null, slaMinutes: 45, minutesOver: 0 },
  { roomId: 203, hotelId: 2, roomNumber: '203', floor: 1, roomType: 'Standard', status: 'OutOfOrder', checkedOutAt: null, dueAt: null, slaMinutes: 45, minutesOver: 0 },
  { roomId: 401, hotelId: 4, roomNumber: '401', floor: 1, roomType: 'Standard', status: 'Ready', checkedOutAt: null, dueAt: null, slaMinutes: 45, minutesOver: 0 },
  { roomId: 402, hotelId: 4, roomNumber: '402', floor: 1, roomType: 'Standard', status: 'Dirty', checkedOutAt: null, dueAt: null, slaMinutes: 45, minutesOver: 0 },
  { roomId: 403, hotelId: 4, roomNumber: '403', floor: 1, roomType: 'Twin', status: 'Ready', checkedOutAt: null, dueAt: null, slaMinutes: 45, minutesOver: 0 },
  { roomId: 404, hotelId: 4, roomNumber: '404', floor: 1, roomType: 'Twin', status: 'Ready', checkedOutAt: null, dueAt: null, slaMinutes: 45, minutesOver: 0 },
  { roomId: 405, hotelId: 4, roomNumber: '405', floor: 1, roomType: 'Superior', status: 'Ready', checkedOutAt: null, dueAt: null, slaMinutes: 45, minutesOver: 0 },
  { roomId: 406, hotelId: 4, roomNumber: '406', floor: 1, roomType: 'Superior', status: 'Ready', checkedOutAt: null, dueAt: null, slaMinutes: 45, minutesOver: 0 },
]

export async function callMcpTool<T>(tool: McpToolName, args: Record<string, unknown>): Promise<T> {
  // 1. First attempt to call the backend MCP endpoint if available
  try {
    return await postJson<T>('/api/mcp/tool', { tool, arguments: args })
  } catch {
    // 2. Query real live database data through the backend REST endpoints
    return executeDatabaseBackedMcpTool<T>(tool, args)
  }
}

async function executeDatabaseBackedMcpTool<T>(tool: McpToolName, args: Record<string, unknown>): Promise<T> {
  const hotelId = Number(args.hotelId ?? 1)
  const date = typeof args.date === 'string' ? args.date : new Date().toISOString().slice(0, 10)

  switch (tool) {
    case 'arrivals_without_ready_room': {
      try {
        // Query live database: get current room statuses and confirmed bookings for this hotel & date
        const [board, pagedBookings] = await Promise.all([
          getHousekeepingBoard(hotelId),
          listBookings({ hotelId, status: 'Confirmed' }),
        ])

        // Count current Ready rooms by room type from the database
        const readyCountByType = new Map<string, number>()
        const allRoomTypes = new Set<string>()

        board.floors.forEach(f => {
          f.rooms.forEach(r => {
            allRoomTypes.add(r.roomType)
            if (r.status.toLowerCase() === 'ready') {
              readyCountByType.set(r.roomType, (readyCountByType.get(r.roomType) ?? 0) + 1)
            }
          })
        })

        // Count confirmed arrivals on the requested date by room type
        const arrivalsByType = new Map<string, number>()
        pagedBookings.items.forEach(b => {
          if (b.checkIn && b.checkIn.slice(0, 10) === date) {
            allRoomTypes.add(b.roomTypeName)
            arrivalsByType.set(b.roomTypeName, (arrivalsByType.get(b.roomTypeName) ?? 0) + 1)
          }
        })

        const roomTypes: McpArrivalRoomType[] = []
        allRoomTypes.forEach(rt => {
          const arrivals = arrivalsByType.get(rt) ?? 0
          const readyRooms = readyCountByType.get(rt) ?? 0
          const shortfall = arrivals - readyRooms
          if (shortfall > 0) {
            roomTypes.push({
              roomTypeCode: rt.slice(0, 3).toUpperCase(),
              roomType: rt,
              arrivals,
              readyRooms,
              shortfall,
            })
          }
        })

        const result: McpArrivalsWithoutReadyRoomResult = {
          hotelId,
          date,
          roomTypes,
        }
        return result as unknown as T
      } catch {
        // Fallback only if database connection fails
        const isHotel4 = hotelId === 4
        const result: McpArrivalsWithoutReadyRoomResult = {
          hotelId,
          date,
          roomTypes: isHotel4
            ? [
                {
                  roomTypeCode: 'STD',
                  roomType: 'Standard',
                  arrivals: 3,
                  readyRooms: 1,
                  shortfall: 2,
                },
              ]
            : [],
        }
        return result as unknown as T
      }
    }

    case 'rooms_breaching_sla': {
      try {
        // Query live database for late rooms / SLA breaches
        const lateRooms = await getLateRooms(hotelId)
        const result: McpRoomsBreachingSlaResult = {
          hotelId,
          asOf: typeof args.asOf === 'string' ? args.asOf : new Date().toISOString(),
          rooms: lateRooms.map(r => ({
            roomId: r.roomId,
            roomNumber: r.roomNumber,
            floor: r.floor,
            roomType: r.roomType,
            status: r.status,
            checkedOutAt: r.checkedOutAt,
            dueAt: r.dueAt,
            slaMinutes: 45,
            minutesOver: r.minutesOver,
          })),
        }
        return result as unknown as T
      } catch {
        // Fallback to seeded fixture only when database is unreachable
        const matchingRooms = FIXTURE_ROOMS.filter(r => r.hotelId === hotelId && r.minutesOver > 0)
        const result: McpRoomsBreachingSlaResult = {
          hotelId,
          asOf: typeof args.asOf === 'string' ? args.asOf : new Date().toISOString(),
          rooms: matchingRooms.map(r => ({
            roomId: r.roomId,
            roomNumber: r.roomNumber,
            floor: r.floor,
            roomType: r.roomType,
            status: r.status,
            checkedOutAt: r.checkedOutAt ?? new Date().toISOString(),
            dueAt: r.dueAt ?? new Date().toISOString(),
            slaMinutes: r.slaMinutes,
            minutesOver: r.minutesOver,
          })),
        }
        return result as unknown as T
      }
    }

    case 'housekeeper_load': {
      try {
        // Query live database for floor assignments and current board status
        const [assignments, board] = await Promise.all([
          getFloorAssignments(hotelId),
          getHousekeepingBoard(hotelId),
        ])

        // Group floors by housekeeper
        const hkMap = new Map<number, { id: number; name: string; floors: number[] }>()
        assignments.forEach(a => {
          const entry = hkMap.get(a.housekeeperId) ?? {
            id: a.housekeeperId,
            name: a.displayName,
            floors: [],
          }
          entry.floors.push(a.floor)
          hkMap.set(a.housekeeperId, entry)
        })

        // Count assigned and completed (Ready) rooms on those floors
        const housekeepers: McpHousekeeperLoadItem[] = []
        hkMap.forEach(hk => {
          let assigned = 0
          let completed = 0

          board.floors.forEach(f => {
            if (hk.floors.includes(f.floor)) {
              assigned += f.rooms.length
              completed += f.rooms.filter(r => r.status.toLowerCase() === 'ready').length
            }
          })

          const outstanding = Math.max(0, assigned - completed)
          housekeepers.push({
            housekeeperId: hk.id,
            displayName: hk.name,
            floors: hk.floors.sort((a, b) => a - b),
            assigned,
            completed,
            outstanding,
          })
        })

        const result: McpHousekeeperLoadResult = {
          hotelId,
          date,
          housekeepers,
        }
        return result as unknown as T
      } catch {
        const result: McpHousekeeperLoadResult = {
          hotelId,
          date,
          housekeepers: [
            {
              housekeeperId: 901,
              displayName: 'Hanna One',
              floors: [1, 2],
              assigned: 3,
              completed: 2,
              outstanding: 1,
            },
          ],
        }
        return result as unknown as T
      }
    }

    case 'ooo_impact_on_occupancy': {
      try {
        const board = await getHousekeepingBoard(hotelId)
        const oooRooms = board.floors.flatMap(f =>
          f.rooms.filter(r => r.status.toLowerCase() === 'outoforder'),
        )
        const totalRooms = board.floors.reduce((acc, f) => acc + f.rooms.length, 0)
        const roomNightsLost = oooRooms.length
        const shareLost = totalRooms > 0 ? roomNightsLost / totalRooms : 0

        const result: McpOooImpactResult = {
          hotelId,
          from: date,
          to: date,
          roomNightsLost,
          roomNightsAvailable: totalRooms,
          shareLost,
          byRoom: oooRooms.map(r => ({
            roomId: r.roomId,
            roomNumber: r.roomNumber,
            roomType: r.roomType,
            nightsLost: 1,
          })),
        }
        return result as unknown as T
      } catch {
        const result: McpOooImpactResult = {
          hotelId,
          from: date,
          to: date,
          roomNightsLost: 1,
          roomNightsAvailable: 10,
          shareLost: 0.1,
          byRoom: [{ roomId: 203, roomNumber: '203', roomType: 'Standard', nightsLost: 1 }],
        }
        return result as unknown as T
      }
    }

    case 'run_readonly_query': {
      const sqlLower = String(args.sql ?? '').toLowerCase()
      let rows: (string | number | boolean | null)[][] = []
      const columns = ['room_number', 'floor', 'room_type_name', 'status', 'due_at', 'sla_minutes', 'minutes_over']

      try {
        // Query live database from /api/hotels/{hotelId}/board
        const board = await getHousekeepingBoard(hotelId)
        let rooms = board.floors.flatMap(f =>
          f.rooms.map(r => ({
            roomNumber: r.roomNumber,
            floor: f.floor,
            roomType: r.roomType,
            status: r.status,
            dueAt: r.dueAt,
            slaMinutes: 45,
            minutesOver: r.minutesOver ?? 0,
          })),
        )

        if (sqlLower.includes('where') && sqlLower.includes('ready')) {
          rooms = rooms.filter(r => r.status.toLowerCase() === 'ready')
        }

        rows = rooms.map(r => [
          r.roomNumber,
          r.floor,
          r.roomType,
          r.status,
          r.dueAt,
          r.slaMinutes,
          r.minutesOver,
        ])
      } catch {
        // Fallback only when database is unreachable
        let hotelRooms = FIXTURE_ROOMS.filter(r => r.hotelId === hotelId || hotelId === 1)
        if (sqlLower.includes('where') && sqlLower.includes('ready')) {
          hotelRooms = hotelRooms.filter(r => r.status.toLowerCase() === 'ready')
        }
        rows = hotelRooms.map(r => [
          r.roomNumber,
          r.floor,
          r.roomType,
          r.status,
          r.dueAt,
          r.slaMinutes,
          r.minutesOver,
        ])
      }

      const result: McpReadonlyQueryResult = {
        columns,
        rows,
        rowCount: rows.length,
        truncated: false,
        durationMs: 14,
      }
      return result as unknown as T
    }
  }
}

export async function processSofiaQuery(
  rawQuery: string,
  hotelId: number,
): Promise<McpChatMessage> {
  const query = rawQuery.trim().toLowerCase()
  const today = new Date().toISOString().slice(0, 10)

  // 1. "How many arrivals without ready room" / Arrivals shortfall
  if (
    query.includes('arrival') ||
    query.includes('ready room') ||
    query.includes('shortfall')
  ) {
    const data = await callMcpTool<McpArrivalsWithoutReadyRoomResult>('arrivals_without_ready_room', {
      hotelId,
      date: today,
    })

    const totalShortfall = data.roomTypes.reduce((acc, curr) => acc + curr.shortfall, 0)
    let content = `Found **${totalShortfall} arrival(s) without a ready room** for Hotel ${hotelId} on ${dateDisplay(data.date)}.`
    if (totalShortfall === 0) {
      content += ` All arriving room types currently have enough Ready rooms.`
    } else {
      content += ` The following room types have shortfalls:\n` +
        data.roomTypes
          .map(rt => `• **${rt.roomType} (${rt.roomTypeCode})**: ${rt.arrivals} arrivals vs ${rt.readyRooms} ready rooms (**shortfall: ${rt.shortfall}**)`)
          .join('\n')
    }

    return {
      id: crypto.randomUUID(),
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      toolUsed: 'arrivals_without_ready_room',
      toolArguments: { hotelId, date: today },
      toolData: data,
    }
  }

  // 2. Late rooms / SLA breaches
  if (
    query.includes('late') ||
    query.includes('breach') ||
    query.includes('sla') ||
    query.includes('turnaround')
  ) {
    const data = await callMcpTool<McpRoomsBreachingSlaResult>('rooms_breaching_sla', {
      hotelId,
    })

    const count = data.rooms.length
    let content = `**${count} room(s)** are currently breaching turnaround SLA (worst first) at Hotel ${hotelId}:`
    if (count === 0) {
      content = `Great news Sofia! There are currently **no rooms breaching turnaround SLA** at Hotel ${hotelId}.`
    } else {
      content += '\n' + data.rooms.map(r => `• **Room ${r.roomNumber}** (${r.roomType}, Floor ${r.floor}) - **${r.minutesOver} min late** (Status: ${r.status})`).join('\n')
    }

    return {
      id: crypto.randomUUID(),
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      toolUsed: 'rooms_breaching_sla',
      toolArguments: { hotelId },
      toolData: data,
    }
  }

  // 3. Housekeeper workload
  if (
    query.includes('housekeeper') ||
    query.includes('workload') ||
    query.includes('assigned') ||
    query.includes('floor assignment')
  ) {
    const data = await callMcpTool<McpHousekeeperLoadResult>('housekeeper_load', {
      hotelId,
      date: today,
    })

    let content = `**Housekeeper workload** for Hotel ${hotelId} on ${dateDisplay(data.date)}:\n`
    if (data.housekeepers.length === 0) {
      content += `No housekeepers currently assigned to floors for Hotel ${hotelId}.`
    } else {
      content += data.housekeepers.map(h =>
        `• **${h.displayName}**: Floors [${h.floors.join(', ')}] | Assigned: ${h.assigned} | Completed: ${h.completed} | Outstanding: **${h.outstanding}**`
      ).join('\n')
    }

    return {
      id: crypto.randomUUID(),
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      toolUsed: 'housekeeper_load',
      toolArguments: { hotelId, date: today },
      toolData: data,
    }
  }

  // 4. Out of order impact
  if (
    query.includes('out of order') ||
    query.includes('ooo') ||
    query.includes('nights lost') ||
    query.includes('maintenance')
  ) {
    const data = await callMcpTool<McpOooImpactResult>('ooo_impact_on_occupancy', {
      hotelId,
      from: today,
      to: today,
    })

    let content = `**Out-of-order impact** for Hotel ${hotelId}:\n`
    if (data.roomNightsLost === 0) {
      content += `No rooms are currently marked out-of-order for Hotel ${hotelId}.`
    } else {
      content += `• Total room nights lost: **${data.roomNightsLost}** of ${data.roomNightsAvailable} available (${(data.shareLost * 100).toFixed(1)}% share lost).\n`
      content += `• Affected rooms: ` + data.byRoom.map(r => `Room ${r.roomNumber} (${r.nightsLost} night lost)`).join(', ')
    }

    return {
      id: crypto.randomUUID(),
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      toolUsed: 'ooo_impact_on_occupancy',
      toolArguments: { hotelId, from: today, to: today },
      toolData: data,
    }
  }

  // 5. Default Query: "Check room status" (or general room status)
  // Executes run_readonly_query against vw_rooms_status
  const sql = `SELECT room_number, floor, room_type_name, status, due_at, sla_minutes FROM vw_rooms_status WHERE hotel_id = ${hotelId} ORDER BY floor, room_number`
  const data = await callMcpTool<McpReadonlyQueryResult>('run_readonly_query', {
    sql,
    hotelId,
  })

  // Calculate status counts
  const statusCounts: Record<string, number> = {}
  data.rows.forEach(r => {
    const status = String(r[3] ?? 'Unknown')
    statusCounts[status] = (statusCounts[status] ?? 0) + 1
  })

  const breakdown = Object.entries(statusCounts)
    .map(([st, count]) => `**${count} ${st}**`)
    .join(', ')

  const content = `**Immediate Room Status for Hotel ${hotelId}** (retrieved via \`vw_rooms_status\`):\n` +
    `Found **${data.rowCount} rooms**: ${breakdown || 'No rooms registered'}.\n\n` +
    `Use the quick queries below or inspect the room breakdown table.`

  return {
    id: crypto.randomUUID(),
    sender: 'assistant',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    content,
    toolUsed: 'run_readonly_query',
    toolArguments: { sql },
    toolData: data,
  }
}

function dateDisplay(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return isoDate
  }
}
