import { describe, expect, it } from "vitest";
import { ENV, addStaff, booking, call, push, room, signup } from "./helpers";

const ADMIN = { "x-admin-key": "admin-key-for-tests" };
const day = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const mk = (id: string, r: string, over: Record<string, unknown> = {}) => booking(id, r, iso(Date.now() + 3 * day), 2, { createdAt: Date.now(), ...over });
const info = (persons: number, extraBeds = 0) => ({ nationality: "N", persons, idNo: "", visa: "", extraBeds });

describe("room limits, prices and discounts (sync)", () => {
  it("a single room cannot get 50 guests, even if a phone says so", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "S1", data: room("S1", { type: "Single", beds: 1, cap: 1 }) });
    const bad = await push(env, a.tok, { t: "bookings", id: "x", data: mk("x", "S1", { persons: 50 }) });
    expect(bad.j.rejected[0].reason).toBe("too_many_people");
    expect((await push(env, a.tok, { t: "bookings", id: "y", data: mk("y", "S1", { persons: 1 }) })).j.accepted).toEqual(["y"]);
    const crowd = await push(env, a.tok, { t: "bookings", id: "y", data: mk("y", "S1", { status: "occupied", persons: 4, info: info(4, 2) }), ts: Date.now() + 1000 });
    expect(crowd.j.rejected[0].reason).toBe("too_many_people");
    const fine = await push(env, a.tok, { t: "bookings", id: "y", data: mk("y", "S1", { status: "occupied", persons: 3, info: info(3, 2) }), ts: Date.now() + 2000 });
    expect(fine.j.accepted).toEqual(["y"]);
  });

  it("the owner's categories decide how many fit", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "hotel", id: "main", data: { name: "H", cats: [{ id: "q", name: "Quad", cap: 4, price: 4000 }] } });
    await push(env, a.tok, { t: "rooms", id: "Q1", data: room("Q1", { type: "Quad", beds: 1 }) });
    expect((await push(env, a.tok, { t: "bookings", id: "q4", data: mk("q4", "Q1", { persons: 4 }) })).j.accepted).toEqual(["q4"]);
    expect((await push(env, a.tok, { t: "bookings", id: "q7", data: mk("q7", "Q1", { persons: 7 }) })).j.rejected[0].reason).toBe("too_many_people");
  });

  it("silly amounts are refused", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "D1", data: room("D1") });
    const pay = (amount: number) => [{ id: "p", method: "cash", amount, at: 1, kind: "advance" }];
    for (const over of [{ extra: -5 }, { extra: 1e12 }, { discount: -1 }, { rate: -3 }, { persons: 0 }, { persons: 2.5 }, { payments: pay(-10) }, { payments: pay(1e15) }]) {
      const r = await push(env, a.tok, { t: "bookings", id: "z", data: mk("z", "D1", over) });
      expect(r.j.rejected?.[0]?.reason, JSON.stringify(over)).toBe("invalid");
    }
    expect((await push(env, a.tok, { t: "rooms", id: "BAD", data: room("BAD", { cap: 0 }) })).j.rejected[0].reason).toBe("invalid");
    expect((await push(env, a.tok, { t: "rooms", id: "BAD2", data: room("BAD2", { price: -1 }) })).j.rejected[0].reason).toBe("invalid");
  });

  it("reception cannot invent a price or a discount; a manager can, within the hotel limit", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "D1", data: room("D1") });
    const rec = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    const mgr = await addStaff(env, a.tok, a.hotel.code, "manu", "manager");
    const b = mk("b", "D1");
    await push(env, a.tok, { t: "bookings", id: "b", data: b, ts: Date.now() });
    const base = { ...b, status: "occupied", persons: 2, info: info(2) };
    // at the room's own price: fine. At another price: refused for reception.
    expect((await push(env, rec.tok, { t: "bookings", id: "b", data: { ...base, rate: 2500 }, ts: Date.now() + 1000 })).j.accepted).toEqual(["b"]);
    expect((await push(env, rec.tok, { t: "bookings", id: "b", data: { ...base, rate: 100 }, ts: Date.now() + 2000 })).j.rejected[0].reason).toBe("forbidden");
    expect((await push(env, mgr.tok, { t: "bookings", id: "b", data: { ...base, rate: 2000 }, ts: Date.now() + 3000 })).j.accepted).toEqual(["b"]);
    // 2 nights x 2000 = 4000, the default limit of 20% is 800
    const out = { ...base, rate: 2000, status: "done", billNo: "INV-0001", extra: 0, outAt: Date.now() };
    expect((await push(env, rec.tok, { t: "bookings", id: "b", data: { ...out, discount: 100 }, ts: Date.now() + 4000 })).j.rejected[0].reason).toBe("forbidden");
    expect((await push(env, mgr.tok, { t: "bookings", id: "b", data: { ...out, discount: 900 }, ts: Date.now() + 5000 })).j.rejected[0].reason).toBe("discount_too_big");
    expect((await push(env, mgr.tok, { t: "bookings", id: "b", data: { ...out, discount: 800 }, ts: Date.now() + 6000 })).j.accepted).toEqual(["b"]);
  });

  it("hotel setting records with a bad category, discount or shift list are refused", async () => {
    const env = ENV();
    const a = await signup(env);
    for (const bad of [
      { cats: [{ id: "a", name: "X", cap: 0, price: 1 }] }, { cats: [{ id: "a", name: "X", cap: 99, price: 1 }] }, { cats: "no" },
      { disc: { on: true, presets: [500], maxPct: 10 } }, { disc: { on: true, presets: [5], maxPct: 101 } }, { policy: { confirmPrice: "yes" } },
      { shiftTpl: [{ id: "s", name: "Early", start: "25:00", end: "06:00" }] },
    ]) {
      const r = await push(env, a.tok, { t: "hotel", id: "main", data: { name: "H", ...bad } });
      expect(r.j.rejected?.[0]?.reason, JSON.stringify(bad)).toBe("invalid");
    }
    const good = await push(env, a.tok, { t: "hotel", id: "main", data: { name: "H", cats: [{ id: "a", name: "Triple", cap: 3, price: 3000 }], disc: { on: true, presets: [5, 10], maxPct: 15 }, policy: { confirmPrice: true, editRate: false }, shiftTpl: [{ id: "s", name: "Early", start: "05:30", end: "13:30" }] } });
    expect(good.j.accepted).toEqual(["main"]);
  });

  it("shifts: only staff managers plan them, and only while the feature is on", async () => {
    const env = ENV();
    const a = await signup(env);
    const rec = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    const shift = { id: `${rec.id}:2026-11-01`, uid: rec.id, name: "rita", day: "2026-11-01", tpl: "s1" };
    expect((await push(env, a.tok, { t: "shifts", id: shift.id, data: shift })).j.accepted).toEqual([shift.id]); // on by default
    expect((await push(env, rec.tok, { t: "shifts", id: shift.id, data: { ...shift, tpl: "s2" }, ts: Date.now() + 1000 })).j.accepted ?? []).toEqual([]);
    expect((await push(env, a.tok, { t: "shifts", id: "wrong", data: shift })).j.rejected[0].reason).toBe("invalid"); // the id must be uid:day
    await call(env, `/admin/hotels/${a.hotel.id}/features`, { headers: ADMIN, body: { feat: { shifts: false } } });
    expect((await push(env, a.tok, { t: "shifts", id: shift.id, data: { ...shift, tpl: "s3" }, ts: Date.now() + 2000 })).j.rejected[0].reason).toBe("feature_off");
  });

  it("attendance is a premium feature, for oneself only, and recorded times cannot be rewritten", async () => {
    const env = ENV();
    const a = await signup(env);
    const rec = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    const oth = await addStaff(env, a.tok, a.hotel.code, "omar", "reception");
    const today = iso(Date.now());
    const row = (punches: unknown[], uid = rec.id) => ({ id: `${uid}:${today}`, uid, name: "x", day: today, punches });
    const t0 = Date.now() - 3600000;
    const id = `${rec.id}:${today}`;
    // off by default: the admin has to approve it
    expect((await push(env, rec.tok, { t: "attendance", id, data: row([{ in: t0 }]) })).j.rejected[0].reason).toBe("feature_off");
    await call(env, `/admin/hotels/${a.hotel.id}/features`, { headers: ADMIN, body: { feat: { attendance: true } } });
    expect((await push(env, rec.tok, { t: "attendance", id, data: row([{ in: t0 }]) })).j.accepted).toEqual([id]);
    // nobody clocks in for somebody else
    expect((await push(env, rec.tok, { t: "attendance", id: `${oth.id}:${today}`, data: row([{ in: t0 }], oth.id) })).j.rejected[0].reason).toBe("forbidden");
    // the clock-in time cannot be moved, and a time from a month ago cannot be invented
    expect((await push(env, rec.tok, { t: "attendance", id, data: row([{ in: t0 + 1800000 }]), ts: Date.now() + 1000 })).j.rejected[0].reason).toBe("forbidden");
    expect((await push(env, rec.tok, { t: "attendance", id, data: row([{ in: t0, out: t0 + 3000000 }, { in: Date.now() - 30 * day }]), ts: Date.now() + 2000 })).j.rejected[0].reason).toBe("forbidden");
    // clocking out is fine
    expect((await push(env, rec.tok, { t: "attendance", id, data: row([{ in: t0, out: t0 + 3000000 }]), ts: Date.now() + 3000 })).j.accepted).toEqual([id]);
    // the owner can correct it
    expect((await push(env, a.tok, { t: "attendance", id, data: row([{ in: t0 - 600000, out: t0 + 3000000 }]), ts: Date.now() + 4000 })).j.accepted).toEqual([id]);
  });

  it("an older hotel without the new switches gets the defaults (shifts on, attendance off)", async () => {
    const env = ENV();
    const a = await signup(env);
    await env.DB.prepare("UPDATE hotels SET feat=? WHERE id=?").bind(JSON.stringify({ restaurant: true }), a.hotel.id).run();
    const p = await call(env, "/sync/pull?since=0", { token: a.tok });
    expect(p.j.hotel.feat.shifts).toBe(true);
    expect(p.j.hotel.feat.attendance).toBe(false);
    expect(p.j.hotel.feat.restaurant).toBe(true);
  });
});
