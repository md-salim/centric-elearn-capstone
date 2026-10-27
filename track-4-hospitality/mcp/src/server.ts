import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as roomsBreachingSla from './tools/roomsBreachingSla.js';
import * as oooImpact from './tools/oooImpact.js';
import * as housekeeperLoad from './tools/housekeeperLoad.js';
import * as arrivalsVsReady from './tools/arrivalsVsReady.js';
import * as runReadonlyQuery from './tools/runReadonlyQuery.js';
import type { ToolContext } from './tools/types.js';

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'larchmont-mcp', version: '0.1.0' });
  const tools = [roomsBreachingSla, oooImpact, housekeeperLoad, arrivalsVsReady, runReadonlyQuery];
  for (const t of tools) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (input: any) => t.handler(input, ctx)) as any,
    );
  }
  return server;
}
