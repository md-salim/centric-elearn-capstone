import type { AuditEntry } from '../audit.js';
import { toDbError, type QueryResult } from '../db.js';
import type { ToolContext, ToolResult } from './types.js';

export function successResult(value: Record<string, unknown>): ToolResult {
  const text = JSON.stringify(value);
  return { content: [{ type: 'text', text }], structuredContent: value };
}

export function errorResult(message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function sqlDateTime(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const parsed = new Date(`${value.replace(' ', 'T')}${/[zZ]|[+-]\d\d:\d\d$/.test(value) ? '' : 'Z'}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function auditedQuery(
  ctx: ToolContext,
  tool: string,
  args: unknown,
  sql: string,
  params: unknown[],
): Promise<{ result?: QueryResult; durationMs: number; error?: string }> {
  const started = Date.now();
  const entry: AuditEntry = {
    ts: ctx.now().toISOString(),
    tool,
    args,
    outcome: 'ok',
    durationMs: 0,
    sql,
  };
  const prepareAudit = typeof ctx.audit.prepare === 'function';
  try {
    if (prepareAudit) await ctx.audit.prepare!();
    else await ctx.audit.record(entry);
  } catch {
    return { durationMs: 0, error: 'Audit log unavailable; the query was not run.' };
  }

  let result: QueryResult;
  try {
    result = await ctx.db.query(sql, params);
  } catch (error) {
    const durationMs = Date.now() - started;
    const safeError = toDbError(error).message;
    entry.ts = ctx.now().toISOString();
    entry.outcome = 'error';
    entry.durationMs = durationMs;
    entry.error = safeError;
    if (prepareAudit) {
      try {
        await ctx.audit.record(entry);
      } catch {
        return { durationMs, error: 'Audit log unavailable; the query failed.' };
      }
    }
    return { durationMs, error: safeError };
  }

  const durationMs = Date.now() - started;
  entry.ts = ctx.now().toISOString();
  entry.rowCount = result.rows.length;
  entry.durationMs = durationMs;
  if (prepareAudit) {
    try {
      await ctx.audit.record(entry);
    } catch {
      return { durationMs, error: 'Audit log unavailable; the query result was withheld.' };
    }
  }
  return { result, durationMs };
}
