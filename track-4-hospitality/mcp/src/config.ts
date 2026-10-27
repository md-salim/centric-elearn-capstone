import { fileURLToPath } from 'node:url';

export const LIMITS = { timeoutMs: 10_000, maxRows: 10_000 } as const;

export const ALLOWED_VIEWS = [
  'vw_rooms_status',
  'vw_sla_breaches',
  'vw_ooo_impact',
  'vw_housekeeper_load',
  'vw_arrivals_vs_ready',
] as const;

export interface Config {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  auditLogPath: string;
}

function nonEmpty(v: string | undefined): string | undefined {
  return v !== undefined && v.trim() !== '' ? v : undefined;
}

/**
 * Reads the configuration from the environment only. The password is required. Error
 * messages name the variable and never contain any value.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const password = env.MCP_DB_PASSWORD;
  if (password === undefined || password === '') {
    throw new Error('MCP_DB_PASSWORD is required: set it in the environment (never in a file).');
  }

  const portText = nonEmpty(env.MCP_DB_PORT) ?? '3306';
  const port = Number(portText);
  if (!/^\d+$/.test(portText.trim()) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MCP_DB_PORT must be a whole number between 1 and 65535.');
  }

  return {
    host: nonEmpty(env.MCP_DB_HOST) ?? '127.0.0.1',
    port,
    database: nonEmpty(env.MCP_DB_NAME) ?? 'larchmont',
    user: nonEmpty(env.MCP_DB_USER) ?? 'mcp_readonly',
    password,
    auditLogPath: nonEmpty(env.MCP_AUDIT_LOG) ?? fileURLToPath(new URL('../logs/audit.jsonl', import.meta.url)),
  };
}
