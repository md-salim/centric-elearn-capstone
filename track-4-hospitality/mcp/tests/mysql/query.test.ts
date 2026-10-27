import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as run from '../../src/tools/runReadonlyQuery.js';
import { createFixture, MYSQL_ENABLED, parseResult, SKIP_REASON, type Fixture } from './fixture.js';

// Evidence: real MySQL 8.4, throwaway database. These two tests cover what mocks cannot:
// the server-side timeout and the 10,000 row cap on a real result set.
if (!MYSQL_ENABLED) console.warn(SKIP_REASON);

describe.skipIf(!MYSQL_ENABLED)('MySQL run_readonly_query', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await createFixture();
  }, 60_000);
  afterAll(async () => {
    if (f) await f.drop();
  }, 60_000);

  it('AC_11_RealQueryReturnsColumnsRowsAndCount', async () => {
    const p = parseResult(
      await run.handler(
        { sql: "SELECT room_number, status FROM vw_rooms_status WHERE hotel_id = 1 ORDER BY room_number" },
        f.ctx,
      ),
    );
    expect(p.columns).toEqual(['room_number', 'status']);
    expect(p.rowCount).toBe(5);
    expect(p.truncated).toBe(false);
    expect(p.rows[0]).toEqual(['101', 'Dirty']);
  });

  it('AC_18_SleepFifteenIsStoppedAtAboutTenSeconds', async () => {
    const started = Date.now();
    const r = await run.handler({ sql: 'SELECT SLEEP(15) FROM vw_rooms_status LIMIT 1' }, f.ctx);
    const elapsed = Date.now() - started;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/10 seconds/);
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(13_000);
  }, 25_000);

  it('AC_19_SelfJoinReturnsExactlyTenThousandRowsAndTruncated', async () => {
    const p = parseResult(
      await run.handler(
        { sql: 'SELECT a.room_id, b.room_id AS other FROM vw_rooms_status a JOIN vw_rooms_status b ON 1 = 1' },
        f.ctx,
      ),
    );
    expect(p.rowCount).toBe(10_000);
    expect(p.rows).toHaveLength(10_000);
    expect(p.truncated).toBe(true);
  }, 30_000);

  it('AC_19_AResultUnderTheCapIsNotTruncated', async () => {
    const p = parseResult(await run.handler({ sql: 'SELECT room_id FROM vw_rooms_status' }, f.ctx));
    expect(p.truncated).toBe(false);
    expect(p.rowCount).toBeLessThan(10_000);
  });

  it('AC_16_BaseTableQueryIsRejectedAgainstTheRealDb', async () => {
    const r = await run.handler({ sql: 'SELECT * FROM rooms' }, f.ctx);
    expect(r.isError).toBe(true);
  });
});
