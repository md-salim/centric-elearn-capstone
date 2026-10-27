import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createFileAudit } from './audit.js';
import { createServer } from './server.js';

// stdout carries MCP protocol only; diagnostics go to stderr.
async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const db = createDb(cfg);
  const audit = createFileAudit(cfg.auditLogPath);

  const user = await db.currentUser();
  if (!user.startsWith(`${cfg.user}@`) && user !== cfg.user) {
    console.error(`Refusing to start: connected as "${user}", expected "mcp_readonly".`);
    await db.close();
    process.exit(1);
  }

  const server = createServer({ db, audit, now: () => new Date() });
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  console.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
