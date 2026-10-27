import { describe, expect, it } from "vitest";
import { calcBill } from "../lib/bill";
import { findConflict, findConflicts, overlaps, bookingAt } from "../lib/booking";
import { addDays, todayISO } from "../lib/dates";
import type { BillSettings, Booking } from "../lib/types";

const base: BillSettings = { vatInvoice: true, taxIncluded: true, svc: true, vat: 13, svcPct: 10, idPhoto: false };

function bk(id: string, room: string, from: string, nights: number, over: Partial<Booking> = {}): Booking {
  return { id, room, from, nights, guest: "g", phone: "", src: "Phone", status: "booked", payments: [], food: [], extra: 0, createdAt: 1, updatedAt: 1, ...over };
}

describe("bill", () => {
  it("tax included keeps the total and splits the parts", () => {
    const r = calcBill(2486, base);
    expect(r.total).toBe(2486);
    expect(r.base + r.svc + r.vat).toBe(2486);
    expect(r.base).toBe(2000);
    expect(r.svc).toBe(200);
    expect(r.vat).toBe(286);
  });
  it("tax on top adds service first then VAT", () => {
    const r = calcBill(1000, { ...base, taxIncluded: false });
    expect(r).toEqual({ base: 1000, svc: 100, vat: 143, total: 1243 });
  });
  it("simple receipt has no VAT", () => {
    const r = calcBill(1000, { ...base, vatInvoice: false, taxIncluded: false });
    expect(r.vat).toBe(0);
    expect(r.total).toBe(1100);
  });
  it("no service and no VAT leaves the amount alone", () => {
    expect(calcBill(777, { ...base, svc: false, vatInvoice: false }).total).toBe(777);
  });
  it("parts always add up to the total", () => {
    for (const sub of [1, 99, 1234, 56789, 100001])
      for (const taxIncluded of [true, false]) {
        const r = calcBill(sub, { ...base, taxIncluded });
        expect(r.base + r.svc + r.vat).toBe(r.total);
      }
  });
});

describe("booking conflicts", () => {
  it("overlap rules: check-out day is free", () => {
    expect(overlaps("2026-11-01", 2, "2026-11-03", 1)).toBe(false);
    expect(overlaps("2026-11-01", 3, "2026-11-03", 1)).toBe(true);
    expect(overlaps("2026-11-05", 1, "2026-11-01", 2)).toBe(false);
  });
  it("finds a conflict in the same room only", () => {
    const all = [bk("a", "101", "2026-11-01", 3)];
    expect(findConflict(all, "101", "2026-11-02", 1)?.id).toBe("a");
    expect(findConflict(all, "102", "2026-11-02", 1)).toBeUndefined();
  });
  it("cancelled and done stays do not block", () => {
    const all = [bk("a", "101", "2026-11-01", 3, { status: "cancelled" }), bk("b", "101", "2026-11-01", 3, { status: "done" })];
    expect(findConflict(all, "101", "2026-11-01", 1)).toBeUndefined();
  });
  it("editing a booking ignores itself", () => {
    const all = [bk("a", "101", "2026-11-01", 3)];
    expect(findConflict(all, "101", "2026-11-01", 3, "a")).toBeUndefined();
  });
  it("two offline phones: older booking keeps the room, newer one is flagged", () => {
    const all = [bk("x", "101", "2026-11-01", 2, { createdAt: 20 }), bk("y", "101", "2026-11-02", 2, { createdAt: 10 }), bk("z", "102", "2026-11-01", 2)];
    const c = findConflicts(all);
    expect(c).toHaveLength(1);
    expect(c[0].keep.id).toBe("y");
    expect(c[0].move.id).toBe("x");
  });
  it("bookingAt finds the stay on a day", () => {
    const all = [bk("a", "101", "2026-11-01", 2)];
    expect(bookingAt(all, "101", "2026-11-02")?.id).toBe("a");
    expect(bookingAt(all, "101", "2026-11-03")).toBeUndefined();
  });
});

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("todayISO uses the local day", () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
