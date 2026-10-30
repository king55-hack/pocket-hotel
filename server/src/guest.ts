import { Hono, type Context } from "hono";
import { audit, bad, body, need, type App } from "./util";
import { safeEqual, sha256 } from "./crypto";
import { featOf } from "./perms";
import type { Env } from "./mail";

/**
 * Food orders from a room. A guest scans the QR code stuck in the room; the code holds the hotel code, the room and a key.
 * The key is worked out from a server secret, so nothing about keys is stored and a key cannot be guessed.
 * Guests are not signed in, so everything here is checked again: the key, that the room has a guest staying,
 * that the dishes are on the menu (the price always comes from the server) and how many orders are open.
 */
export const guest = new Hono<App>();
/** Owner-side tools: menu photos and the QR codes. Needs a signed-in person with the right to change settings. */
export const menu = new Hono<App>();

const MAX_LINES = 30, MAX_QTY = 20, MAX_OPEN = 6, MAX_PENDING = 3, MAX_TOTAL = 100_000;
const MAX_PHOTO = 90_000, MAX_PHOTOS = 100;
const cap = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

export const qrKey = async (env: Env, hotelId: string, epoch: number, room: string) =>
  (await sha256(`${env.JWT_SECRET}:qr:${hotelId}:${epoch}:${room}`)).slice(0, 20);

async function tooMany(env: Env, key: string, max: number, ms: number) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key=? AND at>?").bind(key, Date.now() - ms).first<{ n: number }>();
  return (r?.n ?? 0) >= max;
}
const note = (env: Env, key: string) => env.DB.prepare("INSERT INTO login_attempts (key,at) VALUES (?,?)").bind(key, Date.now()).run();

type Ctx = { hotelId: string; hotelName: string; room: string; bookingId: string | null; menu: any[] };

/** Checks who is asking. Returns the hotel, the room, the guest staying there and the menu, or an error to send back. */
async function open(c: Context<App>, b: any, write = false): Promise<Ctx | { err: string; status: 400 | 403 | 404 | 429 }> {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (!b || typeof b.code !== "string" || typeof b.room !== "string" || typeof b.key !== "string" || b.code.length > 12 || b.room.length > 30 || b.key.length > 40) return { err: "invalid", status: 400 };
  // Hotel WiFi gives every guest the same address, so looking at the menu is never counted. Only wrong keys and real orders are.
  if (await tooMany(c.env, "guestbad:" + ip, 60, 15 * 60_000)) return { err: "locked", status: 429 };
  if (write) {
    if (await tooMany(c.env, "guest:" + ip, 120, 3600_000)) return { err: "rate", status: 429 };
    await note(c.env, "guest:" + ip);
  }
  if (Math.random() < 0.02) await c.env.DB.prepare("DELETE FROM login_attempts WHERE key LIKE 'guest%' AND at<?").bind(Date.now() - 86400_000).run();
  const h = await c.env.DB.prepare("SELECT id,name,feat,qr_epoch FROM hotels WHERE code=?").bind(b.code.trim().toUpperCase()).first<any>();
  const wrong = async () => { await note(c.env, "guestbad:" + ip); return { err: "bad_qr", status: 404 as const }; };
  if (!h) return wrong();
  if (!safeEqual(await qrKey(c.env, h.id, h.qr_epoch, b.room), b.key)) return wrong();
  const feat = featOf(h.feat);
  if (!feat.guestOrder || !feat.restaurant) return { err: "off", status: 403 };
  const room = await c.env.DB.prepare("SELECT data FROM records WHERE hotel_id=? AND tbl='rooms' AND id=?").bind(h.id, b.room).first<any>();
  if (!room || JSON.parse(room.data).deleted) return wrong();
  const bk = await c.env.DB.prepare("SELECT id,data FROM records WHERE hotel_id=? AND tbl='bookings' AND json_extract(data,'$.room')=? AND json_extract(data,'$.status')='occupied' ORDER BY updated_at DESC LIMIT 1").bind(h.id, b.room).first<any>();
  const hotel = await c.env.DB.prepare("SELECT data FROM records WHERE hotel_id=? AND tbl='hotel' AND id='main'").bind(h.id).first<any>();
  const items = hotel ? JSON.parse(hotel.data).menu : [];
  return { hotelId: h.id, hotelName: h.name, room: b.room, bookingId: bk?.id ?? null, menu: Array.isArray(items) ? items : [] };
}

const view = (o: any) => ({ id: o.id, items: o.items, stage: o.stage ?? "approved", at: o.at, note: o.note ?? "", reason: o.reason ?? "" });

async function myOrders(env: Env, x: Ctx) {
  if (!x.bookingId) return [];
  const r = await env.DB.prepare("SELECT data FROM records WHERE hotel_id=? AND tbl='orders' AND json_extract(data,'$.to')=? AND json_extract(data,'$.src')='guest' ORDER BY updated_at DESC LIMIT 20").bind(x.hotelId, "R" + x.bookingId).all<{ data: string }>();
  return r.results.map((z) => view(JSON.parse(z.data)));
}

/** Writes an order the way /sync/push would, so every staff phone receives it on its next pull. */
async function put(env: Env, hotelId: string, id: string, data: Record<string, unknown>, atLeast: number) {
  const ts = Math.max(Date.now(), atLeast + 1);
  const end = (await env.DB.prepare("UPDATE hotels SET seq=seq+1 WHERE id=? RETURNING seq").bind(hotelId).first<{ seq: number }>())!.seq;
  await env.DB.prepare(
    `INSERT INTO records (hotel_id,tbl,id,data,updated_at,seq,device_id,uniq) VALUES (?,'orders',?,?,?,?, 'guest', NULL)
     ON CONFLICT(hotel_id,tbl,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,seq=excluded.seq,device_id=excluded.device_id`,
  ).bind(hotelId, id, JSON.stringify(data), ts, end).run();
}

const fail = (c: Context<App>, e: { err: string; status: 400 | 403 | 404 | 429 }) => bad(c, e.status, e.err);

guest.post("/open", async (c) => {
  const x = await open(c, await body(c));
  if ("err" in x) return fail(c, x);
  return c.json({
    hotel: x.hotelName, room: x.room, checkedIn: !!x.bookingId,
    menu: x.menu.map((m) => ({ id: m.id, name: m.name, price: m.price, cat: m.cat || "", photo: m.photo || "", off: !!m.off })),
    orders: await myOrders(c.env, x),
  });
});

guest.post("/order", async (c) => {
  const b = await body(c);
  const x = await open(c, b, true);
  if ("err" in x) return fail(c, x);
  if (!x.bookingId) return bad(c, 403, "not_checked_in");
  const want = Array.isArray(b.items) ? b.items : null;
  if (!want || !want.length || want.length > MAX_LINES) return bad(c, 400, "invalid");
  const lines = new Map<string, { name: string; qty: number; price: number }>();
  for (const w of want) {
    const m = x.menu.find((z) => z && z.id === w?.id);
    if (!m || m.off) return bad(c, 400, "not_available");
    if (!Number.isInteger(w.qty) || w.qty < 1 || w.qty > MAX_QTY) return bad(c, 400, "invalid");
    const l = lines.get(m.id) ?? { name: m.name, qty: 0, price: m.price };
    l.qty += w.qty;
    if (l.qty > MAX_QTY) return bad(c, 400, "invalid");
    lines.set(m.id, l);
  }
  const items = [...lines.values()];
  if (items.reduce((s, l) => s + l.qty * l.price, 0) > MAX_TOTAL) return bad(c, 400, "too_big");
  const open_ = (await myOrders(c.env, x)).filter((o) => o.stage !== "delivered" && o.stage !== "rejected");
  if (open_.length >= MAX_OPEN || open_.filter((o) => o.stage === "pending").length >= MAX_PENDING) return bad(c, 429, "too_many_open");
  const id = "g-" + crypto.randomUUID(), now = Date.now();
  const data = { id, to: "R" + x.bookingId, items, done: false, billed: false, at: now, src: "guest", stage: "pending", note: cap(b.note, 200) };
  await put(c.env, x.hotelId, id, data, 0);
  return c.json({ ok: true, order: view(data) });
});

async function mine(c: Context<App>, b: any, x: Ctx) {
  if (typeof b.id !== "string" || b.id.length > 64 || !x.bookingId) return null;
  const r = await c.env.DB.prepare("SELECT data,updated_at FROM records WHERE hotel_id=? AND tbl='orders' AND id=?").bind(x.hotelId, b.id).first<any>();
  if (!r) return null;
  const o = JSON.parse(r.data);
  return o.src === "guest" && o.to === "R" + x.bookingId ? { o, at: r.updated_at as number } : null;
}

/** The guest has the food in the room: the order is complete. Only works once the kitchen says it is ready. */
guest.post("/received", async (c) => {
  const b = await body(c);
  const x = await open(c, b, true);
  if ("err" in x) return fail(c, x);
  const m = await mine(c, b, x);
  if (!m) return bad(c, 404, "not_found");
  if (m.o.stage !== "ready") return bad(c, 409, "not_ready");
  const o = { ...m.o, stage: "delivered", done: true, deliveredAt: Date.now() };
  await put(c.env, x.hotelId, o.id, o, m.at);
  return c.json({ ok: true, order: view(o) });
});

/** A guest may take back an order the restaurant has not looked at yet. */
guest.post("/cancel", async (c) => {
  const b = await body(c);
  const x = await open(c, b, true);
  if ("err" in x) return fail(c, x);
  const m = await mine(c, b, x);
  if (!m) return bad(c, 404, "not_found");
  if (m.o.stage !== "pending") return bad(c, 409, "too_late");
  const o = { ...m.o, stage: "rejected", reason: "guest" };
  await put(c.env, x.hotelId, o.id, o, m.at);
  return c.json({ ok: true, order: view(o) });
});

guest.get("/photo/:code/:id", async (c) => {
  const h = await c.env.DB.prepare("SELECT id FROM hotels WHERE code=?").bind(c.req.param("code").toUpperCase()).first<{ id: string }>();
  const p = h && (await c.env.DB.prepare("SELECT data FROM menu_photos WHERE hotel_id=? AND id=?").bind(h.id, c.req.param("id")).first<{ data: string }>());
  if (!p) return bad(c, 404, "not_found");
  const bin = Uint8Array.from(atob(p.data), (ch) => ch.charCodeAt(0));
  return c.body(bin, 200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
});

/* ---------- owner side ---------- */
menu.use("*", async (c, next) => {
  if (!need(c, "settings.edit")) return bad(c, 403, "forbidden");
  await next();
});

menu.post("/photo", async (c) => {
  const b = await body(c);
  if (!b || typeof b.data !== "string" || b.data.length > MAX_PHOTO * 1.4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data)) return bad(c, 400, "invalid");
  let bin: Uint8Array;
  try { bin = Uint8Array.from(atob(b.data), (ch) => ch.charCodeAt(0)); } catch { return bad(c, 400, "invalid"); }
  // a real JPEG starts FF D8 FF and ends FF D9; nothing else is stored, so nothing odd is ever served back
  if (bin.length > MAX_PHOTO || bin.length < 200 || bin[0] !== 0xff || bin[1] !== 0xd8 || bin[2] !== 0xff || bin[bin.length - 2] !== 0xff || bin[bin.length - 1] !== 0xd9) return bad(c, 400, "invalid");
  const hotel = c.get("hotel");
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM menu_photos WHERE hotel_id=?").bind(hotel).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_PHOTOS) return bad(c, 409, "limit");
  const id = crypto.randomUUID().replace(/-/g, "");
  await c.env.DB.prepare("INSERT INTO menu_photos (hotel_id,id,data,created_at) VALUES (?,?,?,?)").bind(hotel, id, b.data, Date.now()).run();
  return c.json({ ok: true, id });
});

menu.post("/photo/delete", async (c) => {
  const b = await body(c);
  if (!b || typeof b.id !== "string" || b.id.length > 64) return bad(c, 400, "invalid");
  await c.env.DB.prepare("DELETE FROM menu_photos WHERE hotel_id=? AND id=?").bind(c.get("hotel"), b.id).run();
  return c.json({ ok: true });
});

/** Every room with its QR key, for printing. */
menu.get("/qr", async (c) => {
  const h = await c.env.DB.prepare("SELECT code,qr_epoch,feat FROM hotels WHERE id=?").bind(c.get("hotel")).first<any>();
  if (!featOf(h.feat).guestOrder) return bad(c, 403, "off");
  const rooms = await c.env.DB.prepare("SELECT id,data FROM records WHERE hotel_id=? AND tbl='rooms' ORDER BY id").bind(c.get("hotel")).all<{ id: string; data: string }>();
  const out = [];
  for (const r of rooms.results) if (!JSON.parse(r.data).deleted) out.push({ n: r.id, key: await qrKey(c.env, c.get("hotel"), h.qr_epoch, r.id) });
  return c.json({ code: h.code, epoch: h.qr_epoch, rooms: out });
});

/** All printed codes stop working at once. The owner prints new ones. */
menu.post("/qr/renew", async (c) => {
  await c.env.DB.prepare("UPDATE hotels SET qr_epoch=qr_epoch+1 WHERE id=?").bind(c.get("hotel")).run();
  await audit(c.env, c.get("hotel"), c.get("user").id, "QR codes renewed", "old room QR codes stopped working");
  return c.json({ ok: true });
});
