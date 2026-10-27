import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';
import { auditedQuery, errorResult, numberValue, successResult, validDate } from './support.js';

export const name = 'housekeeper_load';

export const description =
  'Workload per housekeeper of a hotel on a date. Input: hotelId (integer), date (YYYY-MM-DD). Output JSON: { hotelId, date, housekeepers: [{ housekeeperId, displayName, floors: [int], assigned, completed, outstanding }] }.';

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
    SELECT housekeeper_id, display_name, floor, rooms_assigned, rooms_completed
    FROM vw_housekeeper_load
    WHERE hotel_id = ? AND work_date = ?
    ORDER BY housekeeper_id, floor`;
  const { result, error } = await auditedQuery(ctx, name, input, sql, [input.hotelId, input.date]);
  if (error || !result) return errorResult(error ?? 'Query failed.');

  const byHousekeeper = new Map<number, {
    housekeeperId: number;
    displayName: string;
    floors: number[];
    assigned: number;
    completed: number;
  }>();
  for (const [idValue, displayNameValue, floorValue, assignedValue, completedValue] of result.rows) {
    const housekeeperId = numberValue(idValue);
    let housekeeper = byHousekeeper.get(housekeeperId);
    if (!housekeeper) {
      housekeeper = { housekeeperId, displayName: String(displayNameValue), floors: [], assigned: 0, completed: 0 };
      byHousekeeper.set(housekeeperId, housekeeper);
    }
    const floor = numberValue(floorValue);
    if (!housekeeper.floors.includes(floor)) housekeeper.floors.push(floor);
    housekeeper.assigned += numberValue(assignedValue);
    housekeeper.completed += numberValue(completedValue);
  }

  const housekeepers = [...byHousekeeper.values()].map((item) => ({
    ...item,
    floors: item.floors.sort((a, b) => a - b),
    outstanding: item.assigned - item.completed,
  }));
  return successResult({ hotelId: input.hotelId, date: input.date, housekeepers });
}
