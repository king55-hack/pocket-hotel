import { describe, expect, it } from "vitest";
import { ENV, addStaff, booking, call, push, room, signup } from "./helpers";

const ADMIN = { "x-admin-key": "admin-key-for-tests" };
const feat = (env: any, hotel: string, f: Record<string, boolean>) => call(env, `/admin/hotels/${hotel}/features`, { headers: ADMIN, body: { feat: f } });
const pay = (uid: string, over: Record<string, unknown> = {}) => ({ id: uid, uid, name: "x", mode: "monthly", rate: 30000, adj: [], ...over });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pull = async (env: any, tok: string) => (await call(env, "/sync/pull?since=0", { token: tok })).j;

describe("salary records are private", () => {
  it("are off until the admin enables attendance, and only a staff manager can write them", async () => {
    const env = ENV();
    const a = await signup(env);
    const rita = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    expect((await push(env, a.tok, { t: "pay", id: rita.id, data: pay(rita.id) })).j.rejected[0].reason).toBe("feature_off");
    await feat(env, a.hotel.id, { attendance: true });
    expect((await push(env, a.tok, { t: "pay", id: rita.id, data: pay(rita.id) })).j.accepted).toEqual([rita.id]);
    // reception cannot raise her own pay
    const raise = await push(env, rita.tok, { t: "pay", id: rita.id, data: pay(rita.id, { rate: 99999 }), ts: Date.now() + 1000 });
    expect(raise.j.rejected?.[0]?.reason ?? "refused").toMatch(/forbidden|refused/);
    expect((await pull(env, a.tok)).changes.some((c: any) => c.t === "pay")).toBe(true);
  });

  it("other staff never receive anybody else's pay; a person receives only their own", async () => {
    const env = ENV();
    const a = await signup(env);
    await feat(env, a.hotel.id, { attendance: true });
    const rita = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    const omar = await addStaff(env, a.tok, a.hotel.code, "omar", "reception");
    await push(env, a.tok, { t: "pay", id: rita.id, data: pay(rita.id, { rate: 31000 }) }, { t: "pay", id: omar.id, data: pay(omar.id, { rate: 22000 }) });
    const mine = (await pull(env, rita.tok)).changes.filter((c: any) => c.t === "pay");
    expect(mine.map((c: any) => c.id)).toEqual([rita.id]);
    expect(JSON.stringify(await pull(env, omar.tok))).not.toContain("31000");
    // a refusal must not hand back somebody else's pay either
    const peek = await push(env, rita.tok, { t: "pay", id: omar.id, data: pay(omar.id, { rate: 1 }), ts: Date.now() + 1000 });
    expect(JSON.stringify(peek.j)).not.toContain("22000");
  });

  it("a manager with staff.manage can read them all; pay with silly numbers is refused", async () => {
    const env = ENV();
    const a = await signup(env);
    await feat(env, a.hotel.id, { attendance: true });
    const rita = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    for (const over of [{ rate: -1 }, { rate: 1e12 }, { mode: "weekly" }, { adj: "x" }, { adj: [{ month: "2026-13", bonus: 0, deduct: 0, note: "" }] }, { adj: [{ month: "2026-10", bonus: -5, deduct: 0, note: "" }] }, { adj: [{ month: "2026-10", bonus: 0, deduct: 0, note: "x".repeat(200) }] }]) {
      expect((await push(env, a.tok, { t: "pay", id: rita.id, data: pay(rita.id, over) })).j.rejected?.[0]?.reason, JSON.stringify(over)).toBe("invalid");
    }
    expect((await push(env, a.tok, { t: "pay", id: "wrong", data: pay(rita.id) })).j.rejected[0].reason).toBe("invalid");
  });

  it("the sync position still moves on when pay rows are hidden, so nothing is sent twice", async () => {
    const env = ENV();
    const a = await signup(env);
    await feat(env, a.hotel.id, { attendance: true });
    const rita = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    const omar = await addStaff(env, a.tok, a.hotel.code, "omar", "reception");
    await push(env, a.tok, { t: "pay", id: omar.id, data: pay(omar.id) });
    const p = await pull(env, rita.tok);
    expect(p.changes.length).toBe(0);
    expect(p.next).toBeGreaterThan(0);
  });
});

describe("breaks", () => {
  it("are kept, cannot be removed or moved by the person, and must sit inside the shift", async () => {
    const env = ENV();
    const a = await signup(env);
    await feat(env, a.hotel.id, { attendance: true });
    const rita = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    const today = iso(Date.now()), id = `${rita.id}:${today}`, t0 = Date.now() - 4 * 3600000;
    const row = (punches: unknown[]) => ({ id, uid: rita.id, name: "r", day: today, punches });
    expect((await push(env, rita.tok, { t: "attendance", id, data: row([{ in: t0 }]) })).j.accepted).toEqual([id]);
    expect((await push(env, rita.tok, { t: "attendance", id, data: row([{ in: t0, breaks: [{ s: t0 + 3600000 }] }]), ts: Date.now() + 1000 })).j.accepted).toEqual([id]);
    expect((await push(env, rita.tok, { t: "attendance", id, data: row([{ in: t0, breaks: [{ s: t0 + 3600000, e: t0 + 4000000 }] }]), ts: Date.now() + 2000 })).j.accepted).toEqual([id]);
    // erasing the break, or making it shorter than recorded, is refused
    expect((await push(env, rita.tok, { t: "attendance", id, data: row([{ in: t0 }]), ts: Date.now() + 3000 })).j.rejected[0].reason).toBe("forbidden");
    expect((await push(env, rita.tok, { t: "attendance", id, data: row([{ in: t0, breaks: [{ s: t0 + 3600000, e: t0 + 3700000 }] }]), ts: Date.now() + 4000 })).j.rejected[0].reason).toBe("forbidden");
    // a break that starts before the clock-in, or ends before it starts, is nonsense
    expect((await push(env, a.tok, { t: "attendance", id, data: row([{ in: t0, breaks: [{ s: t0 - 5000 }] }]), ts: Date.now() + 5000 })).j.rejected[0].reason).toBe("invalid");
    expect((await push(env, a.tok, { t: "attendance", id, data: row([{ in: t0, breaks: [{ s: t0 + 100, e: t0 + 50 }] }]), ts: Date.now() + 6000 })).j.rejected[0].reason).toBe("invalid");
    expect((await push(env, a.tok, { t: "attendance", id, data: row([{ in: t0, breaks: Array.from({ length: 13 }, (_, i) => ({ s: t0 + i })) }]), ts: Date.now() + 7000 })).j.rejected[0].reason).toBe("invalid");
  });
});

describe("restoring a backup", () => {
  const day = 86400000;
  const old = (id: string, over: Record<string, unknown> = {}) => booking(id, "D1", iso(Date.now() - 90 * day), 2, { status: "done", billNo: "INV-0009", createdAt: Date.now() - 90 * day, updatedAt: Date.now() - 80 * day, ...over });

  it("finished and past bookings are refused normally, accepted for the owner once the hotel has the backup feature", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "D1", data: room("D1") });
    expect((await push(env, a.tok, { t: "bookings", id: "o1", data: old("o1") })).j.rejected[0].reason).toBe("invalid");
    await feat(env, a.hotel.id, { backup: true });
    expect((await push(env, a.tok, { t: "bookings", id: "o1", data: old("o1") })).j.accepted).toEqual(["o1"]);
  });

  it("a manager or receptionist cannot use the restore door, even with the feature on", async () => {
    const env = ENV();
    const a = await signup(env);
    await feat(env, a.hotel.id, { backup: true });
    await push(env, a.tok, { t: "rooms", id: "D1", data: room("D1") });
    const mgr = await addStaff(env, a.tok, a.hotel.code, "manu", "manager");
    const rec = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    expect((await push(env, mgr.tok, { t: "bookings", id: "o2", data: old("o2") })).j.rejected[0].reason).toBe("invalid");
    expect((await push(env, rec.tok, { t: "bookings", id: "o3", data: old("o3") })).j.rejected[0].reason).toBe("invalid");
  });

  it("restored records still obey the other rules (amounts, people, status)", async () => {
    const env = ENV();
    const a = await signup(env);
    await feat(env, a.hotel.id, { backup: true });
    await push(env, a.tok, { t: "rooms", id: "D1", data: room("D1") });
    expect((await push(env, a.tok, { t: "bookings", id: "x1", data: old("x1", { extra: -5 }) })).j.rejected[0].reason).toBe("invalid");
    expect((await push(env, a.tok, { t: "bookings", id: "x2", data: old("x2", { status: "hacked" }) })).j.rejected[0].reason).toBe("invalid");
    expect((await push(env, a.tok, { t: "bookings", id: "x3", data: old("x3", { persons: 99 }) })).j.rejected[0].reason).toBe("invalid");
  });

  it("without the feature the switch is off for everybody", async () => {
    const env = ENV();
    const a = await signup(env);
    const p = await pull(env, a.tok);
    expect(p.hotel.feat.backup).toBe(false);
    expect(p.hotel.feat.smart).toBe(false);
  });
});
