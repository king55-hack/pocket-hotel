import { db, ensureHotel, uid } from "./db";
import { parseCsv } from "./csv";
import { addDays } from "./lib/dates";
import { isMoney, MAX_MONEY, MAX_PERSONS } from "./lib/policy";
import type { Attendance, Booking, Hotel, Line, Order, PayRec, Payment, Room, Shift } from "./lib/types";

export const BACKUP_APP = "pocket-hotel";
export const BACKUP_VERSION = 1;
export const MAX_FILE = 25 * 1024 * 1024; // a hotel's whole history is far smaller than this
const MAX_RECORDS = 100_000;

export type Backup = {
  app: typeof BACKUP_APP; version: number; at: number; hotelName: string;
  hotel?: Partial<Hotel>; rooms: Room[]; bookings: Booking[]; orders: Order[]; shifts: Shift[]; attendance: Attendance[]; pay: PayRec[];
};

/** Everything this device holds, as one file the owner can keep. Salary data is included only when asked for (managers). */
export async function exportAll(withPay: boolean): Promise<Backup> {
  const h = await ensureHotel();
  const { id: _id, lang: _l, feat: _f, invoiceSeq: _i, receiptSeq: _r, ...settings } = h;
  return {
    app: BACKUP_APP, version: BACKUP_VERSION, at: Date.now(), hotelName: h.name,
    hotel: settings, rooms: await db.rooms.toArray(), bookings: await db.bookings.toArray(), orders: await db.orders.toArray(),
    shifts: await db.shifts.toArray(), attendance: await db.attendance.toArray(), pay: withPay ? await db.pay.toArray() : [],
  };
}

/* ---------- checking a file before anything is written ---------- */
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max: number, min = 0): x is string => typeof x === "string" && x.length >= min && x.length <= max;
const int = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;
const date = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x + "T00:00:00Z")) && new Date(x + "T00:00:00Z").toISOString().slice(0, 10) === x;
const ts = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0 && x < 4e12;
const STATUS = new Set(["booked", "occupied", "done", "cancelled", "noshow"]);
const ROOM_ST = new Set(["free", "clean", "out"]);

function lines(x: unknown): Line[] | null {
  if (!Array.isArray(x) || x.length > 300) return null;
  const out: Line[] = [];
  for (const l of x) { if (!isObj(l) || !str(l.name, 80) || !int(l.qty, 0, 10000) || !isMoney(l.price)) return null; out.push({ name: l.name, qty: l.qty, price: l.price }); }
  return out;
}

export function cleanRoom(x: unknown): Room | null {
  if (!isObj(x) || !str(x.n, 12, 1) || !str(x.type, 40) || !isMoney(x.price) || !ROOM_ST.has(x.st)) return null;
  const r: Room = { n: x.n, type: x.type, floor: int(x.floor, -5, 200) ? x.floor : 1, beds: int(x.beds, 1, 100) ? x.beds : 1, price: Math.round(x.price), st: x.st };
  if (int(x.cap, 1, MAX_PERSONS)) r.cap = x.cap;
  if (x.deleted === true) r.deleted = true;
  if (ts(x.updatedAt)) r.updatedAt = x.updatedAt;
  return r;
}

export function cleanBooking(x: unknown): Booking | null {
  if (!isObj(x) || !str(x.id, 64, 1) || !str(x.room, 12, 1) || !date(x.from) || !int(x.nights, 1, 365) || !str(x.guest, 100, 1) || !STATUS.has(x.status)) return null;
  const food = lines(x.food ?? []);
  if (!food || !Array.isArray(x.payments ?? []) || (x.payments ?? []).length > 60) return null;
  const payments: Payment[] = [];
  for (const p of x.payments ?? []) {
    if (!isObj(p) || !str(p.id, 64, 1) || !["cash", "qr", "card", "bank", "credit"].includes(p.method) || !isMoney(p.amount) || !ts(p.at) || !["advance", "bill", "refund"].includes(p.kind)) return null;
    payments.push({ id: p.id, method: p.method, amount: p.amount, at: p.at, kind: p.kind });
  }
  if (x.extra !== undefined && !isMoney(x.extra)) return null;
  const now = Date.now();
  const b: Booking = {
    id: x.id, room: x.room, from: x.from, nights: x.nights, guest: x.guest, phone: str(x.phone, 30) ? x.phone : "", src: str(x.src, 40) ? x.src : "",
    status: x.status, payments, food, extra: x.extra ?? 0, createdAt: ts(x.createdAt) ? x.createdAt : now, updatedAt: ts(x.updatedAt) ? x.updatedAt : now,
  };
  if (str(x.billNo, 30, 1)) b.billNo = x.billNo;
  if (str(x.cancelReason, 200)) b.cancelReason = x.cancelReason;
  if (int(x.persons, 1, MAX_PERSONS)) b.persons = x.persons;
  if (isMoney(x.rate)) b.rate = x.rate;
  if (isMoney(x.discount)) b.discount = x.discount;
  if (ts(x.outAt)) b.outAt = x.outAt;
  if (isObj(x.info) && str(x.info.nationality, 40) && int(x.info.persons, 1, MAX_PERSONS))
    b.info = { nationality: x.info.nationality, persons: x.info.persons, idNo: str(x.info.idNo, 60) ? x.info.idNo : "", visa: str(x.info.visa, 60) ? x.info.visa : "", extraBeds: int(x.info.extraBeds, 0, 2) ? x.info.extraBeds : 0 };
  return b;
}

function cleanOrder(x: unknown): Order | null {
  if (!isObj(x) || !str(x.id, 64, 1) || !str(x.to, 80, 1) || !ts(x.at)) return null;
  const items = lines(x.items);
  if (!items) return null;
  const o: Order = { id: x.id, to: x.to, items, done: x.done === true, billed: x.billed === true, at: x.at };
  if (isObj(x.paid) && ["cash", "qr", "card"].includes(x.paid.method) && isMoney(x.paid.amount) && ts(x.paid.at)) o.paid = { method: x.paid.method, amount: x.paid.amount, at: x.paid.at };
  if (ts(x.updatedAt)) o.updatedAt = x.updatedAt;
  return o;
}

function cleanShift(x: unknown): Shift | null {
  if (!isObj(x) || !str(x.uid, 64, 1) || !date(x.day) || !str(x.tpl, 64) || !str(x.name, 80) || x.id !== `${x.uid}:${x.day}`) return null;
  return { id: x.id, uid: x.uid, name: x.name, day: x.day, tpl: x.tpl, ...(ts(x.updatedAt) ? { updatedAt: x.updatedAt } : {}) };
}

function cleanAttendance(x: unknown): Attendance | null {
  if (!isObj(x) || !str(x.uid, 64, 1) || !date(x.day) || !str(x.name, 80) || x.id !== `${x.uid}:${x.day}` || !Array.isArray(x.punches) || x.punches.length > 20) return null;
  const punches: Attendance["punches"] = [];
  for (const p of x.punches) {
    if (!isObj(p) || !ts(p.in) || (p.out !== undefined && (!ts(p.out) || p.out < p.in))) return null;
    const br: { s: number; e?: number }[] = [];
    for (const b of Array.isArray(p.breaks) ? p.breaks.slice(0, 12) : []) {
      if (!isObj(b) || !ts(b.s) || b.s < p.in || (b.e !== undefined && (!ts(b.e) || b.e < b.s))) return null;
      br.push(b.e === undefined ? { s: b.s } : { s: b.s, e: b.e });
    }
    punches.push({ in: p.in, ...(p.out !== undefined ? { out: p.out } : {}), ...(br.length ? { breaks: br } : {}) });
  }
  return { id: x.id, uid: x.uid, name: x.name, day: x.day, punches, ...(ts(x.updatedAt) ? { updatedAt: x.updatedAt } : {}) };
}

function cleanPay(x: unknown): PayRec | null {
  if (!isObj(x) || !str(x.uid, 64, 1) || x.id !== x.uid || !str(x.name, 80) || !["monthly", "daily", "hourly"].includes(x.mode) || !isMoney(x.rate) || !Array.isArray(x.adj) || x.adj.length > 36) return null;
  const adj: PayRec["adj"] = [];
  for (const a of x.adj) { if (!isObj(a) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(a.month)) || !isMoney(a.bonus) || !isMoney(a.deduct) || !str(a.note, 100)) return null; adj.push({ month: a.month, bonus: a.bonus, deduct: a.deduct, note: a.note }); }
  return { id: x.id, uid: x.uid, name: x.name, mode: x.mode, rate: x.rate, adj, ...(ts(x.updatedAt) ? { updatedAt: x.updatedAt } : {}) };
}

export type Checked = { ok: true; data: Backup; counts: Record<string, number>; skipped: number; hotelName: string } | { ok: false; error: "big" | "json" | "format" | "version" | "many" };

/** Look at a backup file. Nothing is written. Records that are not valid are counted and left out, never half-saved. */
export function checkBackup(text: string): Checked {
  if (text.length > MAX_FILE) return { ok: false, error: "big" };
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { ok: false, error: "json" }; }
  if (!isObj(j) || j.app !== BACKUP_APP) return { ok: false, error: "format" };
  if (!int(j.version, 1, BACKUP_VERSION)) return { ok: false, error: "version" };
  const lists = ["rooms", "bookings", "orders", "shifts", "attendance", "pay"] as const;
  let total = 0;
  for (const k of lists) { if (j[k] !== undefined && !Array.isArray(j[k])) return { ok: false, error: "format" }; total += (j[k] ?? []).length; }
  if (total > MAX_RECORDS) return { ok: false, error: "many" };
  let skipped = 0;
  const take = <T>(arr: unknown[] | undefined, f: (x: unknown) => T | null): T[] => (arr ?? []).flatMap((x) => { const v = f(x); if (!v) skipped++; return v ? [v] : []; });
  const data: Backup = {
    app: BACKUP_APP, version: j.version, at: ts(j.at) ? j.at : Date.now(), hotelName: str(j.hotelName, 100) ? j.hotelName : "",
    rooms: take(j.rooms, cleanRoom), bookings: take(j.bookings, cleanBooking), orders: take(j.orders, cleanOrder),
    shifts: take(j.shifts, cleanShift), attendance: take(j.attendance, cleanAttendance), pay: take(j.pay, cleanPay),
  };
  return { ok: true, data, skipped, hotelName: data.hotelName, counts: { rooms: data.rooms.length, bookings: data.bookings.length, orders: data.orders.length, shifts: data.shifts.length, attendance: data.attendance.length, pay: data.pay.length } };
}

/**
 * Put a checked backup back. Nothing already on this device is erased: a record is written only if it is missing here
 * or the file has a newer version of it. Returns how many records were added or updated.
 */
export async function restoreBackup(b: Backup, withPay: boolean): Promise<number> {
  let n = 0;
  const merge = async (tbl: any, rows: { updatedAt?: number }[], key: (r: any) => string) => {
    for (const r of rows) {
      const cur = await tbl.get(key(r));
      if (!cur || (cur.updatedAt ?? 0) < (r.updatedAt ?? 0)) { await tbl.put(r); n++; }
    }
  };
  await db.transaction("rw", [db.rooms, db.bookings, db.orders, db.shifts, db.attendance, db.pay], async () => {
    await merge(db.rooms, b.rooms, (r) => r.n);
    await merge(db.bookings, b.bookings, (r) => r.id);
    await merge(db.orders, b.orders, (r) => r.id);
    await merge(db.shifts, b.shifts, (r) => r.id);
    await merge(db.attendance, b.attendance, (r) => r.id);
    if (withPay) await merge(db.pay, b.pay, (r) => r.id);
  });
  return n;
}

/* ---------- old records from a spreadsheet ---------- */
export const CSV_HEAD = ["room", "guest", "phone", "from", "nights", "paid", "source"];
export const CSV_TEMPLATE = [CSV_HEAD, ["101", "Ram Sharma", "9800000000", "2026-01-15", "2", "5000", "Phone"]];

export type ImportResult = { added: number; skipped: number; problems: string[] };

/**
 * Old bookings from a CSV (columns: room, guest, phone, from, nights, paid, source). Each row becomes a finished stay, so it
 * shows in reports and history. The amount is the final bill. Rows with a bad date, a missing room, or a clash are skipped
 * and reported, never guessed.
 */
export async function importBookingsCsv(text: string, today: string): Promise<ImportResult> {
  const rows = parseCsv(text);
  const res: ImportResult = { added: 0, skipped: 0, problems: [] };
  if (rows.length < 2) { res.problems.push("empty"); return res; }
  if (rows.length > 5001) { res.problems.push("too many rows (5000 at most)"); return res; }
  const head = rows[0].map((x) => x.trim().toLowerCase());
  const col = (k: string) => head.indexOf(k);
  if (["room", "guest", "from", "nights"].some((k) => col(k) < 0)) { res.problems.push("columns: " + CSV_HEAD.join(", ")); return res; }
  const rooms = new Map((await db.rooms.toArray()).filter((r) => !r.deleted).map((r) => [r.n, r]));
  const all = await db.bookings.toArray();
  const seq0 = Math.max(0, ...all.map((b) => (b.billNo?.startsWith("OLD-") ? Number(b.billNo.slice(4)) || 0 : 0)));
  let seq = seq0;
  const add: Booking[] = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (k: string) => (col(k) >= 0 ? (r[col(k)] ?? "").trim() : "");
    const room = get("room"), guest = get("guest").slice(0, 100), from = get("from"), nights = Number(get("nights")), paid = Number(get("paid") || 0);
    const bad = (why: string) => { res.skipped++; if (res.problems.length < 20) res.problems.push(`line ${line}: ${why}`); };
    if (!rooms.has(room)) return bad(`room "${room.slice(0, 12)}" does not exist`);
    if (!guest) return bad("no guest name");
    if (!date(from) || from > today) return bad("date must be YYYY-MM-DD and not in the future");
    if (!int(nights, 1, 365)) return bad("nights must be 1 to 365");
    if (!isMoney(paid)) return bad("paid must be a number");
    const clash = [...all, ...add].find((b) => b.room === room && ["booked", "occupied", "done"].includes(b.status) && b.from < addDays(from, nights) && from < addDays(b.from, b.nights));
    if (clash) return bad("room is already used on those dates");
    const at = Date.parse(addDays(from, nights) + "T06:00:00Z");
    const now = Date.now();
    const rate = Math.floor(paid / nights);
    const pay: Payment[] = paid > 0 ? [{ id: uid(), method: "cash", amount: Math.round(paid), at, kind: "bill" }] : [];
    add.push({
      id: uid(), room, from, nights, guest, phone: get("phone").slice(0, 30), src: (get("source") || "Old record").slice(0, 40), status: "done",
      payments: pay, food: [], extra: Math.min(MAX_MONEY, Math.round(paid) - rate * nights), rate, billNo: `OLD-${String(++seq).padStart(4, "0")}`,
      outAt: at, createdAt: at, updatedAt: now,
    });
  });
  if (add.length) await db.bookings.bulkAdd(add);
  res.added = add.length;
  return res;
}
