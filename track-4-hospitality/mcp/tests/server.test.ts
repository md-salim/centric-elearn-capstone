import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { loadConfig, LIMITS } from '../src/config.js';
import type { Audit, AuditEntry } from '../src/audit.js';
import type { Db, QueryResult } from '../src/db.js';

// Evidence for this file: MOCKED Db and an in-memory Audit. Nothing here talks to MySQL,
// so nothing here proves SQL, privileges, timeouts or row streaming.

const FIXED_NOW = new Date('2026-03-10T09:00:00.000Z');
const SECRET = 'S3cret-Pw-for-tests-9f2c';
const TOOL_ORDER = [
  'rooms_breaching_sla',
  'ooo_impact_on_occupancy',
  'housekeeper_load',
  'arrivals_without_ready_room',
  'run_readonly_query',
];

const EMPTY: QueryResult = { columns: [], rows: [], truncated: false };

interface Harness {
  client: Client;
  query: ReturnType<typeof vi.fn>;
  currentUser: ReturnType<typeof vi.fn>;
  entries: AuditEntry[];
  record: ReturnType<typeof vi.fn>;
  close: () => Promise<void>;
}

async function start(opts: { audit?: Audit; result?: QueryResult; queryImpl?: () => Promise<QueryResult> } = {}) {
  const query = vi.fn(opts.queryImpl ?? (async () => opts.result ?? EMPTY));
  const currentUser = vi.fn(async () => 'mcp_readonly@%');
  const db: Db = { query, currentUser, close: async () => undefined } as unknown as Db;
  const entries: AuditEntry[] = [];
  const record = vi.fn(async (e: AuditEntry) => {
    entries.push(e);
  });
  const audit: Audit = opts.audit ?? { record };
  const server = createServer({ db, audit, now: () => FIXED_NOW });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const h: Harness = {
    client,
    query,
    currentUser,
    entries,
    record,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
  return h;
}

interface Called {
  isError: boolean;
  text: string;
  structured?: Record<string, unknown>;
}

// A protocol-level rejection (thrown McpError) and a tool-level isError both count as "an error".
async function call(h: Harness, name: string, args: Record<string, unknown>): Promise<Called> {
  try {
    const r = (await h.client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content?: { type: string; text?: string }[];
      structuredContent?: Record<string, unknown>;
    };
    return {
      isError: r.isError === true,
      text: r.content?.[0]?.text ?? '',
      structured: r.structuredContent,
    };
  } catch (e) {
    return { isError: true, text: e instanceof Error ? e.message : String(e) };
  }
}

function payload(c: Called): Record<string, unknown> {
  return c.structured ?? (JSON.parse(c.text) as Record<string, unknown>);
}

const VALID_ARGS: Record<string, Record<string, unknown>> = {
  rooms_breaching_sla: { hotelId: 1, asOf: '2026-03-10T10:46:00Z' },
  ooo_impact_on_occupancy: { hotelId: 1, from: '2026-03-10', to: '2026-03-12' },
  housekeeper_load: { hotelId: 1, date: '2026-03-10' },
  arrivals_without_ready_room: { hotelId: 1, date: '2026-03-10' },
  run_readonly_query: { sql: 'SELECT room_number, status FROM vw_rooms_status' },
};

let h: Harness;
afterEach(async () => {
  vi.restoreAllMocks();
  if (h) await h.close();
});

describe('AC_04 tool list', () => {
  beforeEach(async () => {
    h = await start();
  });

  it('AC_04_ListsExactlyFiveTools', async () => {
    const { tools } = await h.client.listTools();
    expect(tools).toHaveLength(5);
  });

  it('AC_04_ToolsAreInTheStatedOrder', async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOL_ORDER);
  });

  it.each([
    ['rooms_breaching_sla', ['hotelId', 'asOf', 'rooms', 'minutesOver']],
    ['ooo_impact_on_occupancy', ['hotelId', 'from', 'to', 'roomNightsLost', 'byRoom']],
    ['housekeeper_load', ['hotelId', 'date', 'housekeepers', 'outstanding']],
    ['arrivals_without_ready_room', ['hotelId', 'date', 'roomTypes', 'shortfall']],
    ['run_readonly_query', ['sql', 'columns', 'rows', 'rowCount', 'truncated']],
  ])('AC_04_DescriptionStatesInputsAndOutput_%s', async (name, words) => {
    const { tools } = await h.client.listTools();
    const t = tools.find((x) => x.name === name);
    expect(t, `tool ${name} listed`).toBeDefined();
    const d = t?.description ?? '';
    expect(d).toMatch(/input/i);
    expect(d).toMatch(/output/i);
    for (const w of words) expect(d, `description mentions ${w}`).toContain(w);
  });
});

describe('AC_10 bad input never reaches the database', () => {
  beforeEach(async () => {
    h = await start();
  });

  const BAD_HOTELS: [string, unknown][] = [
    ['string', 'abc'],
    ['zero', 0],
    ['negative', -3],
    ['fraction', 1.5],
    ['null', null],
  ];

  it.each(
    ['rooms_breaching_sla', 'ooo_impact_on_occupancy', 'housekeeper_load', 'arrivals_without_ready_room'].flatMap(
      (tool) => BAD_HOTELS.map(([label, v]) => [tool, label, v] as const),
    ),
  )('AC_10_BadHotelId_%s_%s_IsAnErrorAndDbUntouched', async (tool, _label, hotelId) => {
    const r = await call(h, tool, { ...VALID_ARGS[tool], hotelId });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/not implemented/i);
    expect(h.query).not.toHaveBeenCalled();
  });

  it.each([
    ['housekeeper_load', 'date', '10/03/2026'],
    ['housekeeper_load', 'date', 'tomorrow'],
    ['housekeeper_load', 'date', '2026-02-30'],
    ['housekeeper_load', 'date', '2026-13-01'],
    ['arrivals_without_ready_room', 'date', '2026-3-1'],
    ['arrivals_without_ready_room', 'date', '2026-02-30'],
    ['ooo_impact_on_occupancy', 'from', '2026-99-99'],
    ['ooo_impact_on_occupancy', 'from', 'yesterday'],
    ['ooo_impact_on_occupancy', 'to', '2026-02-30'],
    ['ooo_impact_on_occupancy', 'to', '12/03/2026'],
    ['rooms_breaching_sla', 'asOf', 'not-a-time'],
    ['rooms_breaching_sla', 'asOf', '2026-03-10 10:46:00'],
  ])('AC_10_MalformedDate_%s_%s_%s_IsAnErrorAndDbUntouched', async (tool, field, value) => {
    const r = await call(h, tool, { ...VALID_ARGS[tool], [field]: value });
    expect(r.isError).toBe(true);
    // a deliberate rejection, not a crash of an unimplemented handler
    expect(r.text).not.toMatch(/not implemented/i);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('AC_10_RangeEndingBeforeStart_IsAnErrorAndDbUntouched', async () => {
    const r = await call(h, 'ooo_impact_on_occupancy', { hotelId: 1, from: '2026-03-12', to: '2026-03-10' });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/not implemented/i);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('AC_10_ErrorMessageIsPlainNotAStackTrace', async () => {
    const r = await call(h, 'housekeeper_load', { hotelId: 'abc', date: '2026-03-10' });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/\n\s+at\s/);
    expect(r.text).not.toMatch(/not implemented/i);
  });
});

describe('AC_11 run_readonly_query result shape (mock db)', () => {
  it('AC_11_ReturnsColumnsRowsRowCountTruncatedDuration', async () => {
    h = await start({
      result: { columns: ['room_number', 'status'], rows: [['101', 'Ready'], ['102', 'Dirty']], truncated: false },
    });
    const r = await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    expect(r.isError).toBe(false);
    const p = payload(r);
    expect(p.columns).toEqual(['room_number', 'status']);
    expect(p.rows).toEqual([['101', 'Ready'], ['102', 'Dirty']]);
    expect(p.rowCount).toBe(2);
    expect(p.truncated).toBe(false);
    expect(typeof p.durationMs).toBe('number');
    expect(p.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('AC_11_TextContentAndStructuredContentAgree', async () => {
    h = await start({ result: { columns: ['a'], rows: [[1]], truncated: false } });
    const r = await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    expect(r.isError).toBe(false);
    expect(r.structured).toBeDefined();
    expect(JSON.parse(r.text)).toEqual(r.structured);
  });

  it('AC_11_PassesTheSqlToTheDbOnce', async () => {
    h = await start({ result: { columns: ['a'], rows: [[1]], truncated: false } });
    await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.query.mock.calls[0][0]).toBe(VALID_ARGS.run_readonly_query.sql);
  });
});

describe('AC_12 rejected statements never contact the database (mock db)', () => {
  beforeEach(async () => {
    h = await start();
  });

  it.each([
    "INSERT INTO rooms (room_number) VALUES ('1')",
    "UPDATE rooms SET status = 'Ready'",
    'DELETE FROM rooms',
    'DROP TABLE rooms',
    'ALTER TABLE rooms ADD COLUMN x INT',
    'TRUNCATE TABLE rooms',
    'CREATE TABLE t (id INT)',
    "GRANT ALL ON *.* TO 'x'@'%'",
    'CALL do_something()',
    'SET @a = 1',
    'SHOW TABLES',
    'EXPLAIN SELECT * FROM vw_rooms_status',
    'SELECT 1 FROM vw_rooms_status; DROP TABLE rooms',
    'SELECT * FROM rooms',
  ])('AC_12_RejectedAndDbNotCalled_%s', async (sql) => {
    const r = await call(h, 'run_readonly_query', { sql });
    expect(r.isError).toBe(true);
    // a deliberate guard rejection (audited as rejected), not a crash of an unimplemented handler
    expect(r.text).not.toMatch(/not implemented/i);
    expect(h.entries.map((e) => e.outcome)).toEqual(['rejected']);
    expect(h.query).not.toHaveBeenCalled();
    expect(h.currentUser).not.toHaveBeenCalled();
  });

  it('AC_12_RejectionMessageIsTheStatedPlainMessage', async () => {
    const r = await call(h, 'run_readonly_query', { sql: 'DROP TABLE rooms' });
    expect(r.text).toContain('Only a single SELECT on the vw_ views is allowed');
  });
});

describe('AC_19 truncation passthrough (mock db)', () => {
  it('AC_19_TruncatedFlagAndRowCountAreReported', async () => {
    const rows = Array.from({ length: LIMITS.maxRows }, (_, i) => [i]);
    h = await start({ result: { columns: ['n'], rows, truncated: true } });
    const r = await call(h, 'run_readonly_query', {
      sql: 'SELECT a.room_id FROM vw_rooms_status a JOIN vw_rooms_status b ON 1 = 1',
    });
    expect(r.isError).toBe(false);
    const p = payload(r);
    expect(p.truncated).toBe(true);
    expect(p.rowCount).toBe(10_000);
    expect((p.rows as unknown[]).length).toBe(10_000);
  });

  it('AC_19_LimitConstantsAreTenSecondsAndTenThousandRows', () => {
    expect(LIMITS.timeoutMs).toBe(10_000);
    expect(LIMITS.maxRows).toBe(10_000);
  });
});

describe('AC_20 audit (mock db, in-memory audit)', () => {
  it.each(TOOL_ORDER)('AC_20_AcceptedCallWritesExactlyOneEntry_%s', async (tool) => {
    h = await start({ result: { columns: ['a'], rows: [[1]], truncated: false } });
    await call(h, tool, VALID_ARGS[tool]);
    expect(h.entries).toHaveLength(1);
    const e = h.entries[0];
    expect(e.tool).toBe(tool);
    expect(typeof e.ts).toBe('string');
    expect(typeof e.durationMs).toBe('number');
    expect(['ok', 'error']).toContain(e.outcome);
    expect(e.args).toBeDefined();
  });

  it.each(TOOL_ORDER)('AC_20_FailedDbCallWritesExactlyOneErrorEntry_%s', async (tool) => {
    h = await start({
      queryImpl: async () => {
        throw new Error('ER_SOMETHING: raw mysql failure');
      },
    });
    const r = await call(h, tool, VALID_ARGS[tool]);
    expect(r.isError).toBe(true);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0].tool).toBe(tool);
    expect(h.entries[0].outcome).toBe('error');
  });

  it('AC_20_SuccessfulQueryEntryIsOkWithRowCountAndSql', async () => {
    h = await start({ result: { columns: ['a'], rows: [[1], [2], [3]], truncated: false } });
    await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0].outcome).toBe('ok');
    expect(h.entries[0].rowCount).toBe(3);
    expect(h.entries[0].sql).toBe(VALID_ARGS.run_readonly_query.sql);
  });

  it('AC_20_RejectedQueryWritesOneRejectedEntryWithTheSql', async () => {
    h = await start();
    await call(h, 'run_readonly_query', { sql: 'DROP TABLE rooms' });
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0].tool).toBe('run_readonly_query');
    expect(h.entries[0].outcome).toBe('rejected');
    expect(h.entries[0].sql).toBe('DROP TABLE rooms');
  });

  it('AC_20_EntryIsJsonSerialisable', async () => {
    h = await start({ result: { columns: ['a'], rows: [[1]], truncated: false } });
    await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    expect(h.entries).toHaveLength(1);
    expect(() => JSON.parse(JSON.stringify(h.entries[0]))).not.toThrow();
  });

  it('AC_20_NoEntryContainsThePassword', async () => {
    vi.stubEnv('MCP_DB_PASSWORD', SECRET);
    try {
      h = await start({
        queryImpl: async () => {
          throw new Error('ER_ACCESS_DENIED: something went wrong');
        },
      });
      for (const tool of TOOL_ORDER) await call(h, tool, VALID_ARGS[tool]);
      await call(h, 'run_readonly_query', { sql: 'DROP TABLE rooms' });
      expect(h.entries.length).toBeGreaterThanOrEqual(5);
      expect(JSON.stringify(h.entries)).not.toContain(SECRET);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('AC_20_WhenAuditCannotBeWrittenTheCallIsRefused', async () => {
    const audit: Audit = { record: vi.fn(async () => Promise.reject(new Error('disk full'))) };
    h = await start({ audit, result: { columns: ['a'], rows: [[1]], truncated: false } });
    const r = await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    expect(r.isError).toBe(true);
    expect(audit.record).toHaveBeenCalled();
    expect(r.text).not.toMatch(/not implemented/i);
    expect(r.text).not.toContain('"rowCount"');
  });

  // Stronger reading of Q8: the line is written BEFORE the database is contacted. This may
  // conflict with "one line with outcome and duration" and is reported to the owner.
  it('AC_20_WhenAuditCannotBeWrittenTheDbIsNotCalled', async () => {
    const audit: Audit = { record: vi.fn(async () => Promise.reject(new Error('disk full'))) };
    h = await start({ audit, result: { columns: ['a'], rows: [[1]], truncated: false } });
    await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    expect(audit.record).toHaveBeenCalled();
    expect(h.query).not.toHaveBeenCalled();
  });
});

describe('AC_21 stdout carries protocol only', () => {
  it('AC_21_NothingIsWrittenToStdoutDuringToolCalls', async () => {
    h = await start({ result: { columns: ['a'], rows: [[1]], truncated: false } });
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const ok = await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    for (const tool of TOOL_ORDER) await call(h, tool, VALID_ARGS[tool]);
    await call(h, 'run_readonly_query', { sql: 'DROP TABLE rooms' });
    await call(h, 'housekeeper_load', { hotelId: 'abc', date: 'nope' });
    await h.client.listTools();
    const writes = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(ok.isError, 'control: a valid query must succeed so the calls above really ran').toBe(false);
    expect(writes).toEqual([]);
  });

  it('AC_21_NothingIsWrittenToStdoutWhenTheDbFails', async () => {
    h = await start({
      queryImpl: async () => {
        throw new Error('boom');
      },
    });
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await call(h, 'run_readonly_query', VALID_ARGS.run_readonly_query);
    const writes = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(h.entries.map((e) => e.outcome), 'control: the failing call was handled and audited').toEqual(['error']);
    expect(writes).toEqual([]);
  });
});

describe('AC_22 configuration (start-up seam: loadConfig)', () => {
  const ENV = { MCP_DB_PASSWORD: SECRET };

  it('AC_22_MissingPasswordThrowsAClearMessage', () => {
    expect(() => loadConfig({})).toThrow(/MCP_DB_PASSWORD/);
  });

  it('AC_22_EmptyPasswordThrowsAClearMessage', () => {
    expect(() => loadConfig({ MCP_DB_PASSWORD: '' })).toThrow(/MCP_DB_PASSWORD/);
  });

  it('AC_22_ErrorMessageDoesNotEchoAPassword', () => {
    let msg = '';
    try {
      loadConfig({ MCP_DB_PASSWORD: '' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/MCP_DB_PASSWORD/);
    expect(msg).not.toContain(SECRET);
  });

  it('AC_22_DefaultsAreApplied', () => {
    const c = loadConfig(ENV);
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(3306);
    expect(c.database).toBe('larchmont');
    expect(c.user).toBe('mcp_readonly');
    expect(c.password).toBe(SECRET);
    expect(c.auditLogPath).toMatch(/mcp[\\/]logs[\\/]audit\.jsonl$/);
  });

  it('AC_22_OverridesAreRead', () => {
    const c = loadConfig({
      ...ENV,
      MCP_DB_HOST: 'db.example',
      MCP_DB_PORT: '3307',
      MCP_DB_NAME: 'other',
      MCP_DB_USER: 'someone',
      MCP_AUDIT_LOG: '/tmp/a.jsonl',
    });
    expect(c.host).toBe('db.example');
    expect(c.port).toBe(3307);
    expect(c.database).toBe('other');
    expect(c.user).toBe('someone');
    expect(c.auditLogPath).toBe('/tmp/a.jsonl');
  });

  it('AC_22_NonNumericPortThrowsAClearMessage', () => {
    expect(() => loadConfig({ ...ENV, MCP_DB_PORT: 'abc' })).toThrow(/MCP_DB_PORT/);
  });
});
