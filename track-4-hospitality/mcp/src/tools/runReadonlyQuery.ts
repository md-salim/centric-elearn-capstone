import { z } from 'zod';
import type { ToolContext, ToolResult } from './types.js';

export const name = 'run_readonly_query';

export const description =
  'Runs one guarded SELECT against the vw_ views only. Input: sql (string, a single SELECT, no comments). Output JSON: { columns: [string], rows: [[...]], rowCount, truncated, durationMs }; at most 10,000 rows and 10 seconds.';

export const inputSchema = {
  sql: z.string().min(1),
};

export async function handler(
  _input: z.infer<z.ZodObject<typeof inputSchema>>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  throw new Error('not implemented');
}
