import { describe, expect, it } from 'vitest';
import { validateSql } from '../src/guard.js';

// Evidence: pure unit tests of the guard, no database. They prove the guard's
// decisions, not what MySQL would do (the privileges are the first line of defence).

function expectRejected(sql: string): void {
  const r = validateSql(sql);
  expect(r.ok, `expected rejection but got ok for: ${sql}`).toBe(false);
  if (!r.ok) {
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
  }
}

function expectAccepted(sql: string): void {
  const r = validateSql(sql);
  expect(r.ok, `expected ok but got ${JSON.stringify(r)} for: ${sql}`).toBe(true);
}

const VIEWS = [
  'vw_rooms_status',
  'vw_sla_breaches',
  'vw_ooo_impact',
  'vw_housekeeper_load',
  'vw_arrivals_vs_ready',
];

describe('guard: AC_12 non-SELECT statements', () => {
  it.each([
    ['INSERT', "INSERT INTO rooms (room_number) VALUES ('1')"],
    ['UPDATE', "UPDATE rooms SET status = 'Ready'"],
    ['DELETE', 'DELETE FROM rooms'],
    ['DROP', 'DROP TABLE rooms'],
    ['ALTER', 'ALTER TABLE rooms ADD COLUMN x INT'],
    ['TRUNCATE', 'TRUNCATE TABLE rooms'],
    ['CREATE', 'CREATE TABLE t (id INT)'],
    ['GRANT', "GRANT ALL ON *.* TO 'x'@'%'"],
    ['CALL', 'CALL do_something()'],
    ['SET', 'SET @a = 1'],
    ['SHOW', 'SHOW TABLES'],
    ['EXPLAIN', 'EXPLAIN SELECT * FROM vw_rooms_status'],
  ])('AC_12_Rejects_%s', (_label, sql) => {
    expectRejected(sql);
  });
});

describe('guard: AC_13 multiple statements', () => {
  it.each([
    ['two selects', 'SELECT 1 FROM vw_rooms_status; SELECT 2 FROM vw_rooms_status'],
    ['trailing drop', 'SELECT 1 FROM vw_rooms_status; DROP TABLE rooms'],
    ['trailing drop with semicolon', 'SELECT 1 FROM vw_rooms_status; DROP TABLE rooms;'],
    ['trailing delete without space', 'SELECT 1 FROM vw_rooms_status;DELETE FROM rooms'],
  ])('AC_13_Rejects_MultiStatement_%s', (_label, sql) => {
    expectRejected(sql);
  });
});

describe('guard: AC_14 comments', () => {
  it.each([
    ['executable comment', 'SELECT /*! 1 */ room_number FROM vw_rooms_status'],
    ['MariaDB executable comment', 'SELECT /*M! 1 */ room_number FROM vw_rooms_status'],
    ['block comment', 'SELECT room_number /* hello */ FROM vw_rooms_status'],
    ['dash dash comment', 'SELECT room_number FROM vw_rooms_status -- trailing'],
    ['dash dash comment mid-query', 'SELECT room_number -- x\nFROM vw_rooms_status'],
    ['hash comment', 'SELECT room_number FROM vw_rooms_status # trailing'],
    ['comment hiding DROP', 'SELECT room_number FROM vw_rooms_status /* ; DROP TABLE rooms */'],
    ['executable comment hiding DROP', 'SELECT room_number FROM vw_rooms_status /*! ; DROP TABLE rooms */'],
    [
      'executable comment hiding a second statement',
      'SELECT 1 FROM vw_rooms_status /*!; SELECT 2 FROM vw_rooms_status */',
    ],
    ['executable comment hiding a table name', 'SELECT room_number FROM vw_rooms_status /*! , rooms */'],
    ['MariaDB comment hiding a table', 'SELECT * FROM vw_rooms_status /*M! JOIN rooms ON 1=1 */'],
    ['hash hiding a drop', 'SELECT room_number FROM vw_rooms_status #; DROP TABLE rooms'],
  ])('AC_14_Rejects_Comment_%s', (_label, sql) => {
    expectRejected(sql);
  });
});

describe('guard: AC_15 INTO, USE, locking, no FROM', () => {
  it.each([
    ['USE larchmont', 'USE larchmont'],
    ['USE mysql', 'USE mysql'],
    ['INTO OUTFILE', "SELECT room_number FROM vw_rooms_status INTO OUTFILE '/tmp/x'"],
    ['INTO DUMPFILE', "SELECT room_number FROM vw_rooms_status INTO DUMPFILE '/tmp/x'"],
    ['INTO @var', 'SELECT room_number INTO @v FROM vw_rooms_status LIMIT 1'],
    ['INTO @var at the end', 'SELECT room_number FROM vw_rooms_status LIMIT 1 INTO @v'],
    ['FOR UPDATE', 'SELECT room_number FROM vw_rooms_status FOR UPDATE'],
    ['LOCK IN SHARE MODE', 'SELECT room_number FROM vw_rooms_status LOCK IN SHARE MODE'],
    ['SELECT without FROM', 'SELECT 1'],
    ['SLEEP without FROM', 'SELECT SLEEP(15)'],
    ['function without FROM', 'SELECT USER()'],
  ])('AC_15_Rejects_%s', (_label, sql) => {
    expectRejected(sql);
  });
});

describe('guard: AC_16 tables other than the five views', () => {
  it.each([
    ['plain table', 'SELECT * FROM rooms'],
    ['users table', 'SELECT email FROM users'],
    ['guests table', 'SELECT * FROM guests'],
    ['join to a table', 'SELECT * FROM vw_rooms_status v JOIN rooms r ON r.id = v.room_id'],
    ['comma join to a table', 'SELECT * FROM vw_rooms_status v, rooms r'],
    ['left join to a table', 'SELECT * FROM vw_rooms_status v LEFT JOIN guests g ON 1 = 1'],
    ['subquery in FROM', 'SELECT * FROM (SELECT * FROM rooms) t'],
    ['subquery in WHERE', 'SELECT * FROM vw_rooms_status WHERE room_id IN (SELECT id FROM rooms)'],
    ['subquery in select list', 'SELECT (SELECT COUNT(*) FROM guests) AS c FROM vw_rooms_status'],
    ['CTE', 'WITH r AS (SELECT * FROM rooms) SELECT * FROM r'],
    ['CTE on a table, outer query on a view', 'WITH r AS (SELECT * FROM users) SELECT * FROM vw_rooms_status'],
    ['UNION with a table', 'SELECT room_id FROM vw_rooms_status UNION SELECT id FROM rooms'],
    ['UNION ALL with a table', 'SELECT room_id FROM vw_rooms_status UNION ALL SELECT id FROM users'],
    ['backticked table', 'SELECT * FROM `rooms`'],
    ['upper-case table', 'SELECT * FROM ROOMS'],
    ['backticked qualified table', 'SELECT * FROM `larchmont`.`rooms`'],
    ['schema-qualified larchmont.rooms', 'SELECT * FROM larchmont.rooms'],
    ['information_schema.tables', 'SELECT * FROM information_schema.tables'],
    ['mysql.user', 'SELECT * FROM mysql.user'],
    ['view name in another schema', 'SELECT * FROM mysql.vw_rooms_status'],
    ['view lookalike suffix', 'SELECT * FROM vw_rooms_status_backup'],
    ['view lookalike prefix', 'SELECT * FROM vw_rooms'],
  ])('AC_16_Rejects_%s', (_label, sql) => {
    expectRejected(sql);
  });
});

describe('guard: AC_17 unparseable SQL fails closed', () => {
  it.each([
    ['gibberish', 'this is not sql'],
    ['truncated', 'SELECT * FROM'],
    ['unbalanced bracket', 'SELECT (1 FROM vw_rooms_status'],
    ['unterminated string', "SELECT * FROM vw_rooms_status WHERE room_number = 'abc"],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['stray punctuation', 'SELECT ))) FROM vw_rooms_status'],
  ])('AC_17_Rejects_Unparseable_%s', (_label, sql) => {
    expectRejected(sql);
  });
});

describe('guard: positive cases (the guard must not be a blanket reject)', () => {
  it.each(VIEWS)('Accepts_PlainSelectOn_%s', (view) => {
    expectAccepted(`SELECT * FROM ${view}`);
  });

  it('Accepts_JoinOfTwoViews', () => {
    expectAccepted(
      'SELECT s.room_number, b.minutes_over FROM vw_rooms_status s JOIN vw_sla_breaches b ON b.room_id = s.room_id',
    );
  });

  it('Accepts_SelfJoinOfVwRoomsStatus', () => {
    expectAccepted('SELECT a.room_id, b.room_id FROM vw_rooms_status a JOIN vw_rooms_status b ON 1 = 1');
  });

  it('Accepts_QualifiedViewName', () => {
    expectAccepted('SELECT room_number FROM larchmont.vw_rooms_status');
  });

  it('Accepts_BacktickedViewName', () => {
    expectAccepted('SELECT room_number FROM `vw_rooms_status`');
  });

  it('Accepts_UpperCaseViewName', () => {
    expectAccepted('SELECT room_number FROM VW_ROOMS_STATUS');
  });

  it('Accepts_WhereGroupOrderLimit', () => {
    expectAccepted(
      'SELECT status, COUNT(*) AS n FROM vw_rooms_status WHERE hotel_id = 1 GROUP BY status ORDER BY n DESC LIMIT 10',
    );
  });

  it('Accepts_UnionOfTwoViews', () => {
    expectAccepted('SELECT room_id FROM vw_rooms_status UNION SELECT room_id FROM vw_sla_breaches');
  });

  it('Accepts_SubqueryOnAView', () => {
    expectAccepted('SELECT * FROM vw_rooms_status WHERE room_id IN (SELECT room_id FROM vw_sla_breaches)');
  });

  it('Accepts_SleepFromAView', () => {
    expectAccepted('SELECT SLEEP(15) FROM vw_rooms_status LIMIT 1');
  });
});
