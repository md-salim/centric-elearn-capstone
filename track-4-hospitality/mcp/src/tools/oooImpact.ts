import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';

export const name = 'ooo_impact_on_occupancy';

export const description =
  'Room-nights lost to out-of-order rooms in a date range. Input: hotelId (integer), from (YYYY-MM-DD), to (YYYY-MM-DD). Output JSON: { hotelId, from, to, roomNightsLost, roomNightsAvailable, shareLost, byRoom: [{ roomId, roomNumber, roomType, nightsLost }] }.';

export const inputSchema = {
  hotelId: z.number().int().positive(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

export async function handler(
  _input: z.infer<z.ZodObject<typeof inputSchema>>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  throw new Error('not implemented');
}
