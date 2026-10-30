import { describe, expect, it } from "vitest";
import { ENV, addStaff, booking, call, push, room, signup } from "./helpers";

const ADMIN = { "x-admin-key": "admin-key-for-tests" };
const MENU = [
  { id: "m1", name: "Momo", price: 250, cat: "Meals", photo: "" },
  { id: "m2", name: "Tea", price: 40, cat: "Drinks" },
  { id: "m3", name: "Pizza", price: 600, cat: "Meals", off: true },
];

/** A hotel with one room that has a guest staying, a menu, and the guest-order feature switched on. */
async function hotel(on = true) {
  const env = ENV();
  const a = await signup(env);
  if (on) await call(env, `/admin/hotels/${a.hotel.id}/features`, { headers: ADMIN, body: { feat: { guestOrder: true } } });
  await push(env, a.tok, { t: "rooms", id: "101", data: room("101") }, { t: "hotel", id: "main", data: { name: "Hotel A", menu: MENU } });
  await push(env, a.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-10-01", 2) });
  await push(env, a.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-10-01", 2, { status: "occupied" }), ts: Date.now() + 1000 });
  const qr = on ? (await call(env, "/menu/qr", { token: a.tok })).j : null;
  const key = qr?.rooms.find((r: any) => r.n === "101")?.key as string;
  const g = (path: string, extra: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => call(env, "/guest" + path, { body: { code: a.hotel.code, room: "101", key, ...extra, ...over } });
  const orders = async (tok: string) => (await call(env, "/sync/pull?since=0", { token: tok })).j.changes.filter((c: any) => c.t === "orders");
  return { env, a, key, g, orders, code: a.hotel.code };
}
const step = (env: any, tok: string, o: any, stage: string, extra: Record<string, unknown> = {}) =>
  push(env, tok, { t: "orders", id: o.id, data: { ...o, stage, ...extra }, ts: Date.now() + 5000 });

describe("the QR code and the guest page", () => {
  it("opens with the right key, shows the menu with sold-out dishes marked, and nothing else", async () => {
    const { g, code } = await hotel();
    const r = await g("/open");
    expect(r.s).toBe(200);
    expect(r.j.hotel).toBe("Hotel A");
    expect(r.j.checkedIn).toBe(true);
    expect(r.j.guest).toBeUndefined(); // nobody who holds the QR learns who is staying
    expect(r.j.menu.map((m: any) => [m.id, m.off])).toEqual([["m1", false], ["m2", false], ["m3", true]]);
    expect(JSON.stringify(r.j)).not.toContain("payments");
    expect(code).toHaveLength(6);
  });

  it("refuses a wrong key, a key from another room, an unknown hotel and a hotel that has the feature off", async () => {
    const { g, env, a, key } = await hotel();
    expect((await g("/open", {}, { key: "0".repeat(20) })).s).toBe(404);
    await call(env, "/sync/push", { token: a.tok, body: { changes: [{ t: "rooms", id: "102", data: room("102"), ts: Date.now() }] } });
    expect((await g("/open", {}, { room: "102", key })).s).toBe(404); // the key belongs to room 101
    expect((await g("/open", {}, { code: "ZZZZZZ" })).s).toBe(404);
    await call(env, `/admin/hotels/${a.hotel.id}/features`, { headers: ADMIN, body: { feat: { guestOrder: false } } });
    expect((await g("/open")).s).toBe(403);
  });

  it("is off by default, and owners cannot switch it on themselves", async () => {
    const { env, a } = await hotel(false);
    expect((await call(env, "/menu/qr", { token: a.tok })).s).toBe(403);
    const me = await call(env, "/me", { token: a.tok });
    expect(me.j.hotel.feat.guestOrder).toBe(false);
  });

  it("locks out somebody who keeps guessing keys", async () => {
    const { g } = await hotel();
    for (let i = 0; i < 60; i++) await g("/open", {}, { key: String(i).padStart(20, "0") });
    expect((await g("/open", {}, { key: "1".repeat(20) })).s).toBe(429);
  });

  it("renewing the codes makes the printed ones stop working", async () => {
    const { g, env, a } = await hotel();
    expect((await g("/open")).s).toBe(200);
    expect((await call(env, "/menu/qr/renew", { token: a.tok, body: {} })).s).toBe(200);
    expect((await g("/open")).s).toBe(404);
    const fresh = (await call(env, "/menu/qr", { token: a.tok })).j;
    expect((await g("/open", {}, { key: fresh.rooms[0].key })).s).toBe(200);
  });

  it("only a person who may change settings can see the keys", async () => {
    const { env, a } = await hotel();
    const rec = await addStaff(env, a.tok, a.hotel.code, "rita", "reception");
    expect((await call(env, "/menu/qr", { token: rec.tok })).s).toBe(403);
    expect((await call(env, "/menu/qr/renew", { token: rec.tok, body: {} })).s).toBe(403);
  });
});

describe("ordering", () => {
  it("looking at the menu is never counted, so a whole hotel on one WiFi address is not locked out", async () => {
    const { g } = await hotel();
    for (let i = 0; i < 150; i++) expect((await g("/open")).s).toBe(200);
  });

  it("takes the price from the server, merges the same dish, and staff receive it as 'pending'", async () => {
    const { g, orders, a } = await hotel();
    const r = await g("/order", { items: [{ id: "m1", qty: 1, price: 1 }, { id: "m1", qty: 2 }, { id: "m2", qty: 1 }], note: "less spicy" });
    expect(r.s).toBe(200);
    expect(r.j.order.items).toEqual([{ name: "Momo", qty: 3, price: 250 }, { name: "Tea", qty: 1, price: 40 }]);
    const got = (await orders(a.tok))[0].data;
    expect(got).toMatchObject({ to: "Rb1", src: "guest", stage: "pending", done: false, billed: false, note: "less spicy" });
  });

  it("refuses sold-out, unknown, silly or too many dishes", async () => {
    const { g } = await hotel();
    expect((await g("/order", { items: [{ id: "m3", qty: 1 }] })).j.error).toBe("not_available");
    expect((await g("/order", { items: [{ id: "nope", qty: 1 }] })).j.error).toBe("not_available");
    for (const qty of [0, -1, 21, 1.5, "2"]) expect((await g("/order", { items: [{ id: "m2", qty }] })).s, String(qty)).toBe(400);
    expect((await g("/order", { items: [] })).s).toBe(400);
    expect((await g("/order", { items: [{ id: "m2", qty: 15 }, { id: "m2", qty: 15 }] })).s).toBe(400);
  });

  it("needs a guest in the room, and only three orders wait for approval at once", async () => {
    const e = await hotel();
    for (let i = 0; i < 3; i++) expect((await e.g("/order", { items: [{ id: "m2", qty: 1 }] })).s).toBe(200);
    expect((await e.g("/order", { items: [{ id: "m2", qty: 1 }] })).j.error).toBe("too_many_open");
    // a room with nobody staying
    await push(e.env, e.a.tok, { t: "rooms", id: "102", data: room("102") });
    const k2 = (await call(e.env, "/menu/qr", { token: e.a.tok })).j.rooms.find((r: any) => r.n === "102").key;
    const r = await e.g("/order", { items: [{ id: "m2", qty: 1 }] }, { room: "102", key: k2 });
    expect(r.s).toBe(403);
    expect(r.j.error).toBe("not_checked_in");
  });

  it("a guest only ever sees the orders of the room's current stay", async () => {
    const e = await hotel();
    await e.g("/order", { items: [{ id: "m2", qty: 1 }] });
    expect((await e.g("/open")).j.orders).toHaveLength(1);
    // check out: the next guest sees nothing of it
    await push(e.env, e.a.tok, { t: "bookings", id: "b1", data: booking("b1", "101", "2026-10-01", 2, { status: "done", billNo: "INV-1" }), ts: Date.now() + 9000 });
    const o = (await e.g("/open")).j;
    expect(o.checkedIn).toBe(false);
    expect(o.orders).toEqual([]);
  });

  it("staff cannot make a guest order themselves", async () => {
    const e = await hotel();
    const fake = { id: "g-x", to: "Rb1", items: [{ name: "Tea", qty: 1, price: 40 }], done: false, billed: false, at: 5, src: "guest", stage: "pending" };
    expect((await push(e.env, e.a.tok, { t: "orders", id: "g-x", data: fake })).j.rejected[0].reason).toBe("invalid");
    expect((await push(e.env, e.a.tok, { t: "orders", id: "g-y", data: { ...fake, id: "g-y", src: undefined, stage: "ready" } })).j.rejected[0].reason).toBe("invalid");
  });
});

describe("approve -> kitchen -> delivered", () => {
  async function ordered() {
    const e = await hotel();
    const rest = await addStaff(e.env, e.a.tok, e.code, "rest", "restaurant");
    const cook = await addStaff(e.env, e.a.tok, e.code, "cook", "kitchen");
    const rec = await addStaff(e.env, e.a.tok, e.code, "rita", "reception");
    const r = await e.g("/order", { items: [{ id: "m1", qty: 2 }] });
    const get = async () => (await e.orders(e.a.tok)).find((c: any) => c.id === r.j.order.id).data;
    return { ...e, rest, cook, rec, id: r.j.order.id as string, get };
  }

  it("goes through every stage in order, each step by the right person", async () => {
    const e = await ordered();
    // the kitchen cannot approve; the desk can
    expect((await step(e.env, e.cook.tok, await e.get(), "approved")).j.rejected[0].reason).toBe("forbidden");
    expect((await step(e.env, e.rest.tok, await e.get(), "approved")).j.accepted).toEqual([e.id]);
    // the desk cannot skip the kitchen's work and send it straight to delivered
    expect((await step(e.env, e.rest.tok, await e.get(), "delivered", { done: true })).j.rejected[0].reason).toBe("invalid");
    expect((await step(e.env, e.cook.tok, await e.get(), "cooking")).j.accepted).toEqual([e.id]);
    expect((await step(e.env, e.cook.tok, await e.get(), "ready")).j.accepted).toEqual([e.id]);
    // the guest says it arrived: complete
    const r = await e.g("/received", { id: e.id });
    expect(r.s).toBe(200);
    expect(r.j.order.stage).toBe("delivered");
    const done = await e.get();
    expect(done).toMatchObject({ stage: "delivered", done: true });
  });

  it("the guest cannot say 'received' before the kitchen says ready, nor for somebody else's order", async () => {
    const e = await ordered();
    expect((await e.g("/received", { id: e.id })).j.error).toBe("not_ready");
    await step(e.env, e.rest.tok, await e.get(), "approved");
    expect((await e.g("/received", { id: e.id })).j.error).toBe("not_ready");
    expect((await e.g("/received", { id: "does-not-exist" })).s).toBe(404);
  });

  it("an order can go forward only: no going back, no re-opening a refused order", async () => {
    const e = await ordered();
    await step(e.env, e.rest.tok, await e.get(), "approved");
    await step(e.env, e.cook.tok, await e.get(), "ready");
    expect((await step(e.env, e.rest.tok, await e.get(), "pending")).j.rejected[0].reason).toBe("invalid");
    expect((await step(e.env, e.rest.tok, await e.get(), "cooking")).j.rejected[0].reason).toBe("invalid");
    await e.g("/received", { id: e.id });
    expect((await step(e.env, e.rest.tok, await e.get(), "ready", { done: false })).j.rejected[0].reason).toBe("invalid");
  });

  it("the desk can refuse, and the guest sees it with the reason", async () => {
    const e = await ordered();
    expect((await step(e.env, e.rest.tok, await e.get(), "rejected", { reason: "Kitchen is closed" })).j.accepted).toEqual([e.id]);
    const seen = (await e.g("/open")).j.orders[0];
    expect(seen).toMatchObject({ stage: "rejected", reason: "Kitchen is closed" });
    expect((await e.g("/received", { id: e.id })).j.error).toBe("not_ready");
  });

  it("reception cannot approve or cook; a guest cannot be billed for food before it arrived", async () => {
    const e = await ordered();
    expect((await step(e.env, e.rec.tok, await e.get(), "approved")).j.rejected[0].reason).toBe("forbidden");
    await step(e.env, e.rest.tok, await e.get(), "approved");
    expect((await push(e.env, e.rest.tok, { t: "orders", id: e.id, data: { ...(await e.get()), billed: true }, ts: Date.now() + 7000 })).j.rejected[0].reason).toBe("invalid");
  });

  it("prices and dishes of a guest order cannot be edited once it is approved; the note never", async () => {
    const e = await ordered();
    const o = await e.get();
    expect((await push(e.env, e.rest.tok, { t: "orders", id: e.id, data: { ...o, note: "free food" }, ts: Date.now() + 5000 })).j.rejected[0].reason).toBe("invalid");
    // before approval the desk may change what is sent (a dish ran out)
    expect((await push(e.env, e.rest.tok, { t: "orders", id: e.id, data: { ...o, items: [{ name: "Momo", qty: 1, price: 250 }] }, ts: Date.now() + 5000 })).j.accepted).toEqual([e.id]);
    await step(e.env, e.rest.tok, await e.get(), "approved");
    expect((await push(e.env, e.rest.tok, { t: "orders", id: e.id, data: { ...(await e.get()), items: [{ name: "Momo", qty: 1, price: 1 }] }, ts: Date.now() + 9000 })).j.rejected[0].reason).toBe("invalid");
  });

  it("a guest may take back an order only while it is waiting", async () => {
    const e = await ordered();
    expect((await e.g("/cancel", { id: e.id })).s).toBe(200);
    expect((await e.get()).stage).toBe("rejected");
    const e2 = await ordered();
    await step(e2.env, e2.rest.tok, await e2.get(), "approved");
    expect((await e2.g("/cancel", { id: e2.id })).j.error).toBe("too_late");
  });

  it("orders made by staff keep working as before (no stage = approved)", async () => {
    const e = await ordered();
    const own = { id: "o9", to: "T1", items: [{ name: "Tea", qty: 1, price: 40 }], done: false, billed: false, at: 7 };
    expect((await push(e.env, e.rest.tok, { t: "orders", id: "o9", data: own })).j.accepted).toEqual(["o9"]);
    expect((await push(e.env, e.cook.tok, { t: "orders", id: "o9", data: { ...own, done: true }, ts: Date.now() + 3000 })).j.accepted).toEqual(["o9"]);
    expect((await push(e.env, e.cook.tok, { t: "orders", id: "o10", data: { ...own, id: "o10" } })).j.rejected[0].reason).toBe("forbidden"); // the kitchen does not take orders
    // the reception desk can put a finished order on a room bill
    expect((await push(e.env, e.rec.tok, { t: "orders", id: "o9", data: { ...own, done: true, billed: true, to: "Rb1" }, ts: Date.now() + 6000 })).j.accepted).toEqual(["o9"]);
  });
});

describe("menu photos", () => {
  const jpeg = (n = 1000) => {
    const b = new Uint8Array(n).fill(7);
    b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[n - 2] = 0xff; b[n - 1] = 0xd9;
    return btoa(String.fromCharCode(...b));
  };

  it("are stored, served to anyone with the hotel code, and can be removed", async () => {
    const { env, a, code } = await hotel();
    const up = await call(env, "/menu/photo", { token: a.tok, body: { data: jpeg() } });
    expect(up.s).toBe(200);
    const r = await env.DB.prepare("SELECT 1").first(); // keep the db handle alive
    expect(r).toBeTruthy();
    const img = await (await import("../src/index")).default.fetch(new Request(`http://api/guest/photo/${code}/${up.j.id}`), env as any, { waitUntil() {}, passThroughOnException() {} } as any);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await img.arrayBuffer())[0]).toBe(0xff);
    await call(env, "/menu/photo/delete", { token: a.tok, body: { id: up.j.id } });
    const gone = await (await import("../src/index")).default.fetch(new Request(`http://api/guest/photo/${code}/${up.j.id}`), env as any, { waitUntil() {}, passThroughOnException() {} } as any);
    expect(gone.status).toBe(404);
  });

  it("refuse anything that is not a small JPEG, and anyone without the right to change settings", async () => {
    const { env, a, code } = await hotel();
    const post = (tok: string, data: unknown) => call(env, "/menu/photo", { token: tok, body: { data } });
    expect((await post(a.tok, btoa("<html><script>alert(1)</script></html>".repeat(20)))).s).toBe(400);
    expect((await post(a.tok, btoa("GIF89a" + "x".repeat(400)))).s).toBe(400);
    expect((await post(a.tok, "not base64 !!")).s).toBe(400);
    expect((await post(a.tok, 5)).s).toBe(400);
    expect((await post(a.tok, jpeg(95_000))).s).toBe(400); // too big
    expect((await post(a.tok, jpeg(100))).s).toBe(400); // too small to be a picture
    const rec = await addStaff(env, a.tok, code, "rita", "reception");
    expect((await post(rec.tok, jpeg())).s).toBe(403);
  });

  it("stop at 100 photos per hotel", async () => {
    const { env, a } = await hotel();
    for (let i = 0; i < 100; i++) await env.DB.prepare("INSERT INTO menu_photos (hotel_id,id,data,created_at) VALUES (?,?,?,?)").bind(a.hotel.id, "p" + i, "x", 1).run();
    expect((await call(env, "/menu/photo", { token: a.tok, body: { data: jpeg() } })).j.error).toBe("limit");
  });
});

describe("a lost password", () => {
  it("the owner can reset a staff PIN, which signs that person out", async () => {
    const { env, a, code } = await hotel(false);
    const rita = await addStaff(env, a.tok, code, "rita", "reception");
    expect((await call(env, `/staff/${rita.id}`, { token: a.tok, body: { pin: "739150" } })).s).toBe(200);
    expect((await call(env, "/auth/staff", { body: { hotelCode: code, username: "rita", pin: rita.pin, device: rita.device } })).s).toBe(401);
    expect((await call(env, "/auth/staff", { body: { hotelCode: code, username: "rita", pin: "739150", device: rita.device } })).s).toBe(200);
    expect((await call(env, "/sync/pull?since=0", { token: rita.tok })).s).toBe(200); // the old token is a short one; the refresh was revoked
  });

  it("the admin makes a one-time code, and the owner chooses the new password with it", async () => {
    const { env, a } = await hotel(false);
    const r = await call(env, `/admin/hotels/${a.hotel.id}/recovery`, { headers: ADMIN, body: {} });
    expect(r.s).toBe(200);
    expect(r.j.email).toBe(a.email);
    expect(r.j.code).toMatch(/^\d{6}$/);
    expect((await call(env, "/auth/reset", { body: { email: a.email, code: "000000", password: "brand-new-pass" } })).s).toBe(401);
    expect((await call(env, "/auth/reset", { body: { email: a.email, code: r.j.code, password: "brand-new-pass" } })).s).toBe(200);
    expect((await call(env, "/auth/login", { body: { email: a.email, password: "brand-new-pass", device: a.device } })).s).toBe(200);
    expect((await call(env, "/auth/login", { body: { email: a.email, password: "secret-pass-1", device: a.device } })).s).toBe(401);
    // the code works once
    expect((await call(env, "/auth/reset", { body: { email: a.email, code: r.j.code, password: "another-pass-1" } })).s).toBe(401);
  });

  it("only the admin can make the code; an owner or a stranger cannot", async () => {
    const { env, a } = await hotel(false);
    expect((await call(env, `/admin/hotels/${a.hotel.id}/recovery`, { token: a.tok, body: {} })).s).toBe(403);
    expect((await call(env, `/admin/hotels/${a.hotel.id}/recovery`, { headers: { "x-admin-key": "wrong" }, body: {} })).s).toBe(403);
    expect((await call(env, `/admin/hotels/nope/recovery`, { headers: ADMIN, body: {} })).s).toBe(404);
  });
});
