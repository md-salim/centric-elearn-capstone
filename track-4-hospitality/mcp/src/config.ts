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

export function loadConfig(_env: NodeJS.ProcessEnv): Config {
  throw new Error('not implemented');
}
