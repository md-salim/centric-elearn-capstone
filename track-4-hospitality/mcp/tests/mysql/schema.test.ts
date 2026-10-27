import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, MYSQL_ENABLED, SKIP_REASON, VIEWS, VIEW_COLUMNS, type Fixture } from './fixture.js';

// Evidence: real MySQL 8.4, throwaway database and throwaway user. Not run unless
// MCP_TEST_MYSQL_ADMIN_URL and MCP_DB_PASSWORD are set (npm run test:mysql).
if (!MYSQL_ENABLED) console.warn(SKIP_REASON);

const FORBIDDEN = ['email', 'phone', 'address_line', 'postcode', 'password_hash', 'notes', 'reason'];
const DENIED_ERRNO = [1044, 1142, 1143, 1045, 1370, 1356]; // access denied family; 1356 = view invalid for definer

describe.skipIf(!MYSQL_ENABLED)('MySQL schema and privileges', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await createFixture();
  }, 60_000);
  afterAll(async () => {
    if (f) await f.drop();
  }, 60_000);

  async function columnsOf(view: string): Promise<string[]> {
    const [rows] = await f.admin.query(
      'SELECT COLUMN_NAME AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
      [f.dbName, view],
    );
    return (rows as { c: string }[]).map((r) => r.c);
  }

  it.each(Object.entries(VIEW_COLUMNS).filter(([, cols]) => cols.length > 0))(
    'AC_01_ViewColumnsMatchTheContract_%s',
    async (view, expected) => {
      expect(await columnsOf(view)).toEqual(expected);
    },
  );

  it('AC_01_SlaBreachesViewIsASubsetOfRoomsStatusPlusMinutesOver', async () => {
    const cols = await columnsOf('vw_sla_breaches');
    expect(cols).toContain('minutes_over');
    const allowed = new Set([...VIEW_COLUMNS.vw_rooms_status, 'minutes_over']);
    expect(cols.filter((c) => !allowed.has(c))).toEqual([]);
  });

  it.each(VIEWS)('AC_01_NoForbiddenColumn_%s', async (view) => {
    const cols = await columnsOf(view);
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.filter((c) => FORBIDDEN.includes(c))).toEqual([]);
  });

  it('AC_03_ShowGrantsListsOnlySelectOnTheFiveViews', async () => {
    const [rows] = await f.admin.query(`SHOW GRANTS FOR '${f.user}'@'%'`);
    const grants = (rows as Record<string, string>[]).map((r) => Object.values(r)[0]);
    const nonTrivial = grants.filter((g) => !/^GRANT USAGE ON \*\.\* TO /.test(g));
    const targets = nonTrivial.map((g) => {
      const m = /^GRANT SELECT ON `([^`]+)`\.`([^`]+)` TO /.exec(g);
      expect(m, `grant must be a SELECT on one object: ${g}`).not.toBeNull();
      expect(m![1]).toBe(f.dbName);
      return m![2];
    });
    expect([...targets].sort()).toEqual([...VIEWS].sort());
    expect(grants.join('\n')).not.toMatch(/GRANT OPTION|ALL PRIVILEGES|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b/);
  });

  it.each(VIEWS)('AC_03_SelectOnViewIsAllowed_%s', async (view) => {
    const c = await f.connectAsUser();
    try {
      await expect(c.query(`SELECT * FROM \`${view}\` LIMIT 1`)).resolves.toBeDefined();
    } finally {
      await c.end();
    }
  });

  it.each([
    ['rooms', 'SELECT * FROM rooms LIMIT 1'],
    ['users', 'SELECT * FROM users LIMIT 1'],
    ['guests', 'SELECT * FROM guests LIMIT 1'],
    ['mysql.user', 'SELECT * FROM mysql.user LIMIT 1'],
  ])('AC_03_SelectOnBaseTableIsDenied_%s', async (_label, sql) => {
    const c = await f.connectAsUser();
    try {
      await expect(c.query(sql)).rejects.toMatchObject({ errno: expect.toSatisfy((n: number) => DENIED_ERRNO.includes(n)) });
    } finally {
      await c.end();
    }
  });

  it('AC_03_InformationSchemaTablesDoesNotExposeBaseTables', async () => {
    // information_schema is readable by every user but only lists objects the user has a privilege on.
    const c = await f.connectAsUser();
    try {
      const [rows] = await c.query(
        "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('rooms','users','guests')",
        [f.dbName],
      );
      expect(rows as unknown[]).toEqual([]);
    } finally {
      await c.end();
    }
  });

  it.each([
    ['INSERT', "INSERT INTO vw_rooms_status (room_number) VALUES ('x')"],
    ['UPDATE', "UPDATE vw_rooms_status SET status = 'Ready'"],
    ['DELETE', 'DELETE FROM vw_rooms_status'],
    ['DROP', 'DROP VIEW vw_rooms_status'],
  ])('AC_03_%sOnAViewIsDenied', async (_label, sql) => {
    const c = await f.connectAsUser();
    try {
      await expect(c.query(sql)).rejects.toMatchObject({ errno: expect.toSatisfy((n: number) => DENIED_ERRNO.includes(n)) });
    } finally {
      await c.end();
    }
  });
});
