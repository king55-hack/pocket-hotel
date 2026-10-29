import { addDays, todayISO } from "./dates";
import { overlaps } from "./booking";
import type { Booking, Room, Shift } from "./types";

export type Level = "busy" | "normal" | "quiet";
export type DayTip = { day: string; booked: number; expected: number; pct: number; level: Level; need: number; planned: number; fromHistory: boolean };

const ON = new Set(["booked", "occupied", "done"]);
const dow = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

/** Rooms in use on a day (booked, in house or stayed). */
export function roomsUsed(bookings: Booking[], rooms: Room[], day: string): number {
  const live = new Set(rooms.map((r) => r.n));
  const used = new Set<string>();
  for (const b of bookings) if (ON.has(b.status) && live.has(b.room) && overlaps(day, 1, b.from, b.nights)) used.add(b.room);
  return used.size;
}

/** How full the hotel usually is on each weekday: the average of the last 8 weeks (0 when there is no history). */
export function weekdayHistory(bookings: Booking[], rooms: Room[], today: string): number[] {
  const sum = Array(7).fill(0), n = Array(7).fill(0);
  if (!rooms.length) return sum;
  for (let i = 1; i <= 56; i++) {
    const d = addDays(today, -i);
    sum[dow(d)] += roomsUsed(bookings, rooms, d) / rooms.length;
    n[dow(d)]++;
  }
  return sum.map((s, i) => (n[i] ? s / n[i] : 0));
}

/**
 * A plain rule of thumb, not real AI: for each coming day, take the rooms already booked. Days far ahead usually have
 * few bookings yet, so they are lifted towards what that weekday was like in the last 8 weeks. Then:
 *   75% full or more -> busy (more staff), under 35% -> quiet (fewer staff), otherwise normal.
 * One person is suggested for every `perStaff` rooms in use (at least one).
 */
export function suggest(bookings: Booking[], rooms: Room[], shifts: Shift[], days = 14, perStaff = 8, today = todayISO()): DayTip[] {
  const hist = weekdayHistory(bookings, rooms, today);
  const out: DayTip[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const booked = roomsUsed(bookings, rooms, day);
    const bookedPct = rooms.length ? booked / rooms.length : 0;
    // the further away the day, the more we trust the usual pattern over the (still incomplete) bookings
    const weight = Math.min(0.7, i / 14);
    const usual = hist[dow(day)] ?? 0;
    const expectedPct = Math.min(1, Math.max(bookedPct, bookedPct * (1 - weight) + usual * weight));
    const expected = Math.round(expectedPct * rooms.length);
    const pct = Math.round(expectedPct * 100);
    const level: Level = pct >= 75 ? "busy" : pct < 35 ? "quiet" : "normal";
    out.push({
      day, booked, expected, pct, level,
      need: Math.max(1, Math.ceil(expected / Math.max(1, perStaff))),
      planned: shifts.filter((s) => s.day === day && s.tpl).length,
      fromHistory: expectedPct > bookedPct + 0.001,
    });
  }
  return out;
}
