import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';

export const name = 'rooms_breaching_sla';

export const description =
  'Lists rooms of a hotel that are late against their turnaround SLA, worst first. Input: hotelId (integer), asOf (optional UTC ISO 8601 datetime, default now). Output JSON: { hotelId, asOf, rooms: [{ roomId, roomNumber, floor, roomType, status, checkedOutAt, dueAt, slaMinutes, minutesOver }] }, most minutes over first.';

export const inputSchema = {
  hotelId: z.number().int().positive(),
  asOf: z.string().datetime().optional(),
};

export async function handler(
  _input: z.infer<z.ZodObject<typeof inputSchema>>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  throw new Error('not implemented');
}
