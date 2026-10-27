import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';
import { auditedQuery, errorResult, numberValue, sqlDateTime, successResult } from './support.js';

export const name = 'rooms_breaching_sla';

export const description =
  'Lists rooms of a hotel that are late against their turnaround SLA, worst first. Input: hotelId (integer), asOf (optional UTC ISO 8601 datetime, default now). Output JSON: { hotelId, asOf, rooms: [{ roomId, roomNumber, floor, roomType, status, checkedOutAt, dueAt, slaMinutes, minutesOver }] }, most minutes over first.';

export const inputSchema = {
  hotelId: z.number().int().positive(),
  asOf: z.string().datetime().optional(),
};

export async function handler(
  input: z.infer<z.ZodObject<typeof inputSchema>>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const asOf = input.asOf === undefined ? ctx.now() : new Date(input.asOf);
  if (!Number.isFinite(asOf.getTime())) return errorResult('asOf must be a valid ISO 8601 datetime.');

  const sql = `
    SELECT room_id, room_number, floor, room_type_name, status,
           checked_out_at, ready_at, sla_minutes, due_at
    FROM vw_rooms_status
    WHERE hotel_id = ? AND checked_out_at IS NOT NULL
    ORDER BY room_number`;
  const { result, error } = await auditedQuery(ctx, name, input, sql, [input.hotelId]);
  if (error || !result) return errorResult(error ?? 'Query failed.');

  const rooms = result.rows.flatMap((row) => {
    const [roomId, roomNumber, floor, roomType, status, checkedOutAtValue, readyAtValue, slaMinutesValue, dueAtValue] = row;
    const dueAt = sqlDateTime(dueAtValue);
    const checkedOutAt = sqlDateTime(checkedOutAtValue);
    const readyAt = sqlDateTime(readyAtValue);
    if (!dueAt || !checkedOutAt) return [];
    const ready = status === 'Ready';
    const end = ready ? readyAt : asOf;
    if (!end || end.getTime() <= dueAt.getTime()) return [];
    if (ready && readyAt!.getTime() < asOf.getTime() - 24 * 60 * 60 * 1000) return [];
    return [{
      roomId: numberValue(roomId),
      roomNumber: String(roomNumber),
      floor: numberValue(floor),
      roomType: String(roomType),
      status: String(status),
      checkedOutAt: checkedOutAt.toISOString(),
      dueAt: dueAt.toISOString(),
      slaMinutes: numberValue(slaMinutesValue),
      minutesOver: Math.ceil((end.getTime() - dueAt.getTime()) / 60_000),
    }];
  }).sort((a, b) => b.minutesOver - a.minutesOver || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));

  return successResult({ hotelId: input.hotelId, asOf: asOf.toISOString(), rooms });
}
