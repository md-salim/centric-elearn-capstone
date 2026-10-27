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
}

export function createFileAudit(_path: string): Audit {
  return {
    record: () => Promise.reject(new Error('not implemented')),
  };
}
