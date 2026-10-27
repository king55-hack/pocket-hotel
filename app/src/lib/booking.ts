import { addDays, parseISO } from "./dates";
import type { Booking } from "./types";

const ACTIVE = new Set(["booked", "occupied"]);

export function isActive(b: Booking): boolean {
  return ACTIVE.has(b.status);
}

// Two stays overlap when each starts before the other ends. The check-out day is free for a new guest.
export function overlaps(aFrom: string, aNights: number, bFrom: string, bNights: number): boolean {
  const a0 = parseISO(aFrom);
  const a1 = parseISO(addDays(aFrom, aNights));
  const b0 = parseISO(bFrom);
  const b1 = parseISO(addDays(bFrom, bNights));
  return a0 < b1 && b0 < a1;
}

export function findConflict(all: Booking[], room: string, from: string, nights: number, ignoreId?: string): Booking | undefined {
  return all.find((b) => b.id !== ignoreId && b.room === room && isActive(b) && overlaps(from, nights, b.from, b.nights));
}

export function bookingAt(all: Booking[], room: string, day: string): Booking | undefined {
  return all.find((b) => b.room === room && isActive(b) && overlaps(day, 1, b.from, b.nights));
}

// Used when two phones synced bookings for the same room. The older booking keeps the room
// and the newer one is returned as the conflict for the manager to move.
export function findConflicts(all: Booking[]): { keep: Booking; move: Booking }[] {
  const act = all.filter(isActive).sort((x, y) => x.createdAt - y.createdAt || x.id.localeCompare(y.id));
  const out: { keep: Booking; move: Booking }[] = [];
  for (let i = 0; i < act.length; i++)
    for (let j = i + 1; j < act.length; j++)
      if (act[i].room === act[j].room && overlaps(act[i].from, act[i].nights, act[j].from, act[j].nights))
        out.push({ keep: act[i], move: act[j] });
  return out;
}

export function paidSum(b: Booking): number {
  return b.payments.reduce((a, p) => a + (p.kind === "refund" ? -p.amount : p.amount), 0);
}
