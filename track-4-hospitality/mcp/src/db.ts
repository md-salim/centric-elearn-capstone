import mysql from 'mysql2/promise';
import { createConnection } from 'mysql2';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { LIMITS, type Config } from './config.js';

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

export interface Db {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  currentUser(): Promise<string>;
  close(): Promise<void>;
}

/** An error whose message is safe to show to a client (no raw MySQL text, no stack). */
export class DbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbError';
  }
}

export const TIMEOUT_MESSAGE = `Query exceeded ${LIMITS.timeoutMs / 1000} seconds`;

const MAX_EXECUTION_TIME_ERRNO = 3024; // ER_QUERY_TIMEOUT
const QUERY_INTERRUPTED_ERRNO = 1317; // ER_QUERY_INTERRUPTED (after our own KILL QUERY)

function errInfo(err: unknown): { errno?: number; code?: string } {
  if (typeof err === 'object' && err !== null) {
    const e = err as { errno?: unknown; code?: unknown };
    return {
      errno: typeof e.errno === 'number' ? e.errno : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
    };
  }
  return {};
}

/** Maps any driver error to a short, plain message. */
export function toDbError(err: unknown): DbError {
  if (err instanceof DbError) return err;
  const { errno, code } = errInfo(err);
  if (errno === MAX_EXECUTION_TIME_ERRNO || code === 'ER_QUERY_TIMEOUT') return new DbError(TIMEOUT_MESSAGE);
  if (errno === 1045 || code === 'ER_ACCESS_DENIED_ERROR') return new DbError('Database login was refused');
  if (errno === 1142 || errno === 1143 || errno === 1044 || errno === 1370 || errno === 1449) {
    return new DbError('Access to that object is not allowed');
  }
  if (errno === 1054 || errno === 1064 || errno === 1146 || errno === 1052 || errno === 1109) {
    return new DbError('The query is not valid for the available views');
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ECONNRESET' ||
    errno === 1040
  ) {
    return new DbError('Database unavailable');
  }
  return new DbError('Query failed');
}

function normaliseValue(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v;
}

export function createDb(cfg: Config): Db {
  const pool: Pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: 3, // MAX_USER_CONNECTIONS is suggested as 5; KILL uses one more short-lived connection
    waitForConnections: true,
    multipleStatements: false,
    dateStrings: true,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectTimeout: 10_000,
    charset: 'utf8mb4',
  });
  const prepared = new WeakSet<object>();

  async function acquire(): Promise<PoolConnection> {
    const conn = await pool.getConnection();
    try {
      if (!prepared.has(conn.connection)) {
        await conn.query('SET SESSION TRANSACTION READ ONLY');
        await conn.query(`SET SESSION max_execution_time = ${LIMITS.timeoutMs}`);
        prepared.add(conn.connection);
      }
      return conn;
    } catch (e) {
      conn.destroy();
      throw e;
    }
  }

  // KILL QUERY on a separate, short-lived connection so it cannot queue behind the running query.
  function killQuery(threadId: number): void {
    if (!Number.isInteger(threadId) || threadId <= 0) return;
    try {
      const killer = createConnection({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
        connectTimeout: 5_000,
      });
      killer.on('error', () => undefined);
      killer.query(`KILL QUERY ${threadId}`, () => killer.destroy());
    } catch {
      /* best effort: the server-side max_execution_time is the other limit */
    }
  }

  async function query(sql: string, params?: unknown[]): Promise<QueryResult> {
    let conn: PoolConnection;
    try {
      conn = await acquire();
    } catch (e) {
      throw toDbError(e);
    }
    const core = conn.connection as unknown as {
      threadId: number;
      query(opts: object): {
        stream(opts?: object): NodeJS.ReadableStream & { destroy(): void };
        on(ev: 'fields', cb: (f: { name: string }[]) => void): unknown;
      };
      destroy(): void;
    };
    const threadId = core.threadId;
    const startedAt = Date.now();

    return new Promise<QueryResult>((resolve, reject) => {
      const rows: unknown[][] = [];
      let columns: string[] = [];
      let truncated = false;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      // Normal end: connection goes back to the pool. Any abort: connection is destroyed.
      const settle = (outcome: { ok: QueryResult } | { err: DbError }, discard: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (discard) {
          try {
            core.destroy();
          } catch {
            /* already gone */
          }
        } else {
          conn.release();
        }
        if ('ok' in outcome) resolve(outcome.ok);
        else reject(outcome.err);
      };

      const q = core.query({ sql, values: params, rowsAsArray: true });
      q.on('fields', (f) => {
        columns = f.map((c) => c.name);
      });
      const stream = q.stream({ highWaterMark: 1024 });

      // Backstop for the server-side max_execution_time (which may not stop every statement).
      timer = setTimeout(() => {
        killQuery(threadId);
        stream.destroy();
        settle({ err: new DbError(TIMEOUT_MESSAGE) }, true);
      }, LIMITS.timeoutMs + 500);

      stream.on('data', (row: unknown) => {
        if (settled) return;
        if (rows.length >= LIMITS.maxRows) {
          // Row maxRows+1 arrived: stop, report exactly maxRows rows.
          truncated = true;
          killQuery(threadId);
          stream.destroy();
          settle({ ok: { columns, rows, truncated } }, true);
          return;
        }
        const arr = Array.isArray(row) ? row : [row];
        rows.push(arr.map(normaliseValue));
      });
      stream.on('error', (err: unknown) => {
        if (settled) return;
        const { errno } = errInfo(err);
        killQuery(threadId);
        settle({ err: errno === QUERY_INTERRUPTED_ERRNO ? new DbError(TIMEOUT_MESSAGE) : toDbError(err) }, true);
      });
      stream.on('end', () => {
        // A statement that ran for the whole limit is reported as a timeout even if the server
        // returned early (for example SLEEP interrupted by max_execution_time returns 1).
        if (Date.now() - startedAt >= LIMITS.timeoutMs) {
          settle({ err: new DbError(TIMEOUT_MESSAGE) }, false);
        } else {
          settle({ ok: { columns, rows, truncated } }, false);
        }
      });
    });
  }

  return {
    query,
    async currentUser(): Promise<string> {
      try {
        const [rows] = await pool.query({ sql: 'SELECT CURRENT_USER()', rowsAsArray: true });
        const first = (rows as unknown[][])[0]?.[0];
        return String(first ?? '');
      } catch (e) {
        throw toDbError(e);
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
