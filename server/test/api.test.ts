import { describe, expect, it } from "vitest";
import { ENV, addStaff, booking, call, push, room, signup } from "./helpers";

describe("accounts and login", () => {
  it("signup needs a right email code, then login on a new device needs another", async () => {
    const env = ENV();
    const email = "a@example.com", device = { id: "device-aaaaaaa1", name: "p" };
    const o = await call(env, "/auth/otp", { body: { email, purpose: "signup" } });
    expect(o.j.devCode).toMatch(/^\d{6}$/);
    const body = { email, password: "secret-pass-1", name: "A", hotelName: "H", device };
    expect((await call(env, "/auth/signup", { body: { ...body, code: "000000" } })).s).toBe(401);
    expect((await call(env, "/auth/signup", { body: { ...body, code: o.j.devCode, password: "abc" } })).s).toBe(400);
    const ok = await call(env, "/auth/signup", { body: { ...body, code: o.j.devCode } });
    expect(ok.s).toBe(200);
    expect(ok.j.hotel.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(ok.j.user.role).toBe("owner");
    expect((await call(env, "/auth/otp", { body: { email, purpose: "signup" } })).s).toBe(409);
    const dev2 = { id: "device-bbbbbbb2", name: "p2" };
    const l1 = await call(env, "/auth/login", { body: { email, password: "secret-pass-1", device: dev2 } });
    expect(l1.s).toBe(401);
    expect(l1.j.error).toBe("otp_required");
    const l2 = await call(env, "/auth/login", { body: { email, password: "secret-pass-1", device: dev2, code: l1.j.devCode } });
    expect(l2.s).toBe(200);
    expect((await call(env, "/auth/login", { body: { email, password: "nope", device: dev2 } })).j.error).toBe("bad_login");
  });

  it("owner login locks after 8 wrong passwords", async () => {
    const env = ENV();
    const a = await signup(env);
    for (let i = 0; i < 8; i++) await call(env, "/auth/login", { body: { email: a.email, password: "wrong-wrong", device: a.device } });
    expect((await call(env, "/auth/login", { body: { email: a.email, password: "secret-pass-1", device: a.device } })).s).toBe(429);
  });

  it("refuses to run with a weak server secret", async () => {
    const env = { ...ENV(), JWT_SECRET: "short" };
    expect((await call(env, "/health")).s).toBe(500);
  });

  it("no token, bad token and tampered token are refused", async () => {
    const env = ENV();
    const a = await signup(env);
    expect((await call(env, "/me")).s).toBe(401);
    expect((await call(env, "/me", { token: "a.b.c" })).s).toBe(401);
    const parts = a.tok.split(".");
    const forged = parts[0] + "." + btoa(JSON.stringify({ sub: a.user.id, hotel: "other", dev: a.device.id, exp: 9999999999 })).replace(/=/g, "") + "." + parts[2];
    expect((await call(env, "/me", { token: forged })).s).toBe(401);
    expect((await call(env, "/me", { token: a.tok })).s).toBe(200);
  });

  it("security headers and CORS only for the app's own address", async () => {
    const env = ENV();
    const r = await call(env, "/health", { headers: { Origin: "http://evil.example" } });
    expect(r.h.get("access-control-allow-origin") ?? "").toBe("");
    expect(r.h.get("x-content-type-options")).toBe("nosniff");
    const ok = await call(env, "/health", { headers: { Origin: "http://localhost:5173" } });
    expect(ok.h.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

describe("staff and roles", () => {
  it("a phone first used by staff still makes the owner prove the email code", async () => {
    const env = ENV();
    const a = await signup(env);
    const s = await addStaff(env, a.tok, a.hotel.code, "desk9", "reception");
    const l = await call(env, "/auth/login", { body: { email: a.email, password: "secret-pass-1", device: s.device } });
    expect(l.s).toBe(401);
    expect(l.j.error).toBe("otp_required");
    const ok = await call(env, "/auth/login", { body: { email: a.email, password: "secret-pass-1", device: s.device, code: l.j.devCode } });
    expect(ok.s).toBe(200);
    expect((await call(env, "/auth/login", { body: { email: a.email, password: "secret-pass-1", device: s.device } })).s).toBe(200);
  });

  it("staff log in with hotel code, name and PIN; wrong PIN locks after 5", async () => {
    const env = ENV();
    const a = await signup(env);
    const s = await addStaff(env, a.tok, a.hotel.code, "sita.desk", "reception");
    expect((await call(env, "/me", { token: s.tok })).j.user.role).toBe("reception");
    const dev = { id: "device-staff-xx1", name: "p" };
    for (let i = 0; i < 5; i++) expect((await call(env, "/auth/staff", { body: { hotelCode: a.hotel.code, username: "sita.desk", pin: "999999", device: dev } })).s).toBe(401);
    expect((await call(env, "/auth/staff", { body: { hotelCode: a.hotel.code, username: "sita.desk", pin: s.pin, device: dev } })).s).toBe(429);
  });

  it("PIN must be 6 to 10 digits and not a weak one", async () => {
    const env = ENV();
    const a = await signup(env);
    for (const pin of ["1234", "123456", "abcdef", "11111111111"])
      expect((await call(env, "/staff", { token: a.tok, body: { name: "x", username: "xyz", role: "other", pin } })).s).toBe(400);
  });

  it("only people with 'staff.manage' can see or add staff", async () => {
    const env = ENV();
    const a = await signup(env);
    const r = await addStaff(env, a.tok, a.hotel.code, "recep1", "reception");
    expect((await call(env, "/staff", { token: r.tok })).s).toBe(403);
    expect((await call(env, "/staff", { token: r.tok, body: { name: "x", username: "xyz", role: "other", pin: "482915" } })).s).toBe(403);
    expect((await call(env, "/devices", { token: r.tok })).s).toBe(403);
    expect((await call(env, "/audit", { token: r.tok })).s).toBe(403);
    expect((await call(env, "/staff", { token: a.tok })).j.staff).toHaveLength(2);
  });

  it("a staff manager cannot give rights they do not have, nor edit the owner or themselves", async () => {
    const env = ENV();
    const a = await signup(env);
    const m = await addStaff(env, a.tok, a.hotel.code, "mgr1", "manager", ["staff.manage", "booking.create"]);
    const bad = await call(env, "/staff", { token: m.tok, body: { name: "x", username: "xyz", role: "other", pin: "482915", perms: ["prices.edit"] } });
    expect(bad.s).toBe(403);
    expect((await call(env, "/staff", { token: m.tok, body: { name: "x", username: "xyz", role: "reception", pin: "482915", perms: ["booking.create"] } })).s).toBe(200);
    expect((await call(env, `/staff/${a.user.id}`, { token: m.tok, body: { active: false } })).s).toBe(403);
    expect((await call(env, `/staff/${m.id}`, { token: m.tok, body: { perms: [...["staff.manage", "booking.create", "checkout"]] } })).s).toBe(403);
    expect((await call(env, "/staff", { token: m.tok, body: { name: "x", username: "boss", role: "owner", pin: "482915" } })).s).toBe(400);
  });

  it("turning a person off or changing the PIN signs them out at once", async () => {
    const env = ENV();
    const a = await signup(env);
    const s = await addStaff(env, a.tok, a.hotel.code, "waiter1", "restaurant");
    expect((await call(env, "/me", { token: s.tok })).s).toBe(200);
    await call(env, `/staff/${s.id}`, { token: a.tok, body: { active: false } });
    expect((await call(env, "/me", { token: s.tok })).s).toBe(403);
    expect((await call(env, "/auth/staff", { body: { hotelCode: a.hotel.code, username: "waiter1", pin: s.pin, device: s.device } })).s).toBe(401);
  });

  it("a revoked device is refused straight away", async () => {
    const env = ENV();
    const a = await signup(env);
    const s = await addStaff(env, a.tok, a.hotel.code, "waiter2", "restaurant");
    expect((await call(env, `/devices/${s.device.id}/revoke`, { token: a.tok, body: {} })).s).toBe(200);
    expect((await call(env, "/me", { token: s.tok })).s).toBe(403);
    expect((await call(env, "/auth/staff", { body: { hotelCode: a.hotel.code, username: "waiter2", pin: s.pin, device: s.device } })).s).toBe(403);
  });

  it("changed rights apply on the very next request", async () => {
    const env = ENV();
    const a = await signup(env);
    const s = await addStaff(env, a.tok, a.hotel.code, "desk2", "reception");
    expect((await push(env, s.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01") })).j.accepted).toEqual(["b1"]);
    await call(env, `/staff/${s.id}`, { token: a.tok, body: { perms: [] } });
    const r = await push(env, s.tok, { t: "bookings", id: "b2", data: booking("b2", "102", "2026-11-01") });
    expect(r.j.rejected[0].reason).toBe("forbidden");
  });
});

describe("what each role may change (sync)", () => {
  it("reception books and checks in, but cannot change prices, rooms or settings", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101") });
    const r = await addStaff(env, a.tok, a.hotel.code, "desk", "reception");
    expect((await push(env, r.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01") })).j.accepted).toEqual(["b1"]);
    const price = await push(env, r.tok, { t: "rooms", id: "101", data: room("101", { price: 100 }) });
    expect(price.j.rejected[0]).toMatchObject({ reason: "forbidden", server: { price: 2500 } });
    expect((await push(env, r.tok, { t: "rooms", id: "999", data: room("999") })).j.rejected[0].reason).toBe("forbidden");
    expect((await push(env, r.tok, { t: "hotel", id: "main", data: { name: "Mine" } })).j.rejected[0].reason).toBe("forbidden");
    expect((await push(env, r.tok, { t: "orders", id: "o1", data: { to: "T1" } })).j.rejected[0].reason).toBe("forbidden");
  });

  it("price changes by an allowed person are written to the log", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101") });
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101", { price: 3000 }), ts: Date.now() + 1000 });
    const log = (await call(env, "/audit", { token: a.tok })).j.audit;
    expect(log.some((x: any) => x.action === "price change" && x.detail.includes("2500 -> 3000"))).toBe(true);
  });

  it("housekeeping can mark a room clean and nothing else", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101", { st: "clean" }) });
    const h = await addStaff(env, a.tok, a.hotel.code, "hkeeper", "housekeeping");
    expect((await push(env, h.tok, { t: "rooms", id: "101", data: room("101", { st: "free" }), ts: Date.now() + 1000 })).j.accepted).toEqual(["101"]);
    expect((await push(env, h.tok, { t: "rooms", id: "101", data: room("101", { st: "out" }), ts: Date.now() + 2000 })).j.rejected[0].reason).toBe("forbidden");
    expect((await push(env, h.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01") })).j.rejected[0].reason).toBe("forbidden");
  });

  it("cancel needs its own right; reopening a closed bill is owner-only", async () => {
    const env = ENV();
    const a = await signup(env);
    const r = await addStaff(env, a.tok, a.hotel.code, "desk", "reception");
    await push(env, a.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01") });
    const t1 = Date.now() + 1000;
    expect((await push(env, r.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01", 2, { status: "cancelled" }), ts: t1 })).j.rejected[0].reason).toBe("forbidden");
    await push(env, a.tok, { t: "bookings", id: "b2", data: booking("b2", "102", "2026-11-01") });
    await push(env, r.tok, { t: "bookings", id: "b2", data: booking("b2", "102", "2026-11-01", 2, { status: "occupied" }), ts: t1 });
    await push(env, r.tok, { t: "bookings", id: "b2", data: booking("b2", "102", "2026-11-01", 2, { status: "done", billNo: "INV-0001" }), ts: t1 + 1 });
    const reopen = await push(env, r.tok, { t: "bookings", id: "b2", data: booking("b2", "102", "2026-11-01", 2, { status: "occupied", billNo: "INV-0001" }), ts: t1 + 2 });
    expect(reopen.j.rejected[0].reason).toBe("forbidden");
    // the owner may reopen it, and it is written to the log
    expect((await push(env, a.tok, { t: "bookings", id: "b2", data: booking("b2", "102", "2026-11-01", 2, { status: "occupied", billNo: "INV-0001" }), ts: t1 + 3 })).j.accepted).toEqual(["b2"]);
    expect((await call(env, "/audit", { token: a.tok })).j.audit.some((x: any) => x.action === "reopened")).toBe(true);
  });

  it("cancelled bookings and no-shows are recorded in the log with who did it", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01") });
    await push(env, a.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01", 2, { status: "cancelled", cancelReason: "guest called" }), ts: Date.now() + 1000 });
    const log = (await call(env, "/audit", { token: a.tok })).j.audit;
    expect(log[0]).toMatchObject({ action: "cancelled", user: "Owner" });
    expect(log[0].detail).toContain("guest called");
  });

  it("people without money rights never see payments and cannot erase them", async () => {
    const env = ENV();
    const a = await signup(env);
    const pay = [{ id: "p1", method: "cash", amount: 1000, at: 1, kind: "advance" }];
    await push(env, a.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01", 2, { status: "booked", payments: pay }) });
    const w = await addStaff(env, a.tok, a.hotel.code, "waiter", "restaurant");
    const seen = (await call(env, "/sync/pull?since=0", { token: w.tok })).j.changes[0].data;
    expect(seen.payments).toEqual([]);
    // the waiter's phone pushes the booking back (for example with food added) with no payments in it
    const food = [{ name: "Tea", qty: 1, price: 40 }];
    const up = await push(env, w.tok, { t: "bookings", id: "b1", data: { ...seen, food }, ts: Date.now() + 1000 });
    expect(up.j.accepted).toEqual(["b1"]);
    const owner = (await call(env, "/sync/pull?since=0", { token: a.tok })).j.changes[0].data;
    expect(owner.payments).toEqual(pay);
    expect(owner.food).toEqual(food);
  });

  it("restaurant orders are refused when the admin switched the feature off", async () => {
    const env = ENV();
    const a = await signup(env);
    const w = await addStaff(env, a.tok, a.hotel.code, "waiter", "restaurant");
    expect((await push(env, w.tok, { t: "orders", id: "o1", data: { to: "T1", items: [] } })).j.accepted).toEqual(["o1"]);
    await call(env, `/admin/hotels/${a.hotel.id}/features`, { headers: { "x-admin-key": "admin-key-for-tests" }, body: { feat: { restaurant: false } } });
    expect((await push(env, w.tok, { t: "orders", id: "o2", data: { to: "T1", items: [] } })).j.rejected[0].reason).toBe("feature_off");
  });

  it("garbage input is refused", async () => {
    const env = ENV();
    const a = await signup(env);
    expect((await call(env, "/sync/push", { token: a.tok, body: { changes: [] } })).s).toBe(400);
    expect((await call(env, "/sync/push", { token: a.tok, body: { changes: [{ t: "users", id: "x", data: {}, ts: 1 }] } })).s).toBe(400);
    expect((await call(env, "/sync/push", { token: a.tok, body: { changes: [{ t: "rooms", id: "x", data: [], ts: 1 }] } })).s).toBe(400);
    expect((await push(env, a.tok, { t: "bookings", id: "b", data: booking("b", "101", "not-a-date") })).j.rejected[0].reason).toBe("invalid");
    expect((await push(env, a.tok, { t: "bookings", id: "b", data: booking("b", "101", "2026-11-01", -3) })).j.rejected[0].reason).toBe("invalid");
    expect((await push(env, a.tok, { t: "bookings", id: "b", data: booking("b", "101", "2026-11-01", 2, { status: "done" }) })).j.rejected[0].reason).toBe("invalid");
  });
});

describe("login history", () => {
  it("records who signed in from which device, also wrong tries, and shortens the address", async () => {
    const env = ENV();
    const a = await signup(env);
    const s = await addStaff(env, a.tok, a.hotel.code, "waiter", "restaurant");
    const dev = { id: "device-bad-try-1", name: "Android" };
    await call(env, "/auth/staff", { body: { hotelCode: a.hotel.code, username: "waiter", pin: "999999", device: dev }, headers: { "CF-Connecting-IP": "203.0.113.77", "cf-ipcountry": "NP" } });
    await call(env, "/auth/login", { body: { email: a.email, password: "wrong-pass-9", device: dev } });
    const l = (await call(env, "/logins", { token: a.tok })).j.logins as any[];
    expect(l.map((x) => x.kind + ":" + x.ok)).toEqual(expect.arrayContaining(["signup:1", "staff:1", "staff:0", "owner:0"]));
    const bad = l.find((x) => x.kind === "staff" && !x.ok);
    expect(bad).toMatchObject({ who: "waiter", reason: "wrong PIN", device_name: "Android", ip: "203.0.113.x", country: "NP" });
    expect(l.find((x) => x.kind === "staff" && x.ok).reason).toBe("new device");
    expect(JSON.stringify(l)).not.toContain("482915"); // never the PIN or password
    expect(JSON.stringify(l)).not.toContain("999999");
    expect(JSON.stringify(l)).not.toContain("secret-pass-1");
    expect(s.id).toBeTruthy();
  });
  it("only the owner can read it, and each hotel sees only its own", async () => {
    const env = ENV();
    const a = await signup(env, "A");
    const b = await signup(env, "B");
    const mgr = await addStaff(env, a.tok, a.hotel.code, "mgr", "manager");
    expect((await call(env, "/logins", { token: mgr.tok })).s).toBe(403);
    expect((await call(env, "/logins")).s).toBe(401);
    const lb = (await call(env, "/logins", { token: b.tok })).j.logins as any[];
    expect(lb).toHaveLength(1);
    expect(lb[0].who).toBe(b.email);
  });
  it("the admin can read a hotel's history with the key, and it is erased with the hotel", async () => {
    const env = ENV();
    const H = { "x-admin-key": "admin-key-for-tests" };
    const a = await signup(env);
    expect((await call(env, `/admin/hotels/${a.hotel.id}/logins`, { token: a.tok })).s).toBe(403);
    expect(((await call(env, `/admin/hotels/${a.hotel.id}/logins`, { headers: H })).j.logins as any[]).length).toBe(1);
    const id = (await call(env, "/account/closure", { token: a.tok, body: { reasonCode: "not_using", password: "secret-pass-1" } })).j.request.id;
    await call(env, `/admin/closures/${id}/approve`, { headers: H, body: { graceDays: 0 } });
    await call(env, "/admin/run-deletions", { headers: H, body: {} });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM login_events").first<any>()).n).toBe(0);
  });
});

describe("deleting rooms and the menu", () => {
  it("only people who manage rooms can delete one, and a room with a booking cannot be deleted", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101") }, { t: "rooms", id: "102", data: room("102") });
    const desk = await addStaff(env, a.tok, a.hotel.code, "desk", "reception");
    const t1 = Date.now() + 1000;
    expect((await push(env, desk.tok, { t: "rooms", id: "101", data: room("101", { deleted: true }), ts: t1 })).j.rejected[0].reason).toBe("forbidden");
    await push(env, a.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-11-01") });
    expect((await push(env, a.tok, { t: "rooms", id: "101", data: room("101", { deleted: true }), ts: t1 })).j.rejected[0].reason).toBe("in_use");
    expect((await push(env, a.tok, { t: "rooms", id: "102", data: room("102", { deleted: true }), ts: t1 })).j.accepted).toEqual(["102"]);
    // the room is only hidden: it is still there for old bills
    const p = (await call(env, "/sync/pull?since=0", { token: a.tok })).j.changes.find((x: any) => x.id === "102");
    expect(p.data.deleted).toBe(true);
  });

  it("the menu is part of the hotel settings: owner can change it, reception cannot, and bad menus are refused", async () => {
    const env = ENV();
    const a = await signup(env);
    const menu = [{ id: "m1", name: "Thali", price: 400, cat: "Meals" }];
    expect((await push(env, a.tok, { t: "hotel", id: "main", data: { name: "H", menu } })).j.accepted).toEqual(["main"]);
    expect((await call(env, "/sync/pull?since=0", { token: a.tok })).j.changes[0].data.menu).toEqual(menu);
    const desk = await addStaff(env, a.tok, a.hotel.code, "desk", "reception");
    expect((await push(env, desk.tok, { t: "hotel", id: "main", data: { name: "H", menu: [] }, ts: Date.now() + 1000 })).j.rejected[0].reason).toBe("forbidden");
    for (const bad of ["x", [{ id: "a", name: "n", price: -5, cat: "" }], [{ id: "a", name: 5, price: 1, cat: "" }], Array.from({ length: 301 }, (_, i) => ({ id: "i" + i, name: "n", price: 1, cat: "" }))])
      expect((await push(env, a.tok, { t: "hotel", id: "main", data: { name: "H", menu: bad }, ts: Date.now() + 2000 })).j.rejected[0].reason).toBe("invalid");
  });
});

describe("one hotel cannot see or touch another", () => {
  it("records, conflicts, staff, devices and audit stay inside each hotel", async () => {
    const env = ENV();
    const a = await signup(env, "Hotel A");
    const b = await signup(env, "Hotel B");
    await push(env, a.tok, { t: "bookings", id: "same-id", data: booking("same-id", "101", "2026-11-01", 2, { guest: "Secret guest of A" }) });
    await push(env, b.tok, { t: "bookings", id: "same-id", data: booking("same-id", "101", "2026-11-01", 2, { guest: "Guest of B" }) });
    const pa = (await call(env, "/sync/pull?since=0", { token: a.tok })).j.changes;
    const pb = (await call(env, "/sync/pull?since=0", { token: b.tok })).j.changes;
    expect(pa).toHaveLength(1);
    expect(pb).toHaveLength(1);
    expect(pa[0].data.guest).toBe("Secret guest of A");
    expect(pb[0].data.guest).toBe("Guest of B");
    expect(JSON.stringify(pb)).not.toContain("Secret");
    expect((await call(env, "/sync/conflicts", { token: b.tok })).j.conflicts).toEqual([]);
    expect((await call(env, "/staff", { token: b.tok })).j.staff).toHaveLength(1);
    expect((await call(env, `/devices/${a.device.id}/revoke`, { token: b.tok, body: {} })).s).toBe(404);
    expect((await call(env, "/me", { token: a.tok })).s).toBe(200);
    expect((await call(env, "/audit", { token: b.tok })).j.audit.every((x: any) => !x.detail.includes("Secret"))).toBe(true);
  });

  it("staff of one hotel cannot sign in to another with the wrong hotel code", async () => {
    const env = ENV();
    const a = await signup(env, "Hotel A");
    const b = await signup(env, "Hotel B");
    await addStaff(env, a.tok, a.hotel.code, "same.name", "reception", undefined, "482915");
    const r = await call(env, "/auth/staff", { body: { hotelCode: b.hotel.code, username: "same.name", pin: "482915", device: { id: "device-xxxxxx9", name: "p" } } });
    expect(r.s).toBe(401);
  });

  it("one hotel cannot take over another hotel's device id", async () => {
    const env = ENV();
    const a = await signup(env, "Hotel A");
    const email = "b@example.com";
    const o = await call(env, "/auth/otp", { body: { email, purpose: "signup" } });
    const r = await call(env, "/auth/signup", { body: { email, code: o.j.devCode, password: "secret-pass-1", name: "B", hotelName: "B", device: a.device } });
    expect(r.s).toBe(409);
    expect(r.j.error).toBe("device_conflict");
    const b = await signup(env, "Hotel B");
    const s = await call(env, "/auth/staff", { body: { hotelCode: b.hotel.code, username: "nobody", pin: "482915", device: a.device } });
    expect(s.s).toBe(401);
    await addStaff(env, b.tok, b.hotel.code, "bstaff", "other");
    const steal = await call(env, "/auth/staff", { body: { hotelCode: b.hotel.code, username: "bstaff", pin: "482915", device: a.device } });
    expect(steal.s).toBe(409);
  });

  it("the owner of one hotel cannot reach the admin routes", async () => {
    const env = ENV();
    const a = await signup(env);
    expect((await call(env, "/admin/hotels", { token: a.tok })).s).toBe(403);
    expect((await call(env, "/admin/hotels", { headers: { "x-admin-key": "wrong" } })).s).toBe(403);
  });
});

describe("sync rules", () => {
  it("newest edit wins, record by record; an older edit changes nothing", async () => {
    const env = ENV();
    const a = await signup(env);
    const t = Date.now();
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101", { price: 3000 }), ts: t + 2000 });
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101", { price: 1000 }), ts: t + 1000 });
    expect((await call(env, "/sync/pull?since=0", { token: a.tok })).j.changes[0].data.price).toBe(3000);
  });

  it("a phone with a wrong clock cannot win every future edit", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101", { price: 1 }), ts: Date.now() + 10 * 365 * 86400000 });
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101", { price: 2 }), ts: Date.now() + 6 * 60_000 });
    const c = (await call(env, "/sync/pull?since=0", { token: a.tok })).j.changes[0];
    expect(c.ts).toBeLessThan(Date.now() + 6 * 60_000);
    expect(c.data.price).toBe(2);
  });

  it("pull gives only what is new since the last number", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101") }, { t: "rooms", id: "102", data: room("102") });
    const p1 = (await call(env, "/sync/pull?since=0", { token: a.tok })).j;
    expect(p1.changes).toHaveLength(2);
    await push(env, a.tok, { t: "rooms", id: "103", data: room("103") });
    const p2 = (await call(env, `/sync/pull?since=${p1.next}`, { token: a.tok })).j;
    expect(p2.changes.map((x: any) => x.id)).toEqual(["103"]);
  });

  it("two phones book the same room offline: both kept, clash shown, older booking keeps the room, moving fixes it", async () => {
    const env = ENV();
    const a = await signup(env);
    const p1 = await addStaff(env, a.tok, a.hotel.code, "desk1", "reception");
    const p2 = await addStaff(env, a.tok, a.hotel.code, "desk2", "reception");
    const t = Date.now();
    await push(env, p1.tok, { t: "bookings", id: "late", data: booking("late", "101", "2026-11-02", 2, { guest: "Second", createdAt: t + 5000 }) });
    await push(env, p2.tok, { t: "bookings", id: "early", data: booking("early", "101", "2026-11-01", 2, { guest: "First", createdAt: t }) });
    const c = (await call(env, "/sync/conflicts", { token: a.tok })).j.conflicts;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "double_booking", keep: "early", move: "late" });
    const all = (await call(env, "/sync/pull?since=0", { token: a.tok })).j.changes;
    expect(all.map((x: any) => x.id).sort()).toEqual(["early", "late"]);
    await push(env, p1.tok, { t: "bookings", id: "late", data: booking("late", "102", "2026-11-02", 2, { guest: "Second", createdAt: t + 5000 }), ts: Date.now() + 1000 });
    expect((await call(env, "/sync/conflicts", { token: a.tok })).j.conflicts).toEqual([]);
  });

  it("back-to-back stays and cancelled bookings are not clashes", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "bookings", id: "x", data: booking("x", "101", "2026-11-01", 2) });
    await push(env, a.tok, { t: "bookings", id: "y", data: booking("y", "101", "2026-11-03", 2) });
    await push(env, a.tok, { t: "bookings", id: "z", data: booking("z", "101", "2026-11-01", 5, { status: "cancelled" }) });
    expect((await call(env, "/sync/conflicts", { token: a.tok })).j.conflicts).toEqual([]);
  });

  it("the same bill number on two bookings is flagged", async () => {
    const env = ENV();
    const a = await signup(env);
    for (const id of ["p", "q"]) {
      await push(env, a.tok, { t: "bookings", id, data: booking(id, id === "p" ? "101" : "102", "2026-11-01") });
      await push(env, a.tok, { t: "bookings", id, data: booking(id, id === "p" ? "101" : "102", "2026-11-01", 2, { status: "occupied" }), ts: Date.now() + 1000 });
      await push(env, a.tok, { t: "bookings", id, data: booking(id, id === "p" ? "101" : "102", "2026-11-01", 2, { status: "done", billNo: "INV-0001" }), ts: Date.now() + 2000 });
    }
    const c = (await call(env, "/sync/conflicts", { token: a.tok })).j.conflicts;
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe("duplicate_bill_no");
  });

  it("the owner cannot turn on features through the settings record", async () => {
    const env = ENV();
    const a = await signup(env);
    await push(env, a.tok, { t: "hotel", id: "main", data: { name: "My Hotel", feat: { email: true, ical: true, publicLink: true }, invoiceSeq: 99 } });
    const p = (await call(env, "/sync/pull?since=0", { token: a.tok })).j;
    expect(p.hotel.feat.email).toBe(false);
    expect(p.changes[0].data.feat).toBeUndefined();
    expect(p.changes[0].data.invoiceSeq).toBeUndefined();
  });
});

describe("admin and closing an account", () => {
  const H = { "x-admin-key": "admin-key-for-tests" };
  it("admin switches features per hotel; the hotel sees them on its next pull", async () => {
    const env = ENV();
    const a = await signup(env, "Hotel A");
    const b = await signup(env, "Hotel B");
    const r = await call(env, `/admin/hotels/${a.hotel.id}/features`, { headers: H, body: { feat: { email: true, housekeeping: false, nonsense: true } } });
    expect(r.j.feat).toMatchObject({ email: true, housekeeping: false });
    expect(r.j.feat.nonsense).toBeUndefined();
    expect((await call(env, "/sync/pull?since=0", { token: a.tok })).j.hotel.feat.email).toBe(true);
    expect((await call(env, "/sync/pull?since=0", { token: b.tok })).j.hotel.feat.email).toBe(false);
    const list = (await call(env, "/admin/hotels?q=Hotel%20A", { headers: H })).j.hotels;
    expect(list).toHaveLength(1);
  });

  it("wrong admin keys lock that address after 10 tries", async () => {
    const env = ENV();
    for (let i = 0; i < 10; i++) await call(env, "/admin/stats", { headers: { "x-admin-key": "no" + i } });
    expect((await call(env, "/admin/stats", { headers: H })).s).toBe(429);
  });

  it("closing: needs the owner's password, admin approves, data is erased after the date, and cancelling works", async () => {
    const env = ENV();
    const a = await signup(env, "Gone Hotel");
    const w = await addStaff(env, a.tok, a.hotel.code, "waiter", "restaurant");
    await push(env, a.tok, { t: "rooms", id: "101", data: room("101") });
    expect((await call(env, "/account/closure", { token: w.tok, body: { reasonCode: "not_using", password: "secret-pass-1" } })).s).toBe(403);
    expect((await call(env, "/account/closure", { token: a.tok, body: { reasonCode: "not_using", password: "wrong-password" } })).s).toBe(403);
    expect((await call(env, "/account/closure", { token: a.tok, body: { reasonCode: "other", password: "secret-pass-1" } })).j.error).toBe("reason_needed");
    const q = await call(env, "/account/closure", { token: a.tok, body: { reasonCode: "not_using", password: "secret-pass-1" } });
    expect(q.s).toBe(200);
    expect((await call(env, "/account/closure", { token: a.tok, body: { reasonCode: "not_using", password: "secret-pass-1" } })).s).toBe(409);
    expect((await call(env, "/account/closure/cancel", { token: a.tok, body: {} })).s).toBe(200);
    const q2 = await call(env, "/account/closure", { token: a.tok, body: { reasonCode: "privacy", password: "secret-pass-1" } });
    const id = q2.j.request.id;
    expect((await call(env, `/admin/closures/${id}/approve`, { headers: H, body: { graceDays: 14 } })).s).toBe(200);
    expect((await call(env, "/admin/run-deletions", { headers: H, body: {} })).j.deleted).toBe(0);
    expect((await call(env, "/sync/pull?since=0", { token: a.tok })).j.changes).toHaveLength(1);
    // now pretend the date has come
    await env.DB.prepare("UPDATE closure_requests SET scheduled_at=1").run();
    expect((await call(env, "/admin/run-deletions", { headers: H, body: {} })).j.deleted).toBe(1);
    expect((await call(env, "/me", { token: a.tok })).s).toBe(403);
    expect((await call(env, "/me", { token: w.tok })).s).toBe(403);
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM records) AS r,(SELECT COUNT(*) FROM users) AS u,(SELECT COUNT(*) FROM hotels) AS h,(SELECT COUNT(*) FROM devices) AS d").first<any>();
    expect(left).toEqual({ r: 0, u: 0, h: 0, d: 0 });
    const kept = (await call(env, "/admin/closures", { headers: H })).j.requests;
    expect(kept.find((x: any) => x.id === id)).toMatchObject({ status: "done", hotel_name: "(deleted)" });
    expect(kept.find((x: any) => x.id === id).owner_email).toMatch(/^deleted:/);
  });

  it("deleting one hotel leaves another untouched", async () => {
    const env = ENV();
    const a = await signup(env, "A");
    const b = await signup(env, "B");
    await push(env, b.tok, { t: "rooms", id: "101", data: room("101") });
    const id = (await call(env, "/account/closure", { token: a.tok, body: { reasonCode: "not_using", password: "secret-pass-1" } })).j.request.id;
    await call(env, `/admin/closures/${id}/approve`, { headers: H, body: { graceDays: 0 } });
    await call(env, "/admin/run-deletions", { headers: H, body: {} });
    expect((await call(env, "/sync/pull?since=0", { token: b.tok })).j.changes).toHaveLength(1);
  });
});
