import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, ensureHotel } from "../db";
import { addToRoomBill, cancelBooking, changePrice, checkIn, checkOut, createBooking, loadSampleRooms, moveBooking } from "../actions";

const info = { nationality: "Nepali", persons: 1, idNo: "1", visa: "", extraBeds: 0 };
const mk = (room: string, from = "2026-11-01", nights = 2) => createBooking({ room, from, nights, guest: "Ram", phone: "", src: "Phone", advance: 0 });

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
