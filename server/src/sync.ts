import { Hono } from "hono";
import type { App } from "./util";
import { featOf, permsOf, type Perm } from "./perms";
import { MAX_EXTRA_BEDS, MAX_PERSONS, capOf, isMoney, validHotelExtras, validPay, validPunches } from "./policy";
import { overlaps, validDate } from "./overlap";

export const sync = new Hono<App>();

const TABLES = new Set(["rooms", "bookings", "orders", "hotel", "shifts", "attendance", "pay"]);
const MAX_BATCH = 100;
const MAX_RECORD = 64 * 1024;
const TERMINAL = new Set(["done", "cancelled", "noshow"]);
const BOOKING_STATUS = new Set(["booked", "occupied", "done", "cancelled", "noshow"]);

type Change = { t: string; id: string; data: Record<string, any>; ts: number };
type Row = Record<string, any>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The calendar day (UTC) of a time, shifted by some days. A day of slack covers Nepal being ahead of UTC. */
const dayOf = (ms: number, shift = 0) => new Date(ms + shift * 86400000).toISOString().slice(0, 10);

function validMenu(m: unknown): boolean {
  if (m === undefined) return true;
  if (!Array.isArray(m) || m.length > 300) return false;
  return m.every((x) => x && typeof x.id === "string" && x.id.length <= 64 && typeof x.name === "string" && x.name.length <= 80 && typeof x.price === "number" && x.price >= 0 && x.price <= 1_000_000 && typeof x.cat === "string" && x.cat.length <= 40);
}

/** What a change needs, worked out by comparing it with what the server already has. Returns null when it is not allowed at all. */
export function needed(t: string, old: Row | null, nu: Row, restore = false): { all: Perm[]; any?: Perm[] } | null {
  if (t === "hotel") return validMenu(nu.menu) && validHotelExtras(nu) ? { all: ["settings.edit"] } : null;
  if (t === "shifts") return typeof nu.uid === "string" && nu.uid && validDate(nu.day) && typeof nu.tpl === "string" && nu.tpl.length <= 64 && (nu.name === undefined || (typeof nu.name === "string" && nu.name.length <= 80)) && nu.id === `${nu.uid}:${nu.day}` ? { all: ["staff.manage"] } : null;
  if (t === "pay") return validPay(nu) && nu.id === nu.uid ? { all: ["staff.manage"] } : null;
  if (t === "attendance")
    return typeof nu.uid === "string" && nu.uid && (nu.name === undefined || (typeof nu.name === "string" && nu.name.length <= 80)) && validDate(nu.day) && nu.id === `${nu.uid}:${nu.day}` && validPunches(nu.punches) ? { all: [] } : null;
  if (t === "orders") return { all: ["restaurant"] };
  if (t === "rooms") {
    if (typeof nu.n !== "string" || !nu.n) return null;
    if (nu.cap !== undefined && !(Number.isInteger(nu.cap) && nu.cap >= 1 && nu.cap <= MAX_PERSONS)) return null;
    if (nu.price !== undefined && !isMoney(nu.price)) return null;
    if (!old) return { all: ["rooms.manage"] };
    const all: Perm[] = [];
    const any: Perm[] = [];
    if (old.price !== nu.price) all.push("prices.edit");
    if (old.st !== nu.st) {
      if (old.st === "out" || nu.st === "out") all.push("rooms.manage");
      else if (old.st === "clean" && nu.st === "free") any.push("housekeeping", "rooms.manage");
      else if (nu.st === "clean") any.push("checkout", "housekeeping", "rooms.manage");
      else all.push("rooms.manage");
    }
    if (old.type !== nu.type || old.floor !== nu.floor || old.beds !== nu.beds || old.cap !== nu.cap || !!old.deleted !== !!nu.deleted) all.push("rooms.manage");
    return { all, any: any.length ? any : undefined };
  }
  if (t === "bookings") {
    if (!BOOKING_STATUS.has(nu.status) || !validDate(nu.from) || !Number.isInteger(nu.nights) || nu.nights < 1 || nu.nights > 365 || typeof nu.room !== "string") return null;
    for (const k of ["extra", "discount", "rate"]) if (nu[k] !== undefined && !isMoney(nu[k])) return null;
    if (nu.persons !== undefined && !(Number.isInteger(nu.persons) && nu.persons >= 1 && nu.persons <= MAX_PERSONS)) return null;
    if (nu.payments !== undefined && (!Array.isArray(nu.payments) || nu.payments.length > 60 || !nu.payments.every((p: any) => p && isMoney(p.amount)))) return null;
    const all: Perm[] = [];
    const any: Perm[] = [];
    if (typeof nu.discount === "number" && nu.discount > 0 && nu.discount !== old?.discount) all.push("discount");
    // a booking cannot start on a day that was already over when it was made or moved
    if (!restore && !old && typeof nu.createdAt === "number" && nu.from < dayOf(nu.createdAt, -1)) return null;
    if (old && old.from !== nu.from && old.status === "booked" && nu.status === "booked" && typeof nu.updatedAt === "number" && nu.from < dayOf(nu.updatedAt, -1)) return null;
    if (!old) {
      all.push("booking.create");
      if (nu.status !== "booked" && !restore) return null; // a booking must start as "booked" (a backup restore may bring back finished ones)
      return { all };
    }
    if (old.status !== nu.status) {
      if (TERMINAL.has(old.status)) all.push("delete"); // reopening a closed bill is owner-only
      else if (nu.status === "cancelled" || nu.status === "noshow") all.push("booking.cancel");
      else if (nu.status === "occupied") all.push("checkin");
      else if (nu.status === "done") all.push("checkout");
      else return null;
    }
    if (old.room !== nu.room || old.from !== nu.from || old.nights !== nu.nights) any.push("booking.create", "booking.cancel");
    if (!same(old.payments, nu.payments)) any.push("booking.create", "checkin", "checkout");
    if (!same(old.food, nu.food)) any.push("restaurant", "checkout");
    if (old.extra !== nu.extra || old.billNo !== nu.billNo) all.push("checkout");
    if (old.status === "done" && old.billNo && old.billNo !== nu.billNo) all.push("delete");
    return { all, any: any.length ? any : undefined };
  }
  return null;
}

const ok = (p: Set<Perm>, n: { all: Perm[]; any?: Perm[] }) => n.all.every((x) => p.has(x)) && (!n.any || n.any.some((x) => p.has(x)));

sync.post("/push", async (c) => {
  let b: { changes?: Change[] } | null = null;
  try { b = await c.req.json(); } catch { /* handled below */ }
  const list = b?.changes;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) return c.json({ error: "invalid" }, 400);
  const hotel = c.get("hotel"), dev = c.get("dev"), user = c.get("user");
  const perms = permsOf(user);
  const feat = featOf((await c.env.DB.prepare("SELECT feat FROM hotels WHERE id=?").bind(hotel).first<{ feat: string }>())!.feat);

  const accepted: string[] = [];
  const rejected: { t: string; id: string; reason: string; server: Row | null }[] = [];
  const touched: Row[] = [];

  for (const ch of list) {
    if (!ch || typeof ch.id !== "string" || !ch.id || ch.id.length > 64 || !TABLES.has(ch.t) || typeof ch.data !== "object" || !ch.data || Array.isArray(ch.data)) return c.json({ error: "invalid" }, 400);
    if (JSON.stringify(ch.data).length > MAX_RECORD) return c.json({ error: "too_big", id: ch.id }, 400);
  }

  for (const ch of list) {
    const cur = await c.env.DB.prepare("SELECT data,updated_at FROM records WHERE hotel_id=? AND tbl=? AND id=?").bind(hotel, ch.t, ch.id).first<{ data: string; updated_at: number }>();
    const old: Row | null = cur ? JSON.parse(cur.data) : null;
    const reject = (reason: string) => {
      // somebody else's pay is never sent back, not even inside a refusal
      const hide = ch.t === "pay" && !perms.has("staff.manage") && old?.uid !== user.id;
      rejected.push({ t: ch.t, id: ch.id, reason, server: old && !hide ? stripFor(ch.t, old, perms) : null });
    };
    const data: Row = { ...ch.data };
    if (ch.t === "hotel") {
      delete data.feat; // features are the admin's, never the owner's
      delete data.invoiceSeq; delete data.receiptSeq;
    }
    if (ch.t === "bookings" && old && !perms.has("money.view")) data.payments = old.payments; // this person cannot see or change money
    if (ch.t === "bookings" && !old && !perms.has("money.view")) data.payments = [];
    if (ch.t === "orders" && !feat.restaurant) { reject("feature_off"); continue; }
    if ((ch.t === "shifts" || ch.t === "attendance" || ch.t === "pay") && data.id !== ch.id) { reject("invalid"); continue; } // the record key must be the person and the day
    if ((ch.t === "shifts" && !feat.shifts) || ((ch.t === "attendance" || ch.t === "pay") && !feat.attendance)) { reject("feature_off"); continue; }
    if (ch.t === "attendance") {
      // clocking in is for oneself. Only a manager writes another person's times, and nobody rewrites what was already recorded.
      const mgr = perms.has("staff.manage");
      const punches: any[] = Array.isArray(data.punches) ? data.punches : [];
      const before: any[] = old?.punches ?? [];
      const kept = before.every((p, i) => punches[i] && punches[i].in === p.in && (p.out === undefined || punches[i].out === p.out) && (p.breaks ?? []).every((b: any, k: number) => punches[i].breaks?.[k] && punches[i].breaks[k].s === b.s && (b.e === undefined || punches[i].breaks[k].e === b.e)));
      const fresh = punches.slice(before.length).every((p) => p.in <= Date.now() + 5 * 60_000 && p.in >= Date.now() - 7 * 86400000);
      if (!mgr && !(data.uid === user.id && kept && fresh)) { reject("forbidden"); continue; }
    }
    // the owner may bring back finished and past bookings from a backup, if the hotel has the backup feature
    const restore = ch.t === "bookings" && feat.backup === true && perms.has("delete");
    const need = needed(ch.t, old, data, restore);
    if (!need) { reject("invalid"); continue; }
    if (ch.t === "bookings") {
      const why = await bookingLimits(c.env.DB, hotel, old, data, perms);
      if (why) { reject(why); continue; }
    }
    if (ch.t === "rooms" && data.deleted && !old?.deleted) {
      // a room with a booking or a guest cannot be deleted, whatever the phone says
      const live = await c.env.DB.prepare("SELECT 1 AS x FROM records WHERE hotel_id=? AND tbl='bookings' AND json_extract(data,'$.room')=? AND json_extract(data,'$.status') IN ('booked','occupied') LIMIT 1").bind(hotel, data.n).first();
      if (live) { reject("in_use"); continue; }
    }
    if (!ok(perms, need)) {
      reject("forbidden");
      await c.env.DB.prepare("INSERT INTO audit (hotel_id,at,user_id,action,detail) VALUES (?,?,?,?,?)").bind(hotel, Date.now(), user.id, "refused", `${ch.t} ${ch.id} needs ${[...need.all, ...(need.any ?? [])].join(",")}`).run();
      continue;
    }
    const ts = Number.isFinite(ch.ts) ? Math.min(Math.floor(ch.ts), Date.now() + 5 * 60_000) : Date.now();
    if (cur && ts <= cur.updated_at) { accepted.push(ch.id); continue; } // older or same edit: nothing to do
    const uniq = ch.t === "bookings" && typeof data.billNo === "string" && data.billNo ? data.billNo : null;
    if (uniq) {
      const other = await c.env.DB.prepare("SELECT id FROM records WHERE hotel_id=? AND tbl='bookings' AND uniq=? AND id<>? LIMIT 1").bind(hotel, uniq, ch.id).first<{ id: string }>();
      if (other) {
        const pair = [ch.id, other.id].sort();
        await c.env.DB.prepare("INSERT OR IGNORE INTO conflicts (id,hotel_id,kind,a,b,created_at) VALUES (?,?,?,?,?,?)").bind(`${hotel}:bill:${pair[0]}:${pair[1]}`, hotel, "duplicate_bill_no", pair[0], pair[1], Date.now()).run();
      }
    }
    const end = (await c.env.DB.prepare("UPDATE hotels SET seq=seq+1 WHERE id=? RETURNING seq").bind(hotel).first<{ seq: number }>())!.seq;
    await c.env.DB.prepare(
      `INSERT INTO records (hotel_id,tbl,id,data,updated_at,seq,device_id,uniq) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(hotel_id,tbl,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,seq=excluded.seq,device_id=excluded.device_id,uniq=excluded.uniq`,
    ).bind(hotel, ch.t, ch.id, JSON.stringify(data), ts, end, dev, uniq).run();
    accepted.push(ch.id);
    if (ch.t === "bookings") {
      touched.push({ id: ch.id, ...data });
      if (old && old.status !== data.status && (data.status === "cancelled" || data.status === "noshow"))
        await c.env.DB.prepare("INSERT INTO audit (hotel_id,at,user_id,action,detail) VALUES (?,?,?,?,?)").bind(hotel, Date.now(), user.id, data.status, `${data.guest} room ${data.room} ${data.from} ${String(data.cancelReason ?? "").slice(0, 100)}`).run();
    }
    if (ch.t === "bookings" && old && TERMINAL.has(old.status) && old.status !== data.status)
      await c.env.DB.prepare("INSERT INTO audit (hotel_id,at,user_id,action,detail) VALUES (?,?,?,?,?)").bind(hotel, Date.now(), user.id, "reopened", `${old.billNo ?? ""} room ${data.room} ${old.status} -> ${data.status}`).run();
    if (ch.t === "rooms" && old && old.price !== data.price)
      await c.env.DB.prepare("INSERT INTO audit (hotel_id,at,user_id,action,detail) VALUES (?,?,?,?,?)").bind(hotel, Date.now(), user.id, "price change", `room ${data.n}: ${old.price} -> ${data.price}`).run();
  }

  // Two phones may have booked the same room while offline. Keep both, remember the clash, show it to the manager.
  for (const nb of touched) {
    if (nb.status !== "booked" && nb.status !== "occupied") continue;
    const others = await c.env.DB.prepare(
      "SELECT id,data FROM records WHERE hotel_id=? AND tbl='bookings' AND id<>? AND json_extract(data,'$.room')=? AND json_extract(data,'$.status') IN ('booked','occupied')",
    ).bind(hotel, nb.id, nb.room).all<{ id: string; data: string }>();
    for (const o of others.results) {
      const od = JSON.parse(o.data);
      if (!overlaps(nb.from, nb.nights, od.from, od.nights)) continue;
      const pair = [nb.id, o.id].sort();
      await c.env.DB.prepare("INSERT OR IGNORE INTO conflicts (id,hotel_id,kind,a,b,created_at) VALUES (?,?,?,?,?,?)").bind(`${hotel}:room:${pair[0]}:${pair[1]}`, hotel, "double_booking", pair[0], pair[1], Date.now()).run();
    }
  }
  return c.json({ ok: true, accepted, rejected });
});

/** Rules that need the room and the hotel settings: how many people fit, what price may be agreed, how big a discount may be. */
async function bookingLimits(DB: D1Database, hotel: string, old: Row | null, nu: Row, perms: Set<Perm>): Promise<string | null> {
  const get = async (tbl: string, id: string) => {
    const x = await DB.prepare("SELECT data FROM records WHERE hotel_id=? AND tbl=? AND id=?").bind(hotel, tbl, id).first<{ data: string }>();
    return x ? (JSON.parse(x.data) as Row) : null;
  };
  const peopleChanged = !old || !same(old.info, nu.info) || old.persons !== nu.persons;
  const rateChanged = nu.rate !== undefined && nu.rate !== old?.rate;
  const discChanged = typeof nu.discount === "number" && nu.discount > 0 && nu.discount !== old?.discount;
  if (!peopleChanged && !rateChanged && !discChanged) return null;
  const room = await get("rooms", nu.room);
  if (!room) return null;
  const h = (await get("hotel", "main")) ?? {};
  if (peopleChanged) {
    const n = nu.info?.persons ?? nu.persons;
    const extra = nu.info ? Math.min(MAX_EXTRA_BEDS, Math.max(0, Number(nu.info.extraBeds) || 0)) : MAX_EXTRA_BEDS;
    if (typeof n === "number" && n > capOf(room, h.cats) + extra) return "too_many_people";
  }
  // a price other than the room's own price needs the right to change prices (or to give discounts)
  if (rateChanged && nu.rate !== room.price && !(perms.has("prices.edit") || perms.has("discount"))) return "forbidden";
  if (discChanged) {
    const food = Array.isArray(nu.food) ? nu.food.reduce((a: number, l: any) => a + (Number(l?.qty) || 0) * (Number(l?.price) || 0), 0) : 0;
    const sub = (nu.rate ?? room.price) * nu.nights + food + (Number(nu.extra) || 0);
    const d = h.disc ?? {};
    const pct = d.on === false ? 0 : typeof d.maxPct === "number" ? Math.min(100, Math.max(0, d.maxPct)) : 20;
    if (nu.discount > Math.floor((sub * pct) / 100)) return "discount_too_big";
  }
  return null;
}

function stripFor(t: string, d: Row, perms: Set<Perm>): Row {
  if (t === "bookings" && !perms.has("money.view")) return { ...d, payments: [] };
  return d;
}

sync.get("/pull", async (c) => {
  const since = Math.max(0, Number(c.req.query("since")) || 0);
  const limit = 300;
  const perms = permsOf(c.get("user"));
  const r = await c.env.DB.prepare("SELECT tbl,id,data,updated_at,seq FROM records WHERE hotel_id=? AND seq>? ORDER BY seq LIMIT ?").bind(c.get("hotel"), since, limit + 1).all<any>();
  const more = r.results.length > limit;
  const all = more ? r.results.slice(0, limit) : r.results;
  // salary rows go only to managers and to the person they are about
  const mgr = perms.has("staff.manage"), me = c.get("user").id;
  const rows = all.filter((x) => x.tbl !== "pay" || mgr || x.id === me);
  const h = await c.env.DB.prepare("SELECT name,plan,feat FROM hotels WHERE id=?").bind(c.get("hotel")).first<any>();
  return c.json({
    changes: rows.map((x) => ({ t: x.tbl, id: x.id, data: stripFor(x.tbl, JSON.parse(x.data), perms), ts: x.updated_at, seq: x.seq })),
    next: all.length ? all[all.length - 1].seq : since,
    more,
    hotel: { name: h.name, plan: h.plan, feat: featOf(h.feat) },
  });
});

/** Clashes that still exist. A clash that was fixed (booking moved or cancelled) disappears by itself. */
sync.get("/conflicts", async (c) => {
  const hotel = c.get("hotel");
  const r = await c.env.DB.prepare("SELECT id,kind,a,b,created_at FROM conflicts WHERE hotel_id=? ORDER BY created_at DESC LIMIT 100").bind(hotel).all<any>();
  const out: any[] = [];
  for (const x of r.results) {
    const rows = await c.env.DB.prepare("SELECT id,data FROM records WHERE hotel_id=? AND tbl='bookings' AND id IN (?,?)").bind(hotel, x.a, x.b).all<{ id: string; data: string }>();
    const m = new Map(rows.results.map((z) => [z.id, JSON.parse(z.data)]));
    const A = m.get(x.a), B = m.get(x.b);
    if (!A || !B) { await c.env.DB.prepare("DELETE FROM conflicts WHERE id=?").bind(x.id).run(); continue; }
    let live = false;
    if (x.kind === "double_booking") live = ["booked", "occupied"].includes(A.status) && ["booked", "occupied"].includes(B.status) && A.room === B.room && overlaps(A.from, A.nights, B.from, B.nights);
    else live = !!A.billNo && A.billNo === B.billNo;
    if (!live) { await c.env.DB.prepare("DELETE FROM conflicts WHERE id=?").bind(x.id).run(); continue; }
    // The booking made first keeps the room. The other one must be moved.
    const [keep, move] = (A.createdAt ?? 0) <= (B.createdAt ?? 0) ? [x.a, x.b] : [x.b, x.a];
    out.push({ id: x.id, kind: x.kind, keep, move, createdAt: x.created_at });
  }
  return c.json({ conflicts: out });
});
