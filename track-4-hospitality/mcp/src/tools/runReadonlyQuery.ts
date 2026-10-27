import { z } from 'zod';
import { validateSql } from '../guard.js';
import type { AuditEntry } from '../audit.js';
import { LIMITS } from '../config.js';
import type { ToolContext, ToolResult } from './types.js';
import { auditedQuery, errorResult, successResult } from './support.js';

export const name = 'run_readonly_query';

export const description =
  'Runs one guarded SELECT against the vw_ views only. Input: sql (string, a single SELECT, no comments). Output JSON: { columns: [string], rows: [[...]], rowCount, truncated, durationMs }; at most 10,000 rows and 10 seconds.';

export const inputSchema = {
  sql: z.string().min(1),
};

export async function handler(
  input: z.infer<z.ZodObject<typeof inputSchema>>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const checked = validateSql(input.sql);
  if (!checked.ok) {
    try {
      const entry: AuditEntry = {
        ts: ctx.now().toISOString(),
        tool: name,
        args: input,
        outcome: 'rejected',
        durationMs: 0,
        sql: input.sql,
        error: checked.reason,
      };
      await ctx.audit.record(entry);
    } catch {
      return errorResult('Audit log unavailable; the query was rejected.');
    }
    return errorResult('Only a single SELECT on the vw_ views is allowed.');
  }

  const { result, durationMs, error } = await auditedQuery(ctx, name, input, input.sql, []);
  if (error || !result) return errorResult(error ?? 'Query failed.');

  return successResult({
    columns: result.columns,
    rows: result.rows.slice(0, LIMITS.maxRows),
    rowCount: result.rows.length,
    truncated: result.truncated,
    durationMs,
  });
}
