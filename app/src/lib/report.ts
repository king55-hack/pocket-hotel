import { billTotals } from "../print";
import { addDays, daysBetween, todayISO } from "./dates";
import { overlaps } from "./booking";
import { rateOf } from "./policy";
import type { Booking, Hotel, Order, Room } from "./types";

export const dayOfMs = (ms: number) => todayISO(new Date(ms));

/** Every day from `from` to `to`, both included (at most 400 so a typing slip cannot freeze the phone). */
export function daysIn(from: string, to: string): string[] {
  const n = Math.min(400, Math.max(0, daysBetween(from, to)) + 1);
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

/** Money really received on each day: advances and bill payments (not "credit"), table sales, minus refunds. */
export function salesByDay(bookings: Booking[], orders: Order[], days: string[]): number[] {
  const at = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const b of bookings)
    for (const p of b.payments) {
      const i = at.get(dayOfMs(p.at));
      if (i !== undefined && p.method !== "credit") out[i] += p.kind === "refund" ? -p.amount : p.amount;
    }
  for (const o of orders) {
    const i = o.paid ? at.get(dayOfMs(o.paid.at)) : undefined;
    if (i !== undefined) out[i] += o.paid!.amount;
  }
  return out;
}

/** Rooms in use each day. "stayed" = a guest is/was in the room; "booked" = reserved, not arrived yet. */
export function occupancyByDay(bookings: Booking[], rooms: Room[], days: string[]): { stayed: number[]; booked: number[]; total: number } {
  const live = new Set(rooms.map((r) => r.n));
  const stayed = days.map(() => 0);
  const booked = days.map(() => 0);
  for (const b of bookings) {
    if (!live.has(b.room) || !["booked", "occupied", "done"].includes(b.status)) continue;
    days.forEach((d, i) => {
      if (!overlaps(d, 1, b.from, b.nights)) return;
      if (b.status === "booked") booked[i]++;
      else stayed[i]++;
    });
  }
  return { stayed, booked, total: rooms.length };
}

/** Add up `size` days into one bar (a week) when the range is long. */
export function bucket(values: number[], labels: string[], size: number): { v: number[]; l: string[] } {
  if (size <= 1) return { v: values, l: labels };
  const v: number[] = [], l: string[] = [];
  for (let i = 0; i < values.length; i += size) {
    v.push(values.slice(i, i + size).reduce((a, x) => a + x, 0));
    l.push(labels[i]);
  }
  return { v, l };
}

export type Summary = {
  received: number; billed: number; unpaid: number; bills: number;
  arrivals: number; cancelled: number; noShow: number;
  bySource: [string, number][]; byMethod: [string, number][]; byCategory: [string, number][];
  futureCount: number; futureValue: number; inHouse: number;
};

export function summarize(h: Hotel, bookings: Booking[], orders: Order[], rooms: Room[], days: string[], today = todayISO()): Summary {
  const first = days[0], last = days[days.length - 1];
  const inRange = (d: string) => d >= first && d <= last;
  const room = new Map(rooms.map((r) => [r.n, r]));
  const method: Record<string, number> = {};
  const source: Record<string, number> = {};
  const cat: Record<string, number> = {};
  let received = 0;
  for (const b of bookings)
    for (const p of b.payments) {
      if (p.method === "credit" || !inRange(dayOfMs(p.at))) continue;
      const v = p.kind === "refund" ? -p.amount : p.amount;
      received += v;
      method[p.method] = (method[p.method] ?? 0) + v;
    }
  for (const o of orders)
    if (o.paid && inRange(dayOfMs(o.paid.at))) {
      received += o.paid.amount;
      method[o.paid.method] = (method[o.paid.method] ?? 0) + o.paid.amount;
    }
  let billed = 0, unpaid = 0, bills = 0, arrivals = 0, cancelled = 0, noShow = 0, futureCount = 0, futureValue = 0, inHouse = 0;
  for (const b of bookings) {
    if (b.status === "done" && b.billNo && inRange(dayOfMs(b.outAt ?? b.updatedAt))) {
      const t = billTotals(h, b, room.get(b.room));
      billed += t.total; unpaid += t.due; bills++;
    }
    if (b.status === "cancelled" && inRange(dayOfMs(b.updatedAt))) cancelled++;
    if (b.status === "noshow" && inRange(dayOfMs(b.updatedAt))) noShow++;
    if (b.status !== "cancelled" && b.status !== "noshow" && inRange(b.from)) {
      arrivals++;
      source[b.src] = (source[b.src] ?? 0) + 1;
    }
    if (["booked", "occupied", "done"].includes(b.status)) {
      const r = room.get(b.room);
      for (const d of days) if (overlaps(d, 1, b.from, b.nights)) cat[r?.type ?? b.room] = (cat[r?.type ?? b.room] ?? 0) + 1;
    }
    if (b.status === "booked" && b.from > today) { futureCount++; futureValue += rateOf(b, room.get(b.room)) * b.nights; }
    if (b.status === "occupied") inHouse++;
  }
  const sorted = (m: Record<string, number>): [string, number][] => Object.entries(m).sort((a, b) => b[1] - a[1]);
  return { received, billed, unpaid, bills, arrivals, cancelled, noShow, bySource: sorted(source), byMethod: sorted(method), byCategory: sorted(cat), futureCount, futureValue, inHouse };
}

/** Short money for a chart axis: 12500 -> 12.5k */
export function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 10_000_000) return (n / 10_000_000).toFixed(1).replace(/\.0$/, "") + "cr";
  if (a >= 100_000) return (n / 100_000).toFixed(1).replace(/\.0$/, "") + "L";
  if (a >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}
