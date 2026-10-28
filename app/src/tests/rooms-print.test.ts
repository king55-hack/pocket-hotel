import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRoom, addRoomRange, createBooking, deleteRoom, loadSampleRooms } from "../actions";
import { db, ensureHotel, STARTER_MENU } from "../db";
import { btWidthFor, guessBtWidth, receiptRows, toEscPos, widthPx } from "../print";
import type { Booking, Hotel } from "../lib/types";

// The tests use fixed 2026 dates, so the clock is fixed too (only the date is faked, nothing else).
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));

beforeEach(async () => {
  await Promise.all([db.rooms.clear(), db.bookings.clear(), db.orders.clear(), db.hotel.clear(), db.audit.clear(), db.meta.clear()]);
  await ensureHotel();
});

describe("rooms", () => {
  it("adds a room, refuses a duplicate, and can add many at once", async () => {
    expect((await addRoom({ n: "101", type: "Double", floor: 1, beds: 2, price: 2500 })).ok).toBe(true);
    expect(await addRoom({ n: "101", type: "Double", floor: 1, beds: 2, price: 2500 })).toEqual({ ok: false, error: "taken" });
    expect((await addRoom({ n: "  ", type: "Double", floor: 1, beds: 2, price: 1 })).ok).toBe(false);
    expect(await addRoomRange(101, 105, { type: "Double", floor: 1, beds: 2, price: 2000 })).toBe(4); // 101 already exists
    expect(await db.rooms.count()).toBe(5);
    expect(await addRoomRange(5, 1, { type: "Double", floor: 1, beds: 2, price: 1 })).toBe(0);
    expect(await addRoomRange(1, 500, { type: "Double", floor: 1, beds: 2, price: 1 })).toBe(0);
  });

  it("a mistaken room can be deleted (hidden), not while it has a booking, and the number can be used again", async () => {
    await loadSampleRooms();
    const b = await createBooking({ room: "101", from: "2026-11-01", nights: 2, guest: "Ram", phone: "", src: "Phone", advance: 0 });
    expect(await deleteRoom("101")).toEqual({ ok: false, error: "inuse" });
    if (!b.ok) throw new Error();
    await db.bookings.update(b.value.id, { status: "cancelled" });
    expect((await deleteRoom("101")).ok).toBe(true);
    expect((await db.rooms.get("101"))?.deleted).toBe(true);
    expect((await db.audit.toArray()).some((a) => a.action === "room deleted")).toBe(true);
    expect(await createBooking({ room: "101", from: "2026-12-01", nights: 1, guest: "X", phone: "", src: "Phone", advance: 0 })).toEqual({ ok: false, error: "room" });
    expect(await deleteRoom("101")).toEqual({ ok: false, error: "room" });
    expect((await addRoom({ n: "101", type: "Single", floor: 1, beds: 1, price: 900 })).ok).toBe(true);
    const back = await db.rooms.get("101");
    expect(back).toMatchObject({ deleted: false, price: 900, type: "Single" });
  });
});

describe("starter menu", () => {
  it("has items in more than one category with whole-rupee prices", () => {
    expect(STARTER_MENU.length).toBeGreaterThan(3);
    expect(new Set(STARTER_MENU.map((m) => m.cat)).size).toBeGreaterThan(1);
    expect(new Set(STARTER_MENU.map((m) => m.id)).size).toBe(STARTER_MENU.length);
  });
});

describe("printing", () => {
  it("makes ESC/POS bytes: reset, raster header with the right size, black dots, feed and cut", () => {
    const w = 16, h = 2;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let i = 0; i < 4; i++) { data[i] = 0; } // first pixel black
    const out = toEscPos({ width: w, height: h, data });
    expect([...out.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...out.slice(2, 10)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]); // 2 bytes wide, 2 rows
    expect(out[10]).toBe(0x80); // top-left dot
    expect(out[11]).toBe(0x00);
    expect([...out.slice(-7)]).toEqual([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]);
    expect(out.length).toBe(2 + 8 + 4 + 7);
  });

  it("a tall bill is sent in bands", () => {
    const w = 8, h = 300;
    const out = toEscPos({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
    const headers = [] as number[];
    for (let i = 0; i < out.length - 8; i++) if (out[i] === 0x1d && out[i + 1] === 0x76 && out[i + 2] === 0x30) headers.push(out[i + 6] | (out[i + 7] << 8));
    expect(headers).toEqual([128, 128, 44]);
  });

  const hotel = { name: "Himal Lodge", address: "Pokhara", phone: "061-1", pan: "123456789", bill: { vatInvoice: true, taxIncluded: true, svc: true, vat: 13, svcPct: 10, idPhoto: false } } as unknown as Hotel;
  const bk = { id: "b", room: "101", from: "2026-11-01", nights: 2, guest: "Ram", status: "done", billNo: "INV-0007", food: [{ name: "Tea", qty: 2, price: 40 }], extra: 100,
    payments: [{ id: "p", method: "cash", amount: 1000, at: 1, kind: "bill" }, { id: "q", method: "credit", amount: 4000, at: 1, kind: "bill" }] } as unknown as Booking;
  it("the bill shows hotel, PAN, bill number, the total, what was paid, and what is still due", () => {
    const rows = receiptRows(hotel, bk, { n: "101", type: "D", floor: 1, beds: 2, price: 2500, st: "free" }, "en");
    const text = rows.map((r) => r.l + " " + (r.r ?? "")).join("\n");
    expect(text).toContain("Himal Lodge");
    expect(text).toContain("PAN: 123456789");
    expect(text).toContain("INV-0007");
    expect(rows.find((r) => r.l === "TOTAL")?.r).toBe("Rs 5,180");
    expect(rows.find((r) => r.l === "Paid")?.r).toBe("Rs 1,000"); // the credit line is not money received
    expect(rows.find((r) => r.l === "Due")?.r).toBe("Rs 4,180");
    expect(text).not.toContain("COPY");
  });
  it("a reprint says COPY, and a simple receipt has no PAN or VAT line", () => {
    const h2 = { ...hotel, bill: { ...hotel.bill, vatInvoice: false } } as Hotel;
    const rows = receiptRows(h2, bk, undefined, "ne", { copy: true });
    const text = rows.map((r) => r.l).join("\n");
    expect(text).toContain("प्रतिलिपि");
    expect(text).not.toContain("PAN");
    expect(text).not.toMatch(/VAT/);
  });
});

describe("printer paper size", () => {
  it("dots across the paper match the paper", () => {
    expect([widthPx("58"), widthPx("80"), widthPx("a5"), widthPx("a4"), widthPx("auto")]).toEqual([384, 576, 560, 700, 700]);
  });
  it("guesses a Bluetooth printer's width from its name, small (58) when unsure", () => {
    expect(guessBtWidth("POS-80C")).toBe("80");
    expect(guessBtWidth("XP-80")).toBe("80");
    expect(guessBtWidth("RPP300")).toBe("80");
    expect(guessBtWidth("MHT-P80F")).toBe("80");
    expect(guessBtWidth("MTP-II")).toBe("58");
    expect(guessBtWidth("PT-210")).toBe("58");
    expect(guessBtWidth("Printer001")).toBe("58");
  });
  it("a chosen 58 or 80 wins; otherwise what was remembered for that printer, otherwise the guess", () => {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    expect(btWidthFor("POS-80C", "58")).toBe("58");
    expect(btWidthFor("POS-80C", "auto")).toBe("80");
    store["ph.btw:POS-80C"] = "58";
    expect(btWidthFor("POS-80C", "auto")).toBe("58");
    expect(btWidthFor("POS-80C", "80")).toBe("80");
  });
});
