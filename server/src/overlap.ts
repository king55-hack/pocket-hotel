const DAY = 86400000;
const ms = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ms(s));

/** Check-out day is free for the next guest. */
export function overlaps(aFrom: string, aNights: number, bFrom: string, bNights: number): boolean {
  const a0 = ms(aFrom), a1 = a0 + aNights * DAY, b0 = ms(bFrom), b1 = b0 + bNights * DAY;
  return a0 < b1 && b0 < a1;
}
