import { db, logAudit, uid, ensureHotel } from "./db";
import { calcBill, sumLines } from "./lib/bill";
import { findConflict, isActive, paidSum } from "./lib/booking";
import { todayISO } from "./lib/dates";
import { MAX_EXTRA_BEDS, MAX_MONEY, MAX_PERSONS, catsOf, capOf, discOf, isMoney, maxDiscount, maxPersons, rateOf } from "./lib/policy";
import type { Booking, GuestInfo, Line, OrderPay, Payment, RoomCat } from "./lib/types";

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: "name" | "taken" | "room" | "state" | "amount" | "inuse" | "dates" | "past" | "dirty" | "guests" | "money" };

export async function createBooking(i: { room: string; from: string; nights: number; guest: string; phone: string; src: string; advance: number; persons?: number }, today = todayISO()): Promise<Result<Booking>> {
  const guest = i.guest.trim();
  if (i.from.length !== 10 || Number.isNaN(Date.parse(i.from + "T00:00:00Z"))) return { ok: false, error: "dates" };
  if (i.from < today) return { ok: false, error: "past" }; // a booking cannot start on a day that is already over
  const nights = Math.floor(i.nights);
  if (!guest) return { ok: false, error: "name" };
  if (!(nights >= 1) || nights > 365) return { ok: false, error: "amount" };
  const advance = Math.max(0, Math.round(i.advance || 0));
  const persons = Math.floor(i.persons ?? 1);
  if (!(persons >= 1) || persons > MAX_PERSONS) return { ok: false, error: "guests" };
  return db.transaction("rw", db.rooms, db.bookings, db.hotel, async () => {
    const room = await db.rooms.get(i.room);
    if (!room || room.deleted || room.st === "out") return { ok: false, error: "room" } as const;
    const h = await ensureHotel();
    // nobody can book more people than the room holds (two extra beds allowed), or an advance bigger than the whole stay
    if (persons > maxPersons(room, catsOf(h), MAX_EXTRA_BEDS)) return { ok: false, error: "guests" } as const;
    if (advance > MAX_MONEY || advance > calcBill(room.price * nights, h.bill).total) return { ok: false, error: "money" } as const;
    const all = await db.bookings.where("room").equals(i.room).toArray();
    if (findConflict(all, i.room, i.from, nights)) return { ok: false, error: "taken" } as const;
    const now = Date.now();
    const payments: Payment[] = advance > 0 ? [{ id: uid(), method: "cash", amount: advance, at: now, kind: "advance" }] : [];
    const b: Booking = { id: uid(), room: i.room, from: i.from, nights, guest, phone: i.phone.trim(), src: i.src, status: "booked", persons, payments, food: [], extra: 0, createdAt: now, updatedAt: now };
    await db.bookings.add(b);
    return { ok: true, value: b } as const;
  });
}

export async function checkIn(id: string, info: GuestInfo, o: { force?: boolean; rate?: number } = {}): Promise<Result> {
  const persons = Math.floor(info.persons);
  if (!(persons >= 1) || persons > MAX_PERSONS) return { ok: false, error: "guests" };
  const extraBeds = Math.max(0, Math.min(MAX_EXTRA_BEDS, Math.floor(info.extraBeds) || 0));
  if (o.rate !== undefined && (!isMoney(o.rate) || o.rate !== Math.round(o.rate))) return { ok: false, error: "money" };
  return db.transaction("rw", db.bookings, db.rooms, db.hotel, db.audit, async () => {
    const b = await db.bookings.get(id);
    if (!b || b.status !== "booked") return { ok: false, error: "state" } as const;
    const r = await db.rooms.get(b.room);
    const h = await ensureHotel();
    // the room holds only so many people (the owner sets it); an extra bed adds one place
    if (r && persons > maxPersons(r, catsOf(h), extraBeds)) return { ok: false, error: "guests" } as const;
    const rate = o.rate ?? r?.price;
    if (r && rate !== undefined && rate !== r.price) await logAudit("price changed at check-in", `room ${b.room} ${r.price} -> ${rate}`);
    // The last guest left but the room has not been cleaned: a new guest must not be put in it.
    if (r?.st === "clean") {
      if (!o.force) return { ok: false, error: "dirty" } as const;
      await logAudit("checked in to an uncleaned room", `${b.guest} room ${b.room}`);
    }
    await db.bookings.update(id, { status: "occupied", info: { ...info, persons, extraBeds }, persons, rate, updatedAt: Date.now() });
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

export async function checkOut(id: string, extra: number, pay: { cash: number; qr: number }, discount = 0): Promise<Result<{ billNo: string; due: number }>> {
  return db.transaction("rw", db.bookings, db.rooms, db.hotel, db.audit, async () => {
    const b = await db.bookings.get(id);
    if (!b || b.status !== "occupied") return { ok: false, error: "state" } as const;
    const h = await ensureHotel();
    const room = await db.rooms.get(b.room);
    if (!room) return { ok: false, error: "room" } as const;
    const e = Math.max(0, Math.round(extra || 0));
    if (e > MAX_MONEY) return { ok: false, error: "money" } as const;
    const sub = rateOf(b, room) * b.nights + sumLines(b.food) + e;
    const d = Math.max(0, Math.round(discount || 0));
    // a discount is limited by the hotel's own rule (switched off, or at most some percent)
    if (d > 0 && (!discOf(h).on || d > maxDiscount(sub, discOf(h)))) return { ok: false, error: "amount" } as const;
    const total = calcBill(sub - d, h.bill).total;
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
    await db.bookings.update(id, { status: "done", extra: e, discount: d || undefined, outAt: now, billNo, payments, updatedAt: now });
    // With the cleaning list switched off (the admin can do that) the room is ready again at once.
    await db.rooms.update(b.room, { st: h.feat.housekeeping ? "clean" : "free" });
    await logAudit("checkout", `${billNo} room ${b.room} total ${total} unpaid ${stillDue}${d ? ` discount ${d}` : ""}`);
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
    if (!b || !r || r.deleted || r.st === "out") return { ok: false, error: "room" } as const;
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

const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);

/** Add one room, or bring back a deleted room with the same number. */
export async function addRoom(r: { n: string; type: string; floor: number; beds: number; price: number; cap?: number }): Promise<Result> {
  const n = r.n.trim();
  if (!n || n.length > 12 || !isNum(r.price)) return { ok: false, error: "name" };
  return db.transaction("rw", db.rooms, async () => {
    const ex = await db.rooms.get(n);
    if (ex && !ex.deleted) return { ok: false, error: "taken" } as const;
    await db.rooms.put({ n, type: r.type, floor: r.floor || 1, beds: r.beds || 1, cap: r.cap && r.cap >= 1 ? Math.min(MAX_PERSONS, Math.floor(r.cap)) : undefined, price: Math.max(0, Math.round(r.price)), st: "free", deleted: false });
    return { ok: true, value: undefined } as const;
  });
}

/** Add many rooms at once, like 101 to 110. Numbers that already exist are skipped. */
export async function addRoomRange(from: number, to: number, base: { type: string; floor: number; beds: number; price: number; cap?: number }): Promise<number> {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from || to - from > 199) return 0;
  let made = 0;
  for (let n = from; n <= to; n++) if ((await addRoom({ n: String(n), ...base })).ok) made++;
  return made;
}

/**
 * Deleting a room never erases anything: it is hidden, so old bookings and bills still make sense.
 * A room that has a booking or a guest cannot be deleted.
 */
export async function deleteRoom(n: string): Promise<Result> {
  return db.transaction("rw", db.rooms, db.bookings, db.audit, async () => {
    const r = await db.rooms.get(n);
    if (!r || r.deleted) return { ok: false, error: "room" } as const;
    const all = await db.bookings.where("room").equals(n).toArray();
    if (all.some(isActive)) return { ok: false, error: "inuse" } as const;
    await db.rooms.update(n, { deleted: true });
    await logAudit("room deleted", `room ${n} (${r.type}, Rs ${r.price})`);
    return { ok: true, value: undefined } as const;
  });
}

/**
 * Change a booking: dates, nights, room, name, phone. A guest who is already in the room keeps the room and the arrival
 * day (only the number of nights, name and phone can change, which is how a stay is extended).
 */
export async function editBooking(id: string, c: { room?: string; from?: string; nights?: number; guest?: string; phone?: string }): Promise<Result> {
  return db.transaction("rw", db.bookings, db.rooms, db.audit, async () => {
    const b = await db.bookings.get(id);
    if (!b || !isActive(b)) return { ok: false, error: "state" } as const;
    const inHouse = b.status === "occupied";
    const room = inHouse ? b.room : (c.room ?? b.room);
    const from = inHouse ? b.from : (c.from ?? b.from);
    if (!inHouse && from !== b.from && from < todayISO()) return { ok: false, error: "past" } as const;
    const nights = Math.floor(c.nights ?? b.nights);
    const guest = (c.guest ?? b.guest).trim();
    if (!guest) return { ok: false, error: "name" } as const;
    if (from.length !== 10 || Number.isNaN(Date.parse(from + "T00:00:00Z")) || !(nights >= 1) || nights > 365) return { ok: false, error: "dates" } as const;
    const r = await db.rooms.get(room);
    if (!r || r.deleted || (r.st === "out" && room !== b.room)) return { ok: false, error: "room" } as const;
    const others = await db.bookings.where("room").equals(room).toArray();
    if (findConflict(others, room, from, nights, id)) return { ok: false, error: "taken" } as const;
    await db.bookings.update(id, { room, from, nights, guest, phone: (c.phone ?? b.phone).trim(), updatedAt: Date.now() });
    const was = `${b.room} ${b.from} ${b.nights}n`, now = `${room} ${from} ${nights}n`;
    if (was !== now || guest !== b.guest) await logAudit("booking edited", `${b.guest}: ${was} -> ${guest !== b.guest ? guest + " " : ""}${now}`);
    return { ok: true, value: undefined } as const;
  });
}

/** The guest of a table paid at the table: the money goes into the day book. */
export async function payOrderAtTable(orderId: string, method: OrderPay["method"]): Promise<Result> {
  return db.transaction("rw", db.orders, async () => {
    const o = await db.orders.get(orderId);
    if (!o || o.billed) return { ok: false, error: "state" } as const;
    const amount = o.items.reduce((s, l) => s + l.qty * l.price, 0);
    await db.orders.update(orderId, { billed: true, paid: { method, amount, at: Date.now() } });
    return { ok: true, value: undefined } as const;
  });
}

/** An order that was not paid at the table goes onto a guest's room bill, to be paid at check-out. */
export async function addOrderToBooking(orderId: string, bookingId: string): Promise<Result> {
  return db.transaction("rw", db.orders, db.bookings, async () => {
    const o = await db.orders.get(orderId);
    const b = await db.bookings.get(bookingId);
    if (!o || o.billed || !b || b.status !== "occupied") return { ok: false, error: "state" } as const;
    await db.bookings.update(bookingId, { food: [...b.food, ...o.items], updatedAt: Date.now() });
    await db.orders.update(orderId, { billed: true, done: true, to: "R" + bookingId });
    return { ok: true, value: undefined } as const;
  });
}

/** Move a room to another category: its name and the number of people follow the category; the price stays. */
export async function setRoomCat(n: string, cat: RoomCat): Promise<void> {
  const r = await db.rooms.get(n);
  if (!r || (r.type === cat.name && r.cap === cat.cap)) return;
  await db.rooms.update(n, { type: cat.name, cap: cat.cap, beds: cat.cap });
  await logAudit("room category", `room ${n}: ${r.type} -> ${cat.name} (${capOf(r, [])} -> ${cat.cap} people)`);
}
