import { appendFile, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AuditEntry {
  ts: string;
  tool: string;
  args: unknown;
  outcome: 'ok' | 'rejected' | 'error';
  rowCount?: number;
  durationMs: number;
  sql?: string;
  error?: string;
}

export interface Audit {
  record(e: AuditEntry): Promise<void>;
  prepare?(): Promise<void>;
}

/**
 * Appends one JSON line per entry. Rejects when the line cannot be written, so the caller can
 * refuse the call (fail closed). Never writes to stdout.
 */
export function createFileAudit(path: string): Audit {
  let queue: Promise<unknown> = Promise.resolve();
  const write = async (e: AuditEntry): Promise<void> => {
    const line = `${JSON.stringify(e)}\n`;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, line, { encoding: 'utf8', mode: 0o600 });
  };
  return {
    async prepare(): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      const file = await open(path, 'a', 0o600);
      await file.close();
    },
    record(e: AuditEntry): Promise<void> {
      // Serialise writes so lines never interleave; a failure does not poison later writes.
      const run = queue.then(() => write(e));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
