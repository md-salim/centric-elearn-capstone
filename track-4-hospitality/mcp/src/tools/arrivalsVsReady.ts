import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';

export const name = 'arrivals_without_ready_room';

export const description =
  'Room types of a hotel with more arrivals on a date than Ready rooms. Input: hotelId (integer), date (YYYY-MM-DD). Output JSON: { hotelId, date, roomTypes: [{ roomTypeCode, roomType, arrivals, readyRooms, shortfall }] }; empty list when none qualify.';

export const inputSchema = {
  hotelId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

export async function handler(
  _input: z.infer<z.ZodObject<typeof inputSchema>>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  throw new Error('not implemented');
}
