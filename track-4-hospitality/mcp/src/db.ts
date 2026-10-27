import type { Config } from './config.js';

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

export function createDb(_cfg: Config): Db {
  const fail = () => Promise.reject(new Error('not implemented'));
  return { query: fail, currentUser: fail, close: fail };
}
