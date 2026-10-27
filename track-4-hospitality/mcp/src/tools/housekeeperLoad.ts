import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';

export const name = 'housekeeper_load';

export const description =
  'Workload per housekeeper of a hotel on a date. Input: hotelId (integer), date (YYYY-MM-DD). Output JSON: { hotelId, date, housekeepers: [{ housekeeperId, displayName, floors: [int], assigned, completed, outstanding }] }.';

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
