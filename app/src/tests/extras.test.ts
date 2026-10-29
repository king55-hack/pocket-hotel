import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureHotel } from "../db";
import { addRoom } from "../actions";
import { checkBackup, cleanBooking, exportAll, importBookingsCsv, restoreBackup } from "../backup";
import { csvSafe, parseCsv } from "../csv";
import { payroll } from "../lib/payroll";
import { suggest } from "../lib/suggest";
import { clockIn, clockOut, endBreak, startBreak, workedMs, breaksMs } from "../shifts";
import type { Attendance, Booking, PayRec, Room, Shift } from "../lib/types";

vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));
const HR = 3600000;

beforeEach(async () => {
  await Promise.all([db.rooms.clear(), db.bookings.clear(), db.orders.clear(), db.hotel.clear(), db.audit.clear(), db.shifts.clear(), db.attendance.clear(), db.pay.clear()]);
  await ensureHotel();
  await addRoom({ n: "101", type: "Double", floor: 1, beds: 2, price: 2500 });
  await addRoom({ n: "102", type: "Double", floor: 1, beds: 2, price: 2500 });
});

describe("breaks", () => {
  const who = { uid: "u1", name: "Sita" };
  it("a break is taken off the working time and is not paid", async () => {
    const t0 = new Date(2026, 9, 20, 8, 0).getTime();
    await clockIn(who, t0);
    expect(await startBreak("u1", t0 + 4 * HR)).toBe("ok");
    expect(await startBreak("u1", t0 + 4 * HR + 1000)).toBe("already");
    expect(await endBreak("u1", t0 + 5 * HR)).toBe("ok");
    expect(await endBreak("u1", t0 + 5 * HR)).toBe("none");
    await clockOut("u1", t0 + 9 * HR);
    const a = (await db.attendance.get("u1:2026-10-20"))!;
    expect(workedMs(a)).toBe(8 * HR);
    expect(breaksMs(a)).toBe(HR);
  });
  it("leaving while on a break closes the break; no break without clocking in", async () => {
    expect(await startBreak("nobody")).toBe("none");
    const t0 = new Date(2026, 9, 20, 8, 0).getTime();
    await clockIn(who, t0);
    await startBreak("u1", t0 + 2 * HR);
    await clockOut("u1", t0 + 3 * HR);
    const a = (await db.attendance.get("u1:2026-10-20"))!;
    expect(a.punches[0].breaks![0].e).toBe(t0 + 3 * HR);
    expect(workedMs(a)).toBe(2 * HR);
  });
});

describe("salary", () => {
  const tpl = [{ id: "s1", name: "Morning", start: "06:00", end: "14:00" }];
  const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;
  const att = (d: number, from: number, hours: number, brk = 0): Attendance => {
    const t = new Date(2026, 9, d, from, 0).getTime();
    return { id: `u1:${day(d)}`, uid: "u1", name: "Sita", day: day(d), punches: [{ in: t, out: t + hours * HR, ...(brk ? { breaks: [{ s: t + 3 * HR, e: t + (3 + brk) * HR }] } : {}) }] };
  };
  const sh = (d: number): Shift => ({ id: `u1:${day(d)}`, uid: "u1", name: "Sita", day: day(d), tpl: "s1" });
  const rec = (over: Partial<PayRec>): PayRec => ({ id: "u1", uid: "u1", name: "Sita", mode: "monthly", rate: 31000, adj: [], ...over });

  it("hourly: pays the hours worked, breaks excluded", () => {
    const r = payroll(rec({ mode: "hourly", rate: 100 }), [att(1, 8, 8, 1), att(2, 8, 4)], [], tpl, "2026-10", "2026-10-30");
    expect(r.hours).toBe(11);
    expect(r.gross).toBe(1100);
    expect(r.present).toBe(2);
  });
  it("daily: pays the days that were worked", () => {
    const r = payroll(rec({ mode: "daily", rate: 800 }), [att(1, 8, 8), att(2, 8, 8), att(3, 8, 0)], [], tpl, "2026-10", "2026-10-30");
    expect(r.present).toBe(2);
    expect(r.gross).toBe(1600);
  });
  it("monthly: one day's share is cut for each planned day that was missed (31 days: 1000 a day)", () => {
    const r = payroll(rec({}), [att(1, 6, 8)], [sh(1), sh(2), sh(3)], tpl, "2026-10", "2026-10-30");
    expect(r.absent).toBe(2);
    expect(r.gross).toBe(29000);
  });
  it("a day that is still to come is not counted as missed", () => {
    const r = payroll(rec({}), [], [sh(25), sh(26)], tpl, "2026-10", "2026-10-20");
    expect(r.absent).toBe(0);
    expect(r.gross).toBe(31000);
  });
  it("bonus and deduction are applied for that month only, and pay never goes below zero", () => {
    const adj = [{ month: "2026-10", bonus: 500, deduct: 2000, note: "advance" }, { month: "2026-09", bonus: 99999, deduct: 0, note: "old" }];
    expect(payroll(rec({ adj }), [], [], tpl, "2026-10", "2026-10-30").net).toBe(29500);
    expect(payroll(rec({ mode: "daily", rate: 100, adj: [{ month: "2026-10", bonus: 0, deduct: 5000, note: "" }] }), [att(1, 8, 8)], [], tpl, "2026-10", "2026-10-30").net).toBe(0);
  });
  it("late arrivals are counted (more than 10 minutes)", () => {
    const a = att(1, 6, 8);
    a.punches[0].in += 25 * 60000;
    expect(payroll(rec({}), [a, att(2, 6, 8)], [sh(1), sh(2)], tpl, "2026-10", "2026-10-30").late).toBe(1);
  });
});

describe("smart staffing suggestion", () => {
  const rooms: Room[] = Array.from({ length: 10 }, (_, i) => ({ n: String(100 + i), type: "Double", floor: 1, beds: 2, price: 2500, st: "free" as const }));
  const bk = (room: string, from: string, nights: number, status: Booking["status"] = "booked"): Booking => ({ id: room + from, room, from, nights, guest: "G", phone: "", src: "Phone", status, payments: [], food: [], extra: 0, createdAt: 1, updatedAt: 1 });
  it("many bookings = busy, none = quiet, and the staff needed follows the rooms in use", () => {
    const bookings = rooms.slice(0, 9).map((r) => bk(r.n, "2026-10-22", 1));
    const t = suggest(bookings, rooms, [], 5, 4, "2026-10-20");
    expect(t[2].level).toBe("busy");
    expect(t[2].need).toBe(3); // 9 rooms / 4 per staff
    expect(t[0].level).toBe("quiet");
    expect(t[0].need).toBe(1);
  });
  it("compares with the staff already planned", () => {
    const bookings = rooms.slice(0, 9).map((r) => bk(r.n, "2026-10-22", 1));
    const shifts: Shift[] = [{ id: "a:2026-10-22", uid: "a", name: "A", day: "2026-10-22", tpl: "s1" }];
    expect(suggest(bookings, rooms, shifts, 5, 4, "2026-10-20")[2].planned).toBe(1);
  });
  it("far-off days use the usual weekday pattern, because few bookings exist yet", () => {
    // every day of the last 8 weeks was full
    const past = rooms.map((r) => bk(r.n, "2026-08-24", 56, "done"));
    const t = suggest(past, rooms, [], 14, 8, "2026-10-20");
    expect(t[13].fromHistory).toBe(true);
    expect(t[13].pct).toBeGreaterThan(t[1].pct - 1);
    expect(t[13].level).not.toBe("quiet");
  });
  it("an empty hotel does not crash", () => {
    expect(suggest([], [], [], 3, 8, "2026-10-20")).toHaveLength(3);
  });
});

describe("backup and restore", () => {
  it("a backup brings back everything after the data is gone", async () => {
    await db.bookings.add({ id: "b1", room: "101", from: "2026-10-01", nights: 2, guest: "Ram", phone: "98", src: "Phone", status: "done", payments: [{ id: "p", method: "cash", amount: 5000, at: 1700000000000, kind: "bill" }], food: [{ name: "Tea", qty: 2, price: 40 }], extra: 0, billNo: "INV-0001", createdAt: 1700000000000, updatedAt: 1700000000000 });
    const file = JSON.stringify(await exportAll(true));
    await Promise.all([db.rooms.clear(), db.bookings.clear()]);
    const c = checkBackup(file);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.counts).toMatchObject({ rooms: 2, bookings: 1 });
    expect(await restoreBackup(c.data, true)).toBe(3);
    expect((await db.bookings.get("b1"))?.billNo).toBe("INV-0001");
    expect(await db.rooms.count()).toBe(2);
  });
  it("restoring never erases or overwrites newer data", async () => {
    const file = JSON.stringify(await exportAll(false));
    await db.rooms.update("101", { price: 9000 }); // newer than the backup
    const c = checkBackup(file);
    if (!c.ok) throw new Error();
    await restoreBackup(c.data, false);
    expect((await db.rooms.get("101"))?.price).toBe(9000);
  });
  it("pay is left out of a backup made by someone who may not see it", async () => {
    await db.pay.put({ id: "u1", uid: "u1", name: "S", mode: "monthly", rate: 30000, adj: [] });
    expect((await exportAll(false)).pay).toEqual([]);
    expect((await exportAll(true)).pay).toHaveLength(1);
  });
  it("refuses files that are not backups, or are broken", () => {
    expect(checkBackup("not json")).toEqual({ ok: false, error: "json" });
    expect(checkBackup(JSON.stringify({ app: "other" }))).toEqual({ ok: false, error: "format" });
    expect(checkBackup(JSON.stringify([1, 2]))).toEqual({ ok: false, error: "format" });
    expect(checkBackup(JSON.stringify({ app: "pocket-hotel", version: 99 }))).toEqual({ ok: false, error: "version" });
    expect(checkBackup(JSON.stringify({ app: "pocket-hotel", version: 1, rooms: "x" }))).toEqual({ ok: false, error: "format" });
    expect(checkBackup("x".repeat(26 * 1024 * 1024))).toEqual({ ok: false, error: "big" });
  });
  it("bad records are left out and counted; extra fields and prototype tricks are dropped", () => {
    const evil = JSON.parse('{"app":"pocket-hotel","version":1,"rooms":[{"n":"1","type":"A","price":-5,"st":"free"},{"n":"2","type":"A","price":100,"st":"free","__proto__":{"x":1},"constructor":{"y":2},"isAdmin":true}],"bookings":[{"id":"b","room":"2","from":"2026-02-30","nights":1,"guest":"X","status":"done"},{"id":"c","room":"2","from":"2026-02-10","nights":1,"guest":"X","status":"hacked"},{"id":"d","room":"2","from":"2026-02-10","nights":99999,"guest":"X","status":"done"}]}');
    const c = checkBackup(JSON.stringify(evil));
    if (!c.ok) throw new Error();
    expect(c.counts.rooms).toBe(1);
    expect(c.counts.bookings).toBe(0);
    expect(c.skipped).toBe(4);
    expect(Object.keys(c.data.rooms[0]).sort()).toEqual(["beds", "floor", "n", "price", "st", "type"]);
    expect(({} as any).x).toBeUndefined();
  });
  it("a booking with a payment of minus a million or a text amount is refused", () => {
    const base = { id: "b", room: "1", from: "2026-02-10", nights: 1, guest: "X", status: "done" };
    expect(cleanBooking({ ...base, payments: [{ id: "p", method: "cash", amount: -1000000, at: 1, kind: "bill" }] })).toBeNull();
    expect(cleanBooking({ ...base, payments: [{ id: "p", method: "cash", amount: "5", at: 1, kind: "bill" }] })).toBeNull();
    expect(cleanBooking({ ...base, extra: 1e15 })).toBeNull();
    expect(cleanBooking(base)).not.toBeNull();
  });
});

describe("old bookings from a spreadsheet", () => {
  it("adds finished stays that show up in the bills, and reports what it skipped", async () => {
    const csv = [
      "room,guest,phone,from,nights,paid,source",
      "101,Ram Sharma,9800000000,2026-01-15,2,5000,Phone",
      "101,Clash,,2026-01-16,1,100,Phone",
      "999,No Room,,2026-01-15,1,100,",
      "102,Future,,2027-01-01,1,100,",
      "102,,,2026-01-15,1,100,",
      "102,Bad Date,,2026-02-30,1,100,",
      "102,Neg,,2026-03-01,1,-5,",
      '102,"Quote ""Q"", Comma",,2026-03-01,3,7500,WhatsApp',
    ].join("\n");
    const r = await importBookingsCsv(csv, "2026-10-20");
    expect(r.added).toBe(2);
    expect(r.skipped).toBe(6);
    const all = await db.bookings.toArray();
    expect(all.map((b) => b.billNo).sort()).toEqual(["OLD-0001", "OLD-0002"]);
    const q = all.find((b) => b.guest.startsWith("Quote"))!;
    expect(q.guest).toBe('Quote "Q", Comma');
    expect(q.status).toBe("done");
    expect(q.payments[0].amount).toBe(7500);
    expect(q.rate! * q.nights + q.extra).toBe(7500);
  });
  it("wrong columns or too many rows are refused", async () => {
    expect((await importBookingsCsv("a,b\n1,2", "2026-10-20")).added).toBe(0);
    expect((await importBookingsCsv("", "2026-10-20")).problems).toEqual(["empty"]);
    const big = "room,guest,from,nights\n" + "101,X,2026-01-01,1\n".repeat(5001);
    expect((await importBookingsCsv(big, "2026-10-20")).problems[0]).toMatch(/too many/);
  });
});

describe("csv files are safe to open in Excel", () => {
  it("a name that looks like a formula is turned into plain text", () => {
    expect(csvSafe("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvSafe("+1+1")).toBe('"\'+1+1"');
    expect(csvSafe("@SUM(1)")).toBe('"\'@SUM(1)"');
    expect(csvSafe("-cmd")).toBe('"\'-cmd"');
    expect(csvSafe("Ram")).toBe('"Ram"');
    expect(csvSafe(-500)).toBe('"-500"');
    expect(csvSafe("-500")).toBe('"-500"');
  });
  it("reads quotes, commas and line breaks inside cells", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  });
});
