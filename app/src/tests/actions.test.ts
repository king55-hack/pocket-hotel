import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureHotel } from "../db";
import { addOrderToBooking, addToRoomBill, cancelBooking, changePrice, checkIn, checkOut, createBooking, editBooking, loadSampleRooms, moveBooking, payOrderAtTable } from "../actions";

const info = { nationality: "Nepali", persons: 1, idNo: "1", visa: "", extraBeds: 0 };
const mk = (room: string, from = "2026-11-01", nights = 2) => createBooking({ room, from, nights, guest: "Ram", phone: "", src: "Phone", advance: 0 });

// The tests use fixed 2026 dates, so the clock is fixed too (only the date is faked, nothing else).
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));

beforeEach(async () => {
  await Promise.all([db.rooms.clear(), db.bookings.clear(), db.orders.clear(), db.hotel.clear(), db.audit.clear()]);
  await ensureHotel();
  await loadSampleRooms();
});

describe("bookings", () => {
  it("refuses an empty name and a double booking", async () => {
    expect(await createBooking({ room: "101", from: "2026-11-01", nights: 1, guest: "  ", phone: "", src: "Phone", advance: 0 })).toEqual({ ok: false, error: "name" });
    expect((await mk("101")).ok).toBe(true);
    expect(await mk("101", "2026-11-02", 1)).toEqual({ ok: false, error: "taken" });
    expect((await mk("101", "2026-11-03", 1)).ok).toBe(true);
  });
  it("two quick bookings for one room: only one wins", async () => {
    const r = await Promise.all([mk("102"), mk("102")]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
  });
  it("cannot book an out-of-order or unknown room", async () => {
    await db.rooms.update("203", { st: "out" });
    expect(await mk("203")).toEqual({ ok: false, error: "room" });
    expect(await mk("999")).toEqual({ ok: false, error: "room" });
  });
  it("cancel frees the room and is written to the log", async () => {
    const b = await mk("101");
    if (!b.ok) throw new Error();
    await cancelBooking(b.value.id, "guest called");
    expect((await mk("101")).ok).toBe(true);
    expect((await db.audit.toArray()).some((a) => a.action === "cancel booking")).toBe(true);
  });
  it("move to a taken room is refused", async () => {
    const a = await mk("101");
    await mk("102");
    if (!a.ok) throw new Error();
    expect(await moveBooking(a.value.id, "102")).toEqual({ ok: false, error: "taken" });
    expect((await moveBooking(a.value.id, "103")).ok).toBe(true);
  });
});

describe("check-out and bill", () => {
  async function stay(advance = 0) {
    const b = await createBooking({ room: "102", from: "2026-11-01", nights: 2, guest: "Sita", phone: "", src: "Phone", advance });
    if (!b.ok) throw new Error();
    await checkIn(b.value.id, info);
    return b.value.id;
  }
  it("numbers bills one after another and makes the room 'to clean'", async () => {
    const id = await stay();
    const r = await checkOut(id, 0, { cash: 5000, qr: 0 });
    expect(r).toEqual({ ok: true, value: { billNo: "INV-0001", due: 0 } });
    expect((await db.rooms.get("102"))?.st).toBe("clean");
    const id2 = await createBooking({ room: "103", from: "2026-11-01", nights: 1, guest: "B", phone: "", src: "Phone", advance: 0 });
    if (!id2.ok) throw new Error();
    await checkIn(id2.value.id, info);
    const r2 = await checkOut(id2.value.id, 0, { cash: 2500, qr: 0 });
    expect(r2.ok && r2.value.billNo).toBe("INV-0002");
  });
  it("cannot check out twice", async () => {
    const id = await stay();
    await checkOut(id, 0, { cash: 5000, qr: 0 });
    expect(await checkOut(id, 0, { cash: 0, qr: 0 })).toEqual({ ok: false, error: "state" });
  });
  it("refuses paying more than is due; unpaid part is kept as credit", async () => {
    const id = await stay(1000);
    expect(await checkOut(id, 0, { cash: 99999, qr: 0 })).toEqual({ ok: false, error: "amount" });
    const r = await checkOut(id, 0, { cash: 1000, qr: 0 });
    expect(r.ok && r.value.due).toBe(3000);
    const b = (await db.bookings.toArray())[0];
    expect(b.payments.some((p) => p.method === "credit" && p.amount === 3000)).toBe(true);
  });
  it("food added to the room bill counts", async () => {
    const id = await stay();
    await addToRoomBill(id, [{ name: "Tea", qty: 2, price: 40 }]);
    const r = await checkOut(id, 0, { cash: 5080, qr: 0 });
    expect(r.ok && r.value.due).toBe(0);
  });
  it("receipt numbers are separate when VAT invoice is off", async () => {
    const h = await ensureHotel();
    await db.hotel.put({ ...h, bill: { ...h.bill, vatInvoice: false } });
    const id = await stay();
    const r = await checkOut(id, 0, { cash: 5000, qr: 0 });
    expect(r.ok && r.value.billNo).toBe("RC-0001");
  });
  it("price change is written to the log", async () => {
    await changePrice("101", 1800);
    expect((await db.rooms.get("101"))?.price).toBe(1800);
    expect((await db.audit.toArray())[0].detail).toContain("1500 -> 1800");
  });
});

describe("changing bookings", () => {
  it("moves dates and room, refuses a clash, and writes it to the log", async () => {
    const a = await mk("101", "2026-11-01", 2);
    const b = await mk("102", "2026-11-01", 2);
    if (!a.ok || !b.ok) throw new Error();
    expect((await editBooking(a.value.id, { from: "2026-12-01", nights: 3 })).ok).toBe(true);
    expect(await editBooking(a.value.id, { room: "102", from: "2026-11-02" })).toEqual({ ok: false, error: "taken" });
    expect((await editBooking(a.value.id, { room: "103", from: "2026-11-01" })).ok).toBe(true);
    expect(await editBooking(a.value.id, { guest: "  " })).toEqual({ ok: false, error: "name" });
    expect(await editBooking(a.value.id, { nights: 0 })).toEqual({ ok: false, error: "dates" });
    expect(await editBooking(a.value.id, { from: "bad" })).toEqual({ ok: false, error: "dates" });
    expect((await db.audit.toArray()).filter((x) => x.action === "booking edited")).toHaveLength(2);
  });
  it("a guest who is in the room can stay longer but not change room or arrival day", async () => {
    const a = await mk("101", "2026-11-01", 2);
    if (!a.ok) throw new Error();
    await checkIn(a.value.id, info);
    expect((await editBooking(a.value.id, { room: "103", from: "2027-01-01", nights: 4 })).ok).toBe(true);
    const b = (await db.bookings.get(a.value.id))!;
    expect([b.room, b.from, b.nights]).toEqual(["101", "2026-11-01", 4]);
    expect(await mk("101", "2026-11-04", 1)).toEqual({ ok: false, error: "taken" }); // the longer stay blocks the room
  });
  it("closed bookings cannot be changed", async () => {
    const a = await mk("101");
    if (!a.ok) throw new Error();
    await cancelBooking(a.value.id, "x");
    expect(await editBooking(a.value.id, { nights: 3 })).toEqual({ ok: false, error: "state" });
  });
});

describe("restaurant money", () => {
  const order = async (to: string) => {
    const id = crypto.randomUUID();
    await db.orders.add({ id, to, items: [{ name: "Momo", qty: 2, price: 250 }], done: true, billed: false, at: Date.now() });
    return id;
  };
  it("a table that pays puts the money in the day book once", async () => {
    const id = await order("T1");
    expect((await payOrderAtTable(id, "cash")).ok).toBe(true);
    expect((await db.orders.get(id))?.paid).toMatchObject({ method: "cash", amount: 500 });
    expect(await payOrderAtTable(id, "qr")).toEqual({ ok: false, error: "state" });
  });
  it("a table that did not pay goes onto a room bill and is paid at check-out", async () => {
    const b = await createBooking({ room: "102", from: "2026-11-01", nights: 1, guest: "Sita", phone: "", src: "Phone", advance: 0 });
    if (!b.ok) throw new Error();
    const id = await order("T2");
    expect(await addOrderToBooking(id, b.value.id)).toEqual({ ok: false, error: "state" }); // not checked in yet
    await checkIn(b.value.id, info);
    expect((await addOrderToBooking(id, b.value.id)).ok).toBe(true);
    expect((await addOrderToBooking(id, b.value.id)).ok).toBe(false); // not twice
    const r = await checkOut(b.value.id, 0, { cash: 3000, qr: 0 }); // room 2500 + momo 500
    expect(r.ok && r.value.due).toBe(0);
  });
});

describe("past dates and rooms that are not clean", () => {
  it("a booking cannot start on a day that is over; today and later are fine", async () => {
    const mk2 = (from: string) => createBooking({ room: "101", from, nights: 1, guest: "Ram", phone: "", src: "Phone", advance: 0 });
    expect(await mk2("2026-10-19")).toEqual({ ok: false, error: "past" }); // the clock is fixed at 2026-10-20
    expect((await mk2("2026-10-20")).ok).toBe(true);
    expect((await createBooking({ room: "102", from: "2026-10-21", nights: 1, guest: "S", phone: "", src: "Phone", advance: 0 })).ok).toBe(true);
    expect(await createBooking({ room: "103", from: "not-a-date", nights: 1, guest: "S", phone: "", src: "Phone", advance: 0 })).toEqual({ ok: false, error: "dates" });
  });
  it("a booking cannot be moved into the past", async () => {
    const b = await createBooking({ room: "101", from: "2026-10-25", nights: 2, guest: "Ram", phone: "", src: "Phone", advance: 0 });
    if (!b.ok) throw new Error();
    expect(await editBooking(b.value.id, { from: "2026-10-10" })).toEqual({ ok: false, error: "past" });
    expect((await editBooking(b.value.id, { from: "2026-10-22" })).ok).toBe(true);
  });
  it("after check-out the room waits for cleaning, and nobody can be checked in until it is clean", async () => {
    const a = await createBooking({ room: "102", from: "2026-10-20", nights: 1, guest: "Out", phone: "", src: "Phone", advance: 0 });
    if (!a.ok) throw new Error();
    await checkIn(a.value.id, info);
    await checkOut(a.value.id, 0, { cash: 2500, qr: 0 });
    expect((await db.rooms.get("102"))?.st).toBe("clean");
    const n = await createBooking({ room: "102", from: "2026-10-21", nights: 1, guest: "New", phone: "", src: "Phone", advance: 0 });
    if (!n.ok) throw new Error();
    expect(await checkIn(n.value.id, info)).toEqual({ ok: false, error: "dirty" });
    expect((await db.bookings.get(n.value.id))?.status).toBe("booked");
    await db.rooms.update("102", { st: "free" }); // the housekeeper marks it clean
    expect((await checkIn(n.value.id, info)).ok).toBe(true);
  });
  it("a manager can check in to an uncleaned room on purpose, and it is written to the log", async () => {
    await db.rooms.update("103", { st: "clean" });
    const n = await createBooking({ room: "103", from: "2026-10-20", nights: 1, guest: "Rush", phone: "", src: "Phone", advance: 0 });
    if (!n.ok) throw new Error();
    expect((await checkIn(n.value.id, info, { force: true })).ok).toBe(true);
    expect((await db.audit.toArray()).some((x) => x.action === "checked in to an uncleaned room")).toBe(true);
  });
  it("with the cleaning list switched off, the room is ready again right after check-out", async () => {
    const h = await ensureHotel();
    await db.hotel.put({ ...h, feat: { ...h.feat, housekeeping: false } });
    const a = await createBooking({ room: "101", from: "2026-10-20", nights: 1, guest: "X", phone: "", src: "Phone", advance: 0 });
    if (!a.ok) throw new Error();
    await checkIn(a.value.id, info);
    await checkOut(a.value.id, 0, { cash: 2500, qr: 0 });
    expect((await db.rooms.get("101"))?.st).toBe("free");
  });
});
