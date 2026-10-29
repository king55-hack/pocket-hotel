import { addDays } from "./dates";
import type { Attendance, PayRec, Shift, ShiftTpl } from "./types";

export type PayRow = { present: number; hours: number; late: number; absent: number; gross: number; bonus: number; deduct: number; net: number; note: string };

export const monthOf = (day: string) => day.slice(0, 7);
export const daysInMonth = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** Minutes worked by one attendance row, with breaks taken off (the same rule as the Shifts screen). */
function netMs(a: Attendance, now: number): number {
  let t = 0;
  for (const p of a.punches) {
    const end = p.out ?? now;
    const br = (p.breaks ?? []).reduce((s, b) => s + Math.max(0, (b.e ?? now) - b.s), 0);
    t += Math.max(0, Math.max(0, end - p.in) - br);
  }
  return t;
}

/**
 * Pay for one person for one month.
 *  - monthly: the full salary, minus one day's share (salary / days in month) for every planned shift day the person did not come
 *  - daily: rate x days present
 *  - hourly: rate x hours worked (breaks are not paid)
 * Bonus and deductions the manager typed for the month are added at the end. The pay is never below zero.
 */
export function payroll(pay: PayRec, att: Attendance[], shifts: Shift[], tpl: ShiftTpl[], month: string, today: string, now = Date.now()): PayRow {
  const mine = att.filter((a) => a.uid === pay.uid && monthOf(a.day) === month);
  const workedDays = new Set(mine.filter((a) => netMs(a, now) > 0).map((a) => a.day));
  const hours = Math.round((mine.reduce((s, a) => s + netMs(a, now), 0) / 3600000) * 100) / 100;
  const planned = shifts.filter((s) => s.uid === pay.uid && monthOf(s.day) === month && s.tpl && tpl.some((t) => t.id === s.tpl));
  const absent = planned.filter((s) => s.day < today && !workedDays.has(s.day)).length;
  let late = 0;
  for (const a of mine) {
    const sh = planned.find((s) => s.day === a.day);
    const t = sh && tpl.find((x) => x.id === sh.tpl);
    if (!t || !a.punches[0]) continue;
    const [h, m] = t.start.split(":").map(Number);
    const [y, mo, d] = a.day.split("-").map(Number);
    if (a.punches[0].in - new Date(y, mo - 1, d, h, m).getTime() > 10 * 60000) late++;
  }
  const rate = Math.max(0, pay.rate);
  const gross = pay.mode === "monthly" ? Math.max(0, rate - (rate / daysInMonth(month)) * absent) : pay.mode === "daily" ? rate * workedDays.size : rate * hours;
  const adj = pay.adj.filter((x) => x.month === month);
  const bonus = adj.reduce((s, x) => s + x.bonus, 0), deduct = adj.reduce((s, x) => s + x.deduct, 0);
  return { present: workedDays.size, hours, late, absent, gross: Math.round(gross), bonus, deduct, net: Math.max(0, Math.round(gross + bonus - deduct)), note: adj.map((x) => x.note).filter(Boolean).join("; ") };
}

export const prevMonth = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
export const nextMonth = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
export const firstOf = (month: string) => month + "-01";
export const lastOf = (month: string) => addDays(nextMonth(month) + "-01", -1);
