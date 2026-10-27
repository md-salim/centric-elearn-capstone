import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createFileAudit } from './audit.js';
import { createServer } from './server.js';
import { assertReadonlyUser } from './startup.js';

// stdout carries MCP protocol only; diagnostics go to stderr.
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const cfg = loadConfig(env);
  const db = createDb(cfg);
  try {
    await assertReadonlyUser(db, cfg);
  } catch (err) {
    await db.close().catch(() => undefined);
    throw err;
  }
  const audit = createFileAudit(cfg.auditLogPath);
  const server = createServer({ db, audit, now: () => new Date() });
  await server.connect(new StdioServerTransport());
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    console.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
