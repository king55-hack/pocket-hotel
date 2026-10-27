import { db, logAudit, uid, ensureHotel } from "./db";
import { calcBill, sumLines } from "./lib/bill";
import { findConflict, paidSum } from "./lib/booking";
import type { Booking, GuestInfo, Line, Payment } from "./lib/types";

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: "name" | "taken" | "room" | "state" | "amount" };

export async function createBooking(i: { room: string; from: string; nights: number; guest: string; phone: string; src: string; advance: number }): Promise<Result<Booking>> {
  const guest = i.guest.trim();
  const nights = Math.floor(i.nights);
  if (!guest) return { ok: false, error: "name" };
  if (!(nights >= 1) || nights > 365) return { ok: false, error: "amount" };
  const advance = Math.max(0, Math.round(i.advance || 0));
  return db.transaction("rw", db.rooms, db.bookings, async () => {
    const room = await db.rooms.get(i.room);
    if (!room || room.st === "out") return { ok: false, error: "room" } as const;
    const all = await db.bookings.where("room").equals(i.room).toArray();
    if (findConflict(all, i.room, i.from, nights)) return { ok: false, error: "taken" } as const;
    const now = Date.now();
    const payments: Payment[] = advance > 0 ? [{ id: uid(), method: "cash", amount: advance, at: now, kind: "advance" }] : [];
    const b: Booking = { id: uid(), room: i.room, from: i.from, nights, guest, phone: i.phone.trim(), src: i.src, status: "booked", payments, food: [], extra: 0, createdAt: now, updatedAt: now };
    await db.bookings.add(b);
    return { ok: true, value: b } as const;
  });
}

export async function checkIn(id: string, info: GuestInfo): Promise<Result> {
  return db.transaction("rw", db.bookings, async () => {
    const b = await db.bookings.get(id);
    if (!b || b.status !== "booked") return { ok: false, error: "state" } as const;
    await db.bookings.update(id, { status: "occupied", info, updatedAt: Date.now() });
    return { ok: true, value: undefined } as const;
  });
}

export async function cancelBooking(id: string, reason: string, noShow = false): Promise<Result> {
  return db.transaction("rw", db.bookings, db.audit, async () => {
    const b = await db.bookings.get(id);
    if (!b || b.status !== "booked") return { ok: false, error: "state" } as const;
    await db.bookings.update(id, { status: noShow ? "noshow" : "cancelled", cancelReason: reason, updatedAt: Date.now() });
    await logAudit(noShow ? "no-show" : "cancel booking", `${b.guest} room ${b.room} ${b.from} ${reason}`);
    return { ok: true, value: undefined } as const;
  });
}

export async function addToRoomBill(bookingId: string, lines: Line[]): Promise<Result> {
  return db.transaction("rw", db.bookings, async () => {
    const b = await db.bookings.get(bookingId);
    if (!b || b.status !== "occupied") return { ok: false, error: "state" } as const;
    await db.bookings.update(bookingId, { food: [...b.food, ...lines], updatedAt: Date.now() });
    return { ok: true, value: undefined } as const;
  });
}

export async function checkOut(id: string, extra: number, pay: { cash: number; qr: number }): Promise<Result<{ billNo: string; due: number }>> {
  return db.transaction("rw", db.bookings, db.rooms, db.hotel, db.audit, async () => {
    const b = await db.bookings.get(id);
    if (!b || b.status !== "occupied") return { ok: false, error: "state" } as const;
    const h = await ensureHotel();
    const room = await db.rooms.get(b.room);
    if (!room) return { ok: false, error: "room" } as const;
    const e = Math.max(0, Math.round(extra || 0));
    const sub = room.price * b.nights + sumLines(b.food) + e;
    const total = calcBill(sub, h.bill).total;
    const cash = Math.max(0, Math.round(pay.cash || 0));
    const qr = Math.max(0, Math.round(pay.qr || 0));
    const due = total - paidSum(b);
    if (cash + qr > Math.max(0, due)) return { ok: false, error: "amount" } as const;
    const invoice = h.bill.vatInvoice;
    const prefix = invoice ? "INV" : "RC";
    // Next number = highest number on this device + 1. Two phones offline can pick the same one; the server flags that.
    const all = await db.bookings.toArray();
    const seq = Math.max(0, ...all.map((x) => (x.billNo?.startsWith(prefix + "-") ? Number(x.billNo.slice(prefix.length + 1)) || 0 : 0))) + 1;
    const billNo = `${prefix}-${String(seq).padStart(4, "0")}`;
    const now = Date.now();
    const payments = [...b.payments];
    if (cash > 0) payments.push({ id: uid(), method: "cash", amount: cash, at: now, kind: "bill" });
    if (qr > 0) payments.push({ id: uid(), method: "qr", amount: qr, at: now, kind: "bill" });
    const stillDue = due - cash - qr;
    if (stillDue > 0) payments.push({ id: uid(), method: "credit", amount: stillDue, at: now, kind: "bill" });
    await db.bookings.update(id, { status: "done", extra: e, billNo, payments, updatedAt: now });
    await db.rooms.update(b.room, { st: "clean" });
    await logAudit("checkout", `${billNo} room ${b.room} total ${total} unpaid ${stillDue}`);
    return { ok: true, value: { billNo, due: stillDue } } as const;
  });
}

export async function changePrice(room: string, price: number) {
  const p = Math.max(0, Math.round(price || 0));
  const r = await db.rooms.get(room);
  if (!r || r.price === p) return;
  await db.rooms.update(room, { price: p });
  await logAudit("price change", `room ${room}: ${r.price} -> ${p}`);
}

export async function moveBooking(id: string, room: string): Promise<Result> {
  return db.transaction("rw", db.bookings, db.rooms, db.audit, async () => {
    const b = await db.bookings.get(id);
    const r = await db.rooms.get(room);
    if (!b || !r || r.st === "out") return { ok: false, error: "room" } as const;
    const all = await db.bookings.where("room").equals(room).toArray();
    if (findConflict(all, room, b.from, b.nights, id)) return { ok: false, error: "taken" } as const;
    await db.bookings.update(id, { room, updatedAt: Date.now() });
    await logAudit("move booking", `${b.guest} ${b.room} -> ${room}`);
    return { ok: true, value: undefined } as const;
  });
}

const SAMPLE = [
  ["101", "Single", 1, 1, 1500], ["102", "Double", 1, 2, 2500], ["103", "Double", 1, 2, 2500],
  ["201", "Deluxe", 2, 2, 3500], ["202", "Deluxe", 2, 2, 3500], ["203", "Family", 2, 4, 4500],
] as const;

export async function loadSampleRooms() {
  await db.rooms.bulkPut(SAMPLE.map(([n, type, floor, beds, price]) => ({ n, type, floor, beds, price, st: "free" as const })));
}
