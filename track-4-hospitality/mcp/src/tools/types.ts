import type { Audit } from '../audit.js';
import type { Db } from '../db.js';

export interface ToolContext {
  db: Db;
  audit: Audit;
  now: () => Date;
}

export interface ToolResult {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
}
