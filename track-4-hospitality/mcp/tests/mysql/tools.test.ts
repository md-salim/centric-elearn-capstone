import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as sla from '../../src/tools/roomsBreachingSla.js';
import * as ooo from '../../src/tools/oooImpact.js';
import * as load from '../../src/tools/housekeeperLoad.js';
import * as arrivals from '../../src/tools/arrivalsVsReady.js';
import {
  createFixture,
  FIXTURE_DATE,
  HOTEL,
  MYSQL_ENABLED,
  parseResult,
  SKIP_REASON,
  type Fixture,
} from './fixture.js';

// Evidence: real MySQL 8.4, throwaway database. Dates are fixed (2026-03-10); every call that takes a
// clock gets it explicitly (asOf) or through ctx.now, so no test depends on the current time or order.
if (!MYSQL_ENABLED) console.warn(SKIP_REASON);

describe.skipIf(!MYSQL_ENABLED)('MySQL named tools', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await createFixture();
  }, 60_000);
  afterAll(async () => {
    if (f) await f.drop();
  }, 60_000);

  const rooms = async (asOf: string) => {
    const p = parseResult(await sla.handler({ hotelId: HOTEL.sla, asOf }, f.ctx));
    return p.rooms as { roomNumber: string; minutesOver: number; roomType: string }[];
  };
  const find = (list: { roomNumber: string }[], n: string) => list.find((r) => r.roomNumber === n);

  // Fixture: 101 Standard and 102 Suite both checked out 10:00. Targets 45 and 75 minutes.
  it.each([
    ['AC_05_StandardNotLateExactlyOnTarget', '2026-03-10T10:45:00Z', '101', undefined],
    ['AC_05_StandardLateOneMinuteAfterTarget', '2026-03-10T10:46:00Z', '101', 1],
    ['AC_05_SuiteNotLateExactlyOnTarget', '2026-03-10T11:15:00Z', '102', undefined],
    ['AC_05_SuiteLateOneMinuteAfterTarget', '2026-03-10T11:16:00Z', '102', 1],
  ])('%s', async (_name, asOf, roomNumber, expected) => {
    const r = find(await rooms(asOf), roomNumber);
    if (expected === undefined) expect(r).toBeUndefined();
    else expect(r?.minutesOver).toBe(expected);
  });

  it('AC_05_PartialMinuteRoundsUp', async () => {
    // 45:01 past a 45 minute target is 1 (Turnaround.MinutesOver rounds up).
    expect(find(await rooms('2026-03-10T10:45:01Z'), '101')?.minutesOver).toBe(1);
  });

  it('AC_05_ResultsAreWorstFirst', async () => {
    // At 11:00: 103 is 75 over, 104 (Ready late) 25 over, 101 15 over; 102 is not yet late.
    const list = await rooms('2026-03-10T11:00:00Z');
    expect(list.map((r) => r.roomNumber)).toEqual(['103', '104', '101']);
    expect(list.map((r) => r.minutesOver)).toEqual([75, 25, 15]);
  });

  it('AC_05_ReportsAsOfAndHotel', async () => {
    const p = parseResult(await sla.handler({ hotelId: HOTEL.sla, asOf: '2026-03-10T10:46:00Z' }, f.ctx));
    expect(p.hotelId).toBe(HOTEL.sla);
    expect(new Date(p.asOf as string).toISOString()).toBe('2026-03-10T10:46:00.000Z');
  });

  it('AC_05_OtherHotelsRoomsAreNotListed', async () => {
    const list = await rooms('2026-03-10T11:00:00Z');
    expect(list.every((r) => ['101', '102', '103', '104', '105'].includes(r.roomNumber))).toBe(true);
  });

  it('AC_06_OmittedAsOfUsesCurrentTimeAndListsLateRooms', async () => {
    // The fixture rooms went late in March 2026, so they are late at any later "now"; no clock is asserted.
    const p = parseResult(await sla.handler({ hotelId: HOTEL.sla }, f.ctx));
    expect(Number.isNaN(Date.parse(p.asOf as string))).toBe(false);
    const list = p.rooms as { roomNumber: string; minutesOver: number }[];
    expect(find(list, '101')?.minutesOver).toBeGreaterThanOrEqual(1);
    expect(find(list, '105')).toBeUndefined();
  });

  it('AC_06_ReadyRoomAfterTargetIsListedWithMinutesOver', async () => {
    // 104: checked out 08:00, due 08:45, Ready at 09:10 -> 25 over, whatever asOf is.
    expect(find(await rooms('2026-03-10T12:00:00Z'), '104')?.minutesOver).toBe(25);
  });

  it('AC_06_ReadyRoomWithinTargetIsNotListed', async () => {
    expect(find(await rooms('2026-03-10T12:00:00Z'), '105')).toBeUndefined();
  });

  // Fixture (hotel 2), range 2026-03-10..2026-03-12 inclusive, intervals on midnight boundaries:
  //  201 OOO 03-08 00:00 -> 03-11 00:00 starts before `from`: night of 10th only = 1
  //  202 OOO 03-11 00:00 -> 03-13 00:00: nights 11th, 12th = 2
  //  203 OOO from 03-12 00:00, still open: night of 12th = 1
  //  204 OOO 03-01 -> 03-05, outside the range = 0.  Total 4.
  it('AC_07_RoomNightsLostEqualsHandComputedTotal', async () => {
    const p = parseResult(
      await ooo.handler({ hotelId: HOTEL.ooo, from: '2026-03-10', to: '2026-03-12' }, f.ctx),
    );
    expect(p.roomNightsLost).toBe(4);
  });

  it.each([
    ['201', 1],
    ['202', 2],
    ['203', 1],
  ])('AC_07_NightsLostForRoom_%s', async (roomNumber, expected) => {
    const p = parseResult(
      await ooo.handler({ hotelId: HOTEL.ooo, from: '2026-03-10', to: '2026-03-12' }, f.ctx),
    );
    const row = (p.byRoom as { roomNumber: string; nightsLost: number }[]).find((r) => r.roomNumber === roomNumber);
    expect(row?.nightsLost).toBe(expected);
  });

  it('AC_07_IntervalOutsideTheRangeCountsNothing', async () => {
    const p = parseResult(
      await ooo.handler({ hotelId: HOTEL.ooo, from: '2026-03-10', to: '2026-03-12' }, f.ctx),
    );
    const row = (p.byRoom as { roomNumber: string; nightsLost: number }[]).find((r) => r.roomNumber === '204');
    expect(row?.nightsLost ?? 0).toBe(0);
  });

  it('AC_07_ByRoomSumsToTotal', async () => {
    const p = parseResult(
      await ooo.handler({ hotelId: HOTEL.ooo, from: '2026-03-10', to: '2026-03-12' }, f.ctx),
    );
    const sum = (p.byRoom as { nightsLost: number }[]).reduce((a, r) => a + r.nightsLost, 0);
    expect(sum).toBe(p.roomNightsLost);
  });

  it('AC_07_ShareLostIsLostOverAvailable', async () => {
    const p = parseResult(
      await ooo.handler({ hotelId: HOTEL.ooo, from: '2026-03-10', to: '2026-03-12' }, f.ctx),
    );
    expect(p.roomNightsAvailable).toBeGreaterThan(0);
    expect(p.shareLost).toBeCloseTo((p.roomNightsLost as number) / (p.roomNightsAvailable as number), 3);
  });

  it('AC_07_OtherHotelsRoomsAreNotCounted', async () => {
    const p = parseResult(
      await ooo.handler({ hotelId: HOTEL.sla, from: '2026-03-10', to: '2026-03-12' }, f.ctx),
    );
    expect(p.roomNightsLost).toBe(0);
  });

  // Fixture (hotel 3): H1 holds floors 1 and 2 (rooms 301, 302, 303), H2 floor 3 (304, 305).
  // On 2026-03-10 H1 moved 301 and 303 to Ready; H2 moved 304 to Ready on the 9th (not the 10th).
  // Hotel 4 has its own housekeeper, who must not appear.
  const loadFor = async () =>
    (parseResult(await load.handler({ hotelId: HOTEL.housekeeping, date: FIXTURE_DATE }, f.ctx))
      .housekeepers as {
      housekeeperId: number;
      displayName: string;
      floors: number[];
      assigned: number;
      completed: number;
      outstanding: number;
    }[]);

  it('AC_08_EachHousekeeperOfTheHotelAppears', async () => {
    const hk = await loadFor();
    expect(hk.map((h) => h.housekeeperId).sort()).toEqual([901, 902]);
  });

  it('AC_08_NoHousekeeperOfAnotherHotelAppears', async () => {
    const hk = await loadFor();
    expect(hk.find((h) => h.housekeeperId === 903)).toBeUndefined();
  });

  it.each([
    [901, [1, 2], 3, 2, 1],
    [902, [3], 2, 0, 2],
  ])('AC_08_Counts_Housekeeper%i', async (id, floors, assigned, completed, outstanding) => {
    const h = (await loadFor()).find((x) => x.housekeeperId === id);
    expect(h).toBeDefined();
    expect([...h!.floors].sort()).toEqual(floors);
    expect(h!.assigned).toBe(assigned);
    expect(h!.completed).toBe(completed);
    expect(h!.outstanding).toBe(outstanding);
  });

  it('AC_08_DisplayNameIsReturned', async () => {
    expect((await loadFor()).find((x) => x.housekeeperId === 901)?.displayName).toBe('Hanna One');
  });

  // Fixture (hotel 4), arrivals on 2026-03-10 (Confirmed only counts; a Cancelled and a next-day booking exist):
  //  Standard: 3 arrivals, 1 Ready room -> shortfall 2.  Twin: 1 arrival, 2 Ready.  Superior: 2 arrivals, 2 Ready.
  // ctx.now is 2026-03-10, so the date is "today" under either reading of the open question (Q7).
  const arrivalsFor = async (hotelId: number) =>
    (parseResult(await arrivals.handler({ hotelId, date: FIXTURE_DATE }, f.ctx)).roomTypes as {
      roomTypeCode: string;
      arrivals: number;
      readyRooms: number;
      shortfall: number;
    }[]);

  it('AC_09_OnlyRoomTypesWithFewerReadyRoomsThanArrivalsAreReturned', async () => {
    const list = await arrivalsFor(HOTEL.arrivals);
    expect(list.map((r) => r.roomTypeCode)).toEqual(['STD']);
  });

  it('AC_09_ShortfallIsArrivalsMinusReadyRooms', async () => {
    const [std] = await arrivalsFor(HOTEL.arrivals);
    expect(std.arrivals).toBe(3);
    expect(std.readyRooms).toBe(1);
    expect(std.shortfall).toBe(2);
  });

  it('AC_09_EmptyListWhenNoRoomTypeQualifies', async () => {
    expect(await arrivalsFor(HOTEL.sla)).toEqual([]);
  });
});
