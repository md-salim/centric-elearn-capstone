import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';
import { auditedQuery, errorResult, numberValue, sqlDateTime, successResult, validDate } from './support.js';

export const name = 'ooo_impact_on_occupancy';

export const description =
  'Room-nights lost to out-of-order rooms in a date range. Input: hotelId (integer), from (YYYY-MM-DD), to (YYYY-MM-DD). Output JSON: { hotelId, from, to, roomNightsLost, roomNightsAvailable, shareLost, byRoom: [{ roomId, roomNumber, roomType, nightsLost }] }.';

export const inputSchema = {
  hotelId: z.number().int().positive(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

export async function handler(
  input: z.infer<z.ZodObject<typeof inputSchema>>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!validDate(input.from) || !validDate(input.to)) {
    return errorResult('from and to must be valid YYYY-MM-DD dates.');
  }
  if (input.to < input.from) return errorResult('to must be on or after from.');

  const intervalsSql = `
    SELECT intervals.room_id, intervals.room_number, intervals.room_type_code,
           intervals.ooo_from, intervals.ooo_to, availability.room_count
    FROM (
      SELECT COUNT(*) AS room_count
      FROM vw_rooms_status
      WHERE hotel_id = ?
    ) AS availability
    LEFT JOIN (
      SELECT room_id, room_number, room_type_code, ooo_from, ooo_to
      FROM vw_ooo_impact
      WHERE hotel_id = ?
        AND ooo_from < DATE_ADD(?, INTERVAL 1 DAY)
        AND (ooo_to IS NULL OR ooo_to > ?)
    ) AS intervals ON 1 = 1
    ORDER BY intervals.room_id, intervals.ooo_from`;
  const { result, error } = await auditedQuery(
    ctx,
    name,
    input,
    intervalsSql,
    [input.hotelId, input.hotelId, input.to, input.from],
  );
  if (error || !result) return errorResult(error ?? 'Query failed.');

  const from = Date.parse(`${input.from}T00:00:00.000Z`);
  const toExclusive = Date.parse(`${input.to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  const byRoom = new Map<number, { roomId: number; roomNumber: string; roomType: string; nightsLost: number }>();
  for (const [roomIdValue, roomNumberValue, roomTypeValue, startValue, endValue] of result.rows) {
    if (roomIdValue === null || roomIdValue === undefined) continue;
    const startedAt = sqlDateTime(startValue);
    const endedAt = endValue === null ? null : sqlDateTime(endValue);
    if (!startedAt || (endValue !== null && !endedAt)) continue;
    const overlapStart = Math.max(startedAt.getTime(), from);
    const overlapEnd = Math.min(endedAt?.getTime() ?? toExclusive, toExclusive);
    if (overlapEnd <= overlapStart) continue;
    const nightsLost = Math.ceil(overlapEnd / 86_400_000) - Math.floor(overlapStart / 86_400_000);
    if (nightsLost < 1) continue;
    const roomId = numberValue(roomIdValue);
    const existing = byRoom.get(roomId);
    if (existing) existing.nightsLost += nightsLost;
    else {
      byRoom.set(roomId, {
        roomId,
        roomNumber: String(roomNumberValue),
        roomType: String(roomTypeValue),
        nightsLost,
      });
    }
  }

  const rooms = [...byRoom.values()].sort((a, b) =>
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  const roomNightsLost = rooms.reduce((total, room) => total + room.nightsLost, 0);
  const numberOfDays = (toExclusive - from) / 86_400_000;
  const roomNightsAvailable = numberValue(result.rows[0]?.[5]) * numberOfDays;
  return successResult({
    hotelId: input.hotelId,
    from: input.from,
    to: input.to,
    roomNightsLost,
    roomNightsAvailable,
    shareLost: roomNightsAvailable === 0 ? 0 : roomNightsLost / roomNightsAvailable,
    byRoom: rooms,
  });
}
