import { db } from "./db";
import type { Attendance, Shift, ShiftTpl } from "./lib/types";
import { addDays, todayISO } from "./lib/dates";

export const shiftId = (uid: string, day: string) => `${uid}:${day}`;

/** Give a person a shift on a day, or a day off (tpl ""). */
export async function setShift(who: { uid: string; name: string }, day: string, tpl: string): Promise<void> {
  const id = shiftId(who.uid, day);
  const ex = await db.shifts.get(id);
  if (!ex && !tpl) return;
  await db.shifts.put({ id, uid: who.uid, name: who.name, day, tpl });
}

/** Copy one person's week (7 days from `from`) onto the next 7 days. */
export async function copyWeek(from: string): Promise<number> {
  const rows = await db.shifts.where("day").between(from, addDays(from, 6), true, true).toArray();
  let n = 0;
  for (const r of rows) {
    const day = addDays(r.day, 7);
    const ex = await db.shifts.get(shiftId(r.uid, day));
    if (ex && ex.tpl) continue; // never overwrite what was already planned
    await db.shifts.put({ id: shiftId(r.uid, day), uid: r.uid, name: r.name, day, tpl: r.tpl });
    n++;
  }
  return n;
}

const clamp = (x: number) => Math.max(0, x);

/** The shift's start as a time on that day, and its end (the next morning for a night shift). */
export function shiftTimes(day: string, t: ShiftTpl): { start: number; end: number } {
  const at = (d: string, hm: string) => { const [h, m] = hm.split(":").map(Number); const [y, mo, da] = d.split("-").map(Number); return new Date(y, mo - 1, da, h || 0, m || 0).getTime(); };
  const start = at(day, t.start);
  let end = at(day, t.end);
  if (end <= start) end = at(addDays(day, 1), t.end);
  return { start, end };
}

/** Clock in. A person who is still clocked in (forgot to leave) cannot clock in again. */
export async function clockIn(who: { uid: string; name: string }, now = Date.now()): Promise<"ok" | "already"> {
  const day = todayISO(new Date(now));
  const id = shiftId(who.uid, day);
  return db.transaction("rw", db.attendance, async () => {
    const open = (await openPunch(who.uid, now))?.punch;
    if (open) return "already";
    const ex = await db.attendance.get(id);
    await db.attendance.put({ id, uid: who.uid, name: who.name, day, punches: [...(ex?.punches ?? []), { in: now }] });
    return "ok";
  });
}

export async function clockOut(uid: string, now = Date.now()): Promise<"ok" | "none"> {
  return db.transaction("rw", db.attendance, async () => {
    const o = await openPunch(uid, now);
    if (!o) return "none";
    await db.attendance.put({ ...o.rec, punches: o.rec.punches.map((p) => (p === o.punch ? { ...p, out: now } : p)) });
    return "ok";
  });
}

/** The punch that has no "out" yet (today's, or yesterday's for a night shift). */
export async function openPunch(uid: string, now = Date.now()): Promise<{ rec: Attendance; punch: Attendance["punches"][number] } | undefined> {
  for (const day of [todayISO(new Date(now)), todayISO(new Date(now - 86400000))]) {
    const rec = await db.attendance.get(shiftId(uid, day));
    const punch = rec?.punches.find((p) => p.out === undefined);
    if (rec && punch) return { rec, punch };
  }
  return undefined;
}

export const workedMs = (a: Attendance, now = Date.now()) => a.punches.reduce((s, p) => s + clamp((p.out ?? now) - p.in), 0);

export function hm(ms: number): string {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
export const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Minutes late (positive) or early (negative) against the planned start. */
export const lateBy = (a: Attendance, shift: Shift | undefined, tpl: ShiftTpl | undefined) =>
  shift && tpl && a.punches[0] ? Math.round((a.punches[0].in - shiftTimes(shift.day, tpl).start) / 60000) : undefined;
