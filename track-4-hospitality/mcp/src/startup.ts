import type { Config } from './config.js';
import type { Db } from './db.js';

const REQUIRED_USER = 'mcp_readonly';

/**
 * Start-up check: the server may only run as the read-only account. Throws a clear error
 * (without any secret) when the configured or the actual database user is anything else.
 */
export async function assertReadonlyUser(db: Pick<Db, 'currentUser'>, cfg: Pick<Config, 'user'>): Promise<void> {
  if (cfg.user !== REQUIRED_USER) {
    throw new Error(`Refusing to start: MCP_DB_USER is "${cfg.user}", it must be "${REQUIRED_USER}".`);
  }
  const current = await db.currentUser();
  const at = current.lastIndexOf('@');
  const userPart = at >= 0 ? current.slice(0, at) : current;
  if (userPart !== cfg.user) {
    throw new Error(`Refusing to start: connected as "${current}", expected "${REQUIRED_USER}".`);
  }
}
