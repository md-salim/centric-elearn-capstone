import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig, type Config } from '../../src/config.js';
import { createDb, type Db } from '../../src/db.js';
import type { Audit, AuditEntry } from '../../src/audit.js';
import type { ToolContext } from '../../src/tools/types.js';

// Evidence for everything built on this file: a REAL MySQL 8.4 server, a throwaway database
// named larchmont_mcp_test_<random> and a throwaway user. The `larchmont` database and the
// real `mcp_readonly` user are never touched.

export const ADMIN_URL = process.env.MCP_TEST_MYSQL_ADMIN_URL ?? '';
export const MCP_PASSWORD = process.env.MCP_DB_PASSWORD ?? '';
export const MYSQL_ENABLED = ADMIN_URL !== '' && MCP_PASSWORD !== '';
export const SKIP_REASON =
  'MySQL tests skipped: set MCP_TEST_MYSQL_ADMIN_URL (mysql://admin:pw@host:3306) and MCP_DB_PASSWORD, then run `npm run test:mysql`.';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATIONS = join(ROOT, 'backend', 'db', 'migrations');
const DB_SETUP = join(ROOT, 'db-setup');

// V003 and V004 are demo seed data; the fixture seeds its own rows instead.
// V005 only renames a state in existing rows, so there is nothing to rename.
const MIGRATION_FILES = [
  // 'V001__create_schema.sql',
  // 'V002__reference_data.sql',
  // 'V006__housekeeping_columns.sql',
  // 'V007__housekeeping_tables.sql',
];

export const FIXED_NOW = new Date('2026-03-10T10:46:00.000Z');
export const FIXTURE_DATE = '2026-03-10';
export const HOTEL = { sla: 1, ooo: 2, housekeeping: 3, arrivals: 4, filler: 5 } as const;

export const VIEW_COLUMNS: Record<string, string[]> = {
  vw_rooms_status: [
    'hotel_id', 'hotel_code', 'room_id', 'room_number', 'floor', 'room_type_code', 'room_type_name',
    'status', 'self_marked', 'checked_out_at', 'ready_at', 'expected_return_at', 'sla_minutes', 'due_at',
  ],
  vw_ooo_impact: ['hotel_id', 'room_id', 'room_number', 'room_type_code', 'ooo_from', 'ooo_to'],
  vw_housekeeper_load: [
    'hotel_id', 'housekeeper_id', 'display_name', 'work_date', 'floor', 'rooms_assigned', 'rooms_completed',
  ],
  vw_arrivals_vs_ready: [
    'hotel_id', 'room_type_code', 'room_type_name', 'arrival_date', 'arrivals', 'ready_rooms',
  ],
  // vw_sla_breaches: "the vw_rooms_status subset plus minutes_over" - checked as subset + minutes_over.
  vw_sla_breaches: [],
};
export const VIEWS = Object.keys(VIEW_COLUMNS);

export interface Fixture {
  dbName: string;
  user: string;
  cfg: Config;
  admin: mysql.Connection;
  db: Db;
  ctx: ToolContext;
  entries: AuditEntry[];
  /** A raw connection as the throwaway read-only user (for privilege checks). */
  connectAsUser(): Promise<mysql.Connection>;
  drop(): Promise<void>;
}

function readScript(name: string): string {
  const p = join(DB_SETUP, name);
  if (!existsSync(p)) throw new Error(`Missing ${p}: the db-setup scripts must exist before the MySQL tests can run.`);
  return readFileSync(p, 'utf8');
}

function retarget(sql: string, dbName: string, user: string): string {
  // `larchmont_app` is not matched: `_` is a word character, so \b does not match before it.
  return sql.replace(/\blarchmont\b/g, dbName).replace(/\bmcp_readonly\b/g, user);
}

// Executes a mysql-client style script: honours DELIMITER lines (03-create-mcp-user.sql uses them
// for a helper procedure) and runs statement by statement on one connection so @variables persist.
async function runScript(conn: mysql.Connection, script: string): Promise<void> {
  let delimiter = ';';
  let buffer = '';
  for (const line of script.split(/\r?\n/)) {
    const m = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (m && buffer.trim() === '') {
      delimiter = m[1];
      continue;
    }
    if (buffer === '' && (line.trim() === '' || line.trim().startsWith('--'))) continue;
    buffer += `${line}\n`;
    if (buffer.trimEnd().endsWith(delimiter)) {
      const stmt = buffer.trimEnd().slice(0, -delimiter.length).trim();
      buffer = '';
      if (stmt) await conn.query(stmt);
    }
  }
  if (buffer.trim()) await conn.query(buffer.trim());
}

function seedSql(): string {
  const t = (n: string) => n; // readability
  const rooms: string[] = [];
  const room = (
    id: number, hotel: number, type: number, number: string, floor: number, status: string,
    checkedOut: string | null = null, readyAt: string | null = null,
  ) =>
    rooms.push(
      `(${id}, ${hotel}, ${type}, '${t(number)}', ${floor}, '${status}', ${checkedOut ? `'${checkedOut}'` : 'NULL'}, ${readyAt ? `'${readyAt}'` : 'NULL'})`,
    );
  const STD = 1, TWN = 2, SUP = 3, STE = 6;

  // Hotel 1: turnaround. STD target 45, STE target 75 (set by V006).
  room(101, 1, STD, '101', 1, 'Dirty', '2026-03-10 10:00:00');
  room(102, 1, STE, '102', 1, 'Dirty', '2026-03-10 10:00:00');
  room(103, 1, STD, '103', 1, 'Dirty', '2026-03-10 09:00:00');
  room(104, 1, STD, '104', 1, 'Ready', '2026-03-10 08:00:00', '2026-03-10 09:10:00'); // ready 25 min after target
  room(105, 1, STD, '105', 1, 'Ready', '2026-03-10 08:00:00', '2026-03-10 08:30:00'); // ready in time
  // Hotel 2: out of order.
  room(201, 2, STD, '201', 1, 'Ready');
  room(202, 2, STD, '202', 1, 'Ready');
  room(203, 2, STD, '203', 1, 'OutOfOrder');
  room(204, 2, STD, '204', 1, 'Ready');
  room(205, 2, STD, '205', 1, 'Ready');
  // Hotel 3: housekeeping.
  room(301, 3, STD, '301', 1, 'Ready');
  room(302, 3, STD, '302', 1, 'Dirty');
  room(303, 3, STD, '303', 2, 'Ready');
  room(304, 3, STD, '304', 3, 'Ready');
  room(305, 3, STD, '305', 3, 'Dirty');
  // Hotel 4: arrivals vs ready rooms.
  room(401, 4, STD, '401', 1, 'Ready');
  room(402, 4, STD, '402', 1, 'Dirty');
  room(403, 4, TWN, '403', 1, 'Ready');
  room(404, 4, TWN, '404', 1, 'Ready');
  room(405, 4, SUP, '405', 1, 'Ready');
  room(406, 4, SUP, '406', 1, 'Ready');
  // Hotel 5: 100 filler rooms so that vw_rooms_status joined to itself exceeds 10,000 rows.
  for (let i = 0; i < 100; i++) room(501 + i, 5, STD, String(501 + i), 1, 'Ready');

  const booking = (n: number, type: number, checkIn: string, status: string) =>
    `('BK-T${n}', 'Direct', 4, 1, ${type}, 1, '${checkIn}', '2026-03-12', 2, '${status}', 100, '2026-03-01 00:00:00', '2026-03-01 00:00:00')`;

  return `
INSERT INTO guests (id, first_name, last_name, email, phone, address_line, city, postcode, country, region, created_at)
VALUES (1, 'Test', 'Guest', 'test.guest@example.invalid', '000', '1 Test Road', 'Testville', 'T1 1TT', 'GB', 'North', '2026-01-01 00:00:00');

INSERT INTO rooms (id, hotel_id, room_type_id, room_number, floor, status, checked_out_at, ready_at)
VALUES ${rooms.join(',\n')};

INSERT INTO users (id, email, display_name, role, hotel_id, password_hash, phone) VALUES
(901, 'h1@example.invalid', 'Hanna One', 'Housekeeper', 3, 'x', '000'),
(902, 'h2@example.invalid', 'Hugo Two', 'Housekeeper', 3, 'x', '000'),
(903, 'h3@example.invalid', 'Other Hotel Housekeeper', 'Housekeeper', 4, 'x', '000');

INSERT INTO housekeeper_floors (hotel_id, floor, user_id) VALUES (3, 1, 901), (3, 2, 901), (3, 3, 902), (4, 1, 903);

INSERT INTO room_status_history (room_id, from_status, to_status, changed_by_user_id, changed_at) VALUES
-- hotel 2 out-of-order intervals (all on midnight boundaries)
(201, 'Ready', 'OutOfOrder', NULL, '2026-03-08 00:00:00'),
(201, 'OutOfOrder', 'Ready', NULL, '2026-03-11 00:00:00'),
(202, 'Ready', 'OutOfOrder', NULL, '2026-03-11 00:00:00'),
(202, 'OutOfOrder', 'Ready', NULL, '2026-03-13 00:00:00'),
(203, 'Ready', 'OutOfOrder', NULL, '2026-03-12 00:00:00'),
(204, 'Ready', 'OutOfOrder', NULL, '2026-03-01 00:00:00'),
(204, 'OutOfOrder', 'Ready', NULL, '2026-03-05 00:00:00'),
-- hotel 3 completed moves to Ready
(301, 'Cleaning', 'Ready', 901, '2026-03-10 09:30:00'),
(303, 'Cleaning', 'Ready', 901, '2026-03-10 11:00:00'),
(304, 'Cleaning', 'Ready', 902, '2026-03-09 15:00:00'),
-- hotel 4 housekeeper, same day
(401, 'Cleaning', 'Ready', 903, '2026-03-10 09:00:00');

INSERT INTO bookings (reference, channel, hotel_id, guest_id, room_type_id, rate_plan_id, check_in, check_out, adults, status, total_amount, created_at, updated_at)
VALUES
${[
  booking(1, 1, '2026-03-10', 'Confirmed'),
  booking(2, 1, '2026-03-10', 'Confirmed'),
  booking(3, 1, '2026-03-10', 'Confirmed'),
  booking(4, 1, '2026-03-10', 'Cancelled'),
  booking(5, 1, '2026-03-11', 'Confirmed'),
  booking(6, 2, '2026-03-10', 'Confirmed'),
  booking(7, 3, '2026-03-10', 'Confirmed'),
  booking(8, 3, '2026-03-10', 'Confirmed'),
].join(',\n')};
`;
}

export async function createFixture(): Promise<Fixture> {
  const suffix = randomBytes(5).toString('hex');
  const dbName = `larchmont_mcp_test_${suffix}`;
  const user = `mcp_test_${suffix}`;
  const url = new URL(ADMIN_URL);

  const root = await mysql.createConnection({ uri: ADMIN_URL, multipleStatements: true });
  await root.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4`);
  await root.end();

  const admin = await mysql.createConnection({
    uri: ADMIN_URL,
    database: dbName,
    multipleStatements: true,
    dateStrings: true,
  });

  const dropAll = async () => {
    try {
      await admin.query(`DROP USER IF EXISTS '${user}'@'%'`);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await admin.end();
    }
  };

  try {
    for (const f of MIGRATION_FILES) await admin.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
    await admin.query(seedSql());
    await admin.query(retarget(readScript('02-mcp-views.sql'), dbName, user));
    // The wrapper pipes `SET @mcp_pw := <quoted>;` followed by the .sql file. Do the same here.
    await admin.query(
      `SET @mcp_pw := ${mysql.escape(MCP_PASSWORD)};\n${retarget(readScript('03-create-mcp-user.sql'), dbName, user)}`,
    );
  } catch (e) {
    await dropAll();
    throw e;
  }

  const cfg = loadConfig({
    MCP_DB_HOST: url.hostname,
    MCP_DB_PORT: url.port || '3306',
    MCP_DB_NAME: dbName,
    MCP_DB_USER: user,
    MCP_DB_PASSWORD: MCP_PASSWORD,
    MCP_AUDIT_LOG: join(tmpdir(), `${dbName}.jsonl`),
  });
  const db = createDb(cfg);
  const entries: AuditEntry[] = [];
  const audit: Audit = { record: async (e) => void entries.push(e) };

  return {
    dbName,
    user,
    cfg,
    admin,
    db,
    entries,
    ctx: { db, audit, now: () => FIXED_NOW },
    connectAsUser: () =>
      mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        user,
        password: MCP_PASSWORD,
        database: dbName,
      }),
    drop: async () => {
      try {
        await db.close();
      } catch {
        /* the stub or a closed pool may throw; cleanup must continue */
      }
      await dropAll();
    },
  };
}

export function parseResult(r: {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
}): Record<string, any> {
  if (r.isError) throw new Error(`tool returned an error: ${r.content[0]?.text}`);
  return (r.structuredContent ?? JSON.parse(r.content[0].text)) as Record<string, any>;
}
