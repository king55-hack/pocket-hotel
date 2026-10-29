export const MAX_MONEY = 10_000_000;
export const MAX_PERSONS = 50;
export const MAX_EXTRA_BEDS = 2;

export const isMoney = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_MONEY;

const STARTER_CAPS: Record<string, number> = { Single: 1, Double: 2, Triple: 3, Quad: 4, Deluxe: 2, Family: 5, "Dorm bed": 1 };

/** How many people the room is meant for: set on the room, else from its category, else its beds. Same rule as the app. */
export function capOf(room: Record<string, any>, cats: unknown): number {
  if (Number.isInteger(room.cap)) return room.cap;
  const list = Array.isArray(cats) ? cats : null;
  const c = list ? list.find((x: any) => x?.name === room.type)?.cap : STARTER_CAPS[room.type];
  return Number.isInteger(c) ? c : Math.max(1, Number(room.beds) || 1);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (x: unknown, n: number) => typeof x === "string" && x.length >= 1 && x.length <= n;

/** The category list, check-in rules, discount rules and shift names the owner can set on the hotel record. */
export function validHotelExtras(h: Record<string, any>): boolean {
  if (h.cats !== undefined && !(Array.isArray(h.cats) && h.cats.length <= 40 && h.cats.every((c: any) => c && str(c.id, 64) && str(c.name, 40) && Number.isInteger(c.cap) && c.cap >= 1 && c.cap <= MAX_PERSONS && isMoney(c.price)))) return false;
  if (h.policy !== undefined && !(h.policy && typeof h.policy.confirmPrice === "boolean" && typeof h.policy.editRate === "boolean")) return false;
  const d = h.disc;
  if (d !== undefined && !(d && typeof d.on === "boolean" && typeof d.maxPct === "number" && d.maxPct >= 0 && d.maxPct <= 100 && Array.isArray(d.presets) && d.presets.length <= 8 && d.presets.every((p: unknown) => typeof p === "number" && p > 0 && p <= 100))) return false;
  if (h.shiftTpl !== undefined && !(Array.isArray(h.shiftTpl) && h.shiftTpl.length <= 12 && h.shiftTpl.every((s: any) => s && str(s.id, 64) && str(s.name, 30) && TIME.test(s.start) && TIME.test(s.end)))) return false;
  return true;
}

export const PAY_MODES = new Set(["monthly", "daily", "hourly"]);

/** A person's pay record: how they are paid, the rate, and the bonus/deduction notes the manager typed per month. */
export function validPay(p: Record<string, any>): boolean {
  return typeof p.uid === "string" && p.uid.length > 0 && p.uid.length <= 64 && typeof p.name === "string" && p.name.length <= 80 && PAY_MODES.has(p.mode) && isMoney(p.rate) &&
    Array.isArray(p.adj) && p.adj.length <= 36 &&
    p.adj.every((a: any) => a && typeof a.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(a.month) && isMoney(a.bonus) && isMoney(a.deduct) && typeof a.note === "string" && a.note.length <= 100);
}

/** Times of one clock-in: when, when out, and the breaks in between. */
export function validPunches(list: unknown): boolean {
  return Array.isArray(list) && list.length <= 20 && list.every((p: any) =>
    p && Number.isFinite(p.in) && (p.out === undefined || (Number.isFinite(p.out) && p.out >= p.in)) &&
    (p.breaks === undefined || (Array.isArray(p.breaks) && p.breaks.length <= 12 && p.breaks.every((b: any) => b && Number.isFinite(b.s) && b.s >= p.in && (b.e === undefined || (Number.isFinite(b.e) && b.e >= b.s))))));
}
