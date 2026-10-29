import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureHotel } from "../db";
import { addRoom, checkIn, checkOut, createBooking, setRoomCat } from "../actions";
import { catsOf, capOf, maxDiscount, maxPersons, STARTER_CATS } from "../lib/policy";
import { billTotals, receiptRows } from "../print";
import { bucket, daysIn, occupancyByDay, salesByDay, summarize } from "../lib/report";
import { clockIn, clockOut, copyWeek, openPunch, setShift, shiftTimes, workedMs } from "../shifts";
import { DEFAULT_HOTEL } from "../db";

vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));

const info = (persons: number, extraBeds = 0) => ({ nationality: "Nepali", persons, idNo: "1", visa: "", extraBeds });
const book = (room: string, extra: Partial<Parameters<typeof createBooking>[0]> = {}) =>
  createBooking({ room, from: "2026-10-21", nights: 2, guest: "Ram", phone: "", src: "Phone", advance: 0, ...extra });

beforeEach(async () => {
  await Promise.all([db.rooms.clear(), db.bookings.clear(), db.orders.clear(), db.hotel.clear(), db.audit.clear(), db.shifts.clear(), db.attendance.clear()]);
  await ensureHotel();
  await addRoom({ n: "S1", type: "Single", floor: 1, beds: 1, cap: 1, price: 1500 });
  await addRoom({ n: "Q1", type: "Quad", floor: 1, beds: 4, cap: 4, price: 4000 });
});

describe("how many people a room holds", () => {
  it("a single room cannot get 50 people, at booking or at check-in", async () => {
    expect(await book("S1", { persons: 50 })).toEqual({ ok: false, error: "guests" });
    expect(await book("S1", { persons: 4 })).toEqual({ ok: false, error: "guests" });
    const b = await book("S1", { persons: 1 });
    if (!b.ok) throw new Error();
    expect(await checkIn(b.value.id, info(50))).toEqual({ ok: false, error: "guests" });
    expect(await checkIn(b.value.id, info(4, 2))).toEqual({ ok: false, error: "guests" }); // 1 place + 2 extra beds = 3 at most
  });
  it("an extra bed adds exactly one place, at most two", () => {
    const room = { type: "Single", beds: 1, cap: 1 };
    expect(maxPersons(room, STARTER_CATS, 0)).toBe(1);
    expect(maxPersons(room, STARTER_CATS, 2)).toBe(3);
    expect(maxPersons(room, STARTER_CATS, 99)).toBe(3);
    expect(maxPersons(room, STARTER_CATS, -5)).toBe(1);
  });
  it("a quad room takes four, a fifth needs an extra bed", async () => {
    const b = await book("Q1", { persons: 4 });
    if (!b.ok) throw new Error();
    expect(await checkIn(b.value.id, info(5, 0))).toEqual({ ok: false, error: "guests" });
    expect((await checkIn(b.value.id, info(5, 1))).ok).toBe(true);
  });
  it("nonsense people counts are refused", async () => {
    expect(await book("Q1", { persons: 0 })).toEqual({ ok: false, error: "guests" });
    expect(await book("Q1", { persons: -3 })).toEqual({ ok: false, error: "guests" });
    expect(await book("Q1", { persons: Number.NaN })).toEqual({ ok: false, error: "guests" });
  });
  it("the owner's own categories decide (Triple, VIP ...)", async () => {
    const h = await ensureHotel();
    await db.hotel.put({ ...h, cats: [...STARTER_CATS, { id: "v", name: "VIP", cap: 6, price: 9000 }] });
    await addRoom({ n: "V1", type: "VIP", floor: 2, beds: 6, price: 9000 });
    const hh = await ensureHotel();
    expect(capOf({ type: "VIP", beds: 1 }, catsOf(hh))).toBe(6);
    const b = await book("V1", { persons: 6 });
    expect(b.ok).toBe(true);
  });
  it("moving a room to another category changes how many people it holds", async () => {
    await setRoomCat("S1", { id: "c3", name: "Triple", cap: 3, price: 3300 });
    const r = await db.rooms.get("S1");
    expect(r?.type).toBe("Triple");
    expect((await book("S1", { persons: 3 })).ok).toBe(true);
  });
});

describe("money limits", () => {
  it("an advance bigger than the whole stay is refused", async () => {
    expect(await book("S1", { advance: 5000 })).toEqual({ ok: false, error: "money" }); // 2 nights x 1500 = 3000
    expect((await book("S1", { advance: 3000 })).ok).toBe(true);
  });
  it("a crazy rate is refused at check-in", async () => {
    const b = await book("S1");
    if (!b.ok) throw new Error();
    expect(await checkIn(b.value.id, info(1), { rate: -5 })).toEqual({ ok: false, error: "money" });
    expect(await checkIn(b.value.id, info(1), { rate: 1e12 })).toEqual({ ok: false, error: "money" });
    expect(await checkIn(b.value.id, info(1), { rate: Number.NaN })).toEqual({ ok: false, error: "money" });
  });
  it("the price agreed at check-in is the one on the bill, even if the room price changes later", async () => {
    const b = await book("S1");
    if (!b.ok) throw new Error();
    expect((await checkIn(b.value.id, info(1), { rate: 1000 })).ok).toBe(true);
    await db.rooms.update("S1", { price: 9999 });
    const r = await checkOut(b.value.id, 0, { cash: 2000, qr: 0 });
    expect(r.ok && r.value.due).toBe(0); // 2 nights x 1000
    const done = (await db.bookings.get(b.value.id))!;
    expect(billTotals(DEFAULT_HOTEL, done, await db.rooms.get("S1")).total).toBe(2000);
    expect((await db.audit.toArray()).some((a) => a.action === "price changed at check-in")).toBe(true);
  });
  it("extras above one crore are refused", async () => {
    const b = await book("S1");
    if (!b.ok) throw new Error();
    await checkIn(b.value.id, info(1));
    expect(await checkOut(b.value.id, 99_999_999, { cash: 0, qr: 0 })).toEqual({ ok: false, error: "money" });
  });
});

describe("discount", () => {
  async function stay() {
    const b = await book("Q1"); // 2 nights x 4000 = 8000
    if (!b.ok) throw new Error();
    await checkIn(b.value.id, info(2));
    return b.value.id;
  }
  it("takes the discount off the bill and shows it on the receipt", async () => {
    const id = await stay();
    const r = await checkOut(id, 0, { cash: 7200, qr: 0 }, 800);
    expect(r).toEqual({ ok: true, value: { billNo: "INV-0001", due: 0 } });
    const b = (await db.bookings.get(id))!;
    expect(b.discount).toBe(800);
    expect(billTotals(DEFAULT_HOTEL, b, await db.rooms.get("Q1")).total).toBe(7200);
    expect(receiptRows(DEFAULT_HOTEL, b, await db.rooms.get("Q1"), "en").some((x) => x.l === "Discount")).toBe(true);
  });
  it("refuses more than the hotel's highest percent (20% by default)", async () => {
    const id = await stay();
    expect(await checkOut(id, 0, { cash: 0, qr: 0 }, 2000)).toEqual({ ok: false, error: "amount" }); // 25%
    expect((await checkOut(id, 0, { cash: 0, qr: 0 }, 1600)).ok).toBe(true); // 20%
  });
  it("follows the owner's own rule, and can be switched off", async () => {
    const h = await ensureHotel();
    await db.hotel.put({ ...h, disc: { on: true, presets: [5], maxPct: 50 } });
    const id = await stay();
    expect((await checkOut(id, 0, { cash: 0, qr: 0 }, 4000)).ok).toBe(true);
    const h2 = await ensureHotel();
    await db.hotel.put({ ...h2, disc: { on: false, presets: [5], maxPct: 50 } });
    const b = await book("S1", { from: "2026-10-25" });
    if (!b.ok) throw new Error();
    await checkIn(b.value.id, info(1));
    expect(await checkOut(b.value.id, 0, { cash: 0, qr: 0 }, 10)).toEqual({ ok: false, error: "amount" });
  });
  it("a negative or silly discount can never raise the bill", () => {
    expect(maxDiscount(8000, { on: true, presets: [], maxPct: 20 })).toBe(1600);
    expect(maxDiscount(8000, { on: true, presets: [], maxPct: 500 })).toBe(8000);
    expect(maxDiscount(8000, { on: true, presets: [], maxPct: -5 })).toBe(0);
  });
});

describe("reports", () => {
  it("adds up money by day and counts rooms in use", async () => {
    const b = await book("Q1", { advance: 1000 });
    if (!b.ok) throw new Error();
    const days = daysIn("2026-10-19", "2026-10-23");
    const sales = salesByDay(await db.bookings.toArray(), [], days);
    expect(sales.reduce((a, x) => a + x, 0)).toBe(1000);
    expect(sales[1]).toBe(1000); // paid on the (fake) 20th
    const occ = occupancyByDay(await db.bookings.toArray(), await db.rooms.toArray(), days);
    expect(occ.booked).toEqual([0, 0, 1, 1, 0]); // 21st and 22nd
    expect(occ.total).toBe(2);
    const sum = summarize(DEFAULT_HOTEL, await db.bookings.toArray(), [], await db.rooms.toArray(), days, "2026-10-20");
    expect(sum.received).toBe(1000);
    expect(sum.futureCount).toBe(1);
    expect(sum.futureValue).toBe(8000);
    expect(sum.bySource).toEqual([["Phone", 1]]);
  });
  it("long ranges are added into weeks and never freeze the phone", () => {
    expect(bucket([1, 2, 3, 4, 5], ["a", "b", "c", "d", "e"], 2)).toEqual({ v: [3, 7, 5], l: ["a", "c", "e"] });
    expect(daysIn("2020-01-01", "2030-01-01").length).toBe(400);
    expect(daysIn("2026-10-05", "2026-10-01").length).toBe(1);
  });
});

describe("shifts and attendance", () => {
  it("a night shift ends the next morning", () => {
    const { start, end } = shiftTimes("2026-10-20", { id: "n", name: "Night", start: "22:00", end: "06:00" });
    expect((end - start) / 3600000).toBe(8);
  });
  it("sets a shift, a day off removes the plan, and copying a week never overwrites", async () => {
    const who = { uid: "u1", name: "Sita" };
    await setShift(who, "2026-10-19", "s1");
    await setShift(who, "2026-10-20", "s2");
    await setShift(who, "2026-10-20", ""); // day off
    expect((await db.shifts.get("u1:2026-10-20"))?.tpl).toBe("");
    await setShift(who, "2026-10-26", "s3"); // already planned next week
    const n = await copyWeek("2026-10-19");
    expect(n).toBe(1); // the 19th would land on the 26th, which is already planned, so only the day-off row (20th -> 27th) is copied
    expect((await db.shifts.get("u1:2026-10-26"))?.tpl).toBe("s3");
  });
  it("clock in, no double clock in, clock out, hours", async () => {
    const who = { uid: "u1", name: "Sita" };
    const t0 = new Date(2026, 9, 20, 8, 0).getTime();
    expect(await clockIn(who, t0)).toBe("ok");
    expect(await clockIn(who, t0 + 60000)).toBe("already");
    expect((await openPunch("u1", t0 + 3600000))?.punch.in).toBe(t0);
    expect(await clockOut("u1", t0 + 8 * 3600000)).toBe("ok");
    expect(await clockOut("u1", t0 + 9 * 3600000)).toBe("none");
    const a = (await db.attendance.get("u1:2026-10-20"))!;
    expect(workedMs(a)).toBe(8 * 3600000);
  });
  it("a night shift can clock out after midnight", async () => {
    const who = { uid: "u2", name: "Hari" };
    const t0 = new Date(2026, 9, 20, 22, 0).getTime();
    await clockIn(who, t0);
    expect(await clockOut("u2", t0 + 8 * 3600000)).toBe("ok"); // 06:00 next day: finds yesterday's open punch
  });
});
