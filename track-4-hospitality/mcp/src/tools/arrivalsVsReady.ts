import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';
import { auditedQuery, errorResult, numberValue, successResult, validDate } from './support.js';

export const name = 'arrivals_without_ready_room';

export const description =
  'Room types of a hotel with more arrivals on a date than Ready rooms. Input: hotelId (integer), date (YYYY-MM-DD). Output JSON: { hotelId, date, roomTypes: [{ roomTypeCode, roomType, arrivals, readyRooms, shortfall }] }; empty list when none qualify.';

export const inputSchema = {
  hotelId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

export async function handler(
  input: z.infer<z.ZodObject<typeof inputSchema>>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!validDate(input.date)) return errorResult('date must be a valid YYYY-MM-DD date.');

  const sql = `
    SELECT room_type_code, room_type_name, arrivals, ready_rooms
    FROM vw_arrivals_vs_ready
    WHERE hotel_id = ? AND arrival_date = ?
    ORDER BY room_type_code`;
  const { result, error } = await auditedQuery(ctx, name, input, sql, [input.hotelId, input.date]);
  if (error || !result) return errorResult(error ?? 'Query failed.');

  const roomTypes = result.rows.flatMap(([code, nameValue, arrivalsValue, readyValue]) => {
    const arrivals = numberValue(arrivalsValue);
    const readyRooms = numberValue(readyValue);
    const shortfall = arrivals - readyRooms;
    return shortfall > 0
      ? [{ roomTypeCode: String(code), roomType: String(nameValue), arrivals, readyRooms, shortfall }]
      : [];
  });
  return successResult({ hotelId: input.hotelId, date: input.date, roomTypes });
}
