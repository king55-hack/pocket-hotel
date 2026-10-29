import type { Table } from "dexie";
import { api, loadSession, saveSession } from "./api";
import { db, getMeta, inSyncTx, setMeta, wipeAll } from "./db";
import { DEFAULT_HOTEL } from "./db";
import type { Hotel } from "./lib/types";

type Rec = { updatedAt?: number } & Record<string, any>;
const TABLES: [string, Table<any, string>, (r: Rec) => string][] = [
  ["rooms", db.rooms, (r) => r.n],
  ["bookings", db.bookings, (r) => r.id],
  ["orders", db.orders, (r) => r.id],
  ["hotel", db.hotel, () => "main"],
  ["shifts", db.shifts, (r) => r.id],
  ["attendance", db.attendance, (r) => r.id],
  ["pay", db.pay, (r) => r.id],
];
const byName = new Map(TABLES.map((t) => [t[0], t]));

/** The hotel record is shared, but language, features and counters belong to this device or to the admin. */
function hotelOut(h: Hotel) {
  const { name, pan, phone, address, bill, sources, menu, cats, policy, disc, shiftTpl, updatedAt } = h;
  return { name, pan, phone, address, bill, sources, menu, cats, policy, disc, shiftTpl, updatedAt };
}

export type SyncState = { status: "idle" | "syncing" | "offline" | "error" | "signed-out"; pending: number; last: number; error?: string };
let state: SyncState = { status: "idle", pending: 0, last: 0 };
const subs = new Set<(s: SyncState) => void>();
const set = (p: Partial<SyncState>) => { state = { ...state, ...p }; subs.forEach((f) => f(state)); };
export const getSyncState = () => state;
export const onSync = (f: (s: SyncState) => void) => { subs.add(f); return () => void subs.delete(f); };

const vKey = (t: string, id: string) => `v:${t}:${id}`;
/** Which version of each record the server is known to have. A record is "pending" while its updatedAt differs from that. */
async function dirty(): Promise<{ t: string; id: string; r: Rec; tbl: Table<any, string> }[]> {
  const seen = new Map((await db.meta.where("k").startsWith("v:").toArray()).map((m) => [m.k, m.v as number]));
  const out: { t: string; id: string; r: Rec; tbl: Table<any, string> }[] = [];
  for (const [name, tbl, idOf] of TABLES) {
    for (const r of (await tbl.toArray()) as Rec[]) {
      const ts = r.updatedAt ?? 0;
      if (ts > 0 && seen.get(vKey(name, idOf(r))) !== ts) out.push({ t: name, id: idOf(r), r, tbl });
    }
  }
  return out;
}
export const countPending = async (): Promise<number> => (await dirty()).length;

let running = false;
// true when the last round sent or received something. Quiet rounds make the next check come later.
let lastChanged = false;

export async function syncNow(): Promise<void> {
  if (running || !loadSession()) return;
  running = true;
  lastChanged = false;
  set({ status: "syncing" });
  try {
    if (!(await push())) return;
    if (!(await pull())) return;
    set({ status: "idle", pending: await countPending(), last: Date.now(), error: undefined });
  } finally {
    running = false;
  }
}

function fail(s: number, msg?: string): false {
  if (!loadSession()) set({ status: "signed-out" });
  else set({ status: s === 0 ? "offline" : "error", error: msg });
  return false;
}

async function push(): Promise<boolean> {
  const items = (await dirty()).map((d) => ({ ...d, data: d.t === "hotel" ? (hotelOut(d.r as unknown as Hotel) as Rec) : d.r, ts: d.r.updatedAt ?? Date.now() }));
  if (items.length) lastChanged = true;
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    const r = await api("/sync/push", "POST", { changes: chunk.map((c) => ({ t: c.t, id: c.id, data: c.data, ts: c.ts })) });
    if (r.s !== 200) return fail(r.s, r.j?.error);
    // Things the server refused (for example this person has no right): put the server's version back so the screen tells the truth.
    for (const rej of (r.j.rejected ?? []) as { t: string; id: string; server: Rec | null }[]) {
      const tbl = byName.get(rej.t);
      if (!tbl) continue;
      await db.transaction("rw", tbl[1], db.meta, async (tx) => {
        (tx as any)._sync = true;
        if (rej.server) {
          const cur = rej.t === "hotel" ? await tbl[1].get("main") : undefined;
          await tbl[1].put(rej.t === "hotel" ? { ...cur, ...rej.server } : rej.server);
        } else await tbl[1].delete(rej.id); // the server never had it and does not allow it
        await db.meta.delete(vKey(rej.t, rej.id));
      });
    }
    const refused = new Set(((r.j.rejected ?? []) as { t: string; id: string }[]).map((x) => x.t + ":" + x.id));
    await db.meta.bulkPut(chunk.filter((c) => !refused.has(c.t + ":" + c.id)).map((c) => ({ k: vKey(c.t, c.id), v: c.ts })));
  }
  return true;
}

async function pull(): Promise<boolean> {
  let since = await getMeta("since", 0);
  for (;;) {
    const r = await api(`/sync/pull?since=${since}`, "GET");
    if (r.s !== 200) return fail(r.s, r.j?.error);
    if (r.j.changes.length) lastChanged = true;
    await db.transaction("rw", [db.rooms, db.bookings, db.orders, db.hotel, db.shifts, db.attendance, db.pay, db.meta], async (tx) => {
      (tx as any)._sync = true;
      for (const ch of r.j.changes as { t: string; id: string; data: Rec; ts: number }[]) {
        const tbl = byName.get(ch.t);
        if (!tbl) continue;
        const local = (await tbl[1].get(ch.id)) as Rec | undefined;
        if (local && (local.updatedAt ?? 0) >= ch.ts) {
          if ((local.updatedAt ?? 0) === ch.ts) await db.meta.put({ k: vKey(ch.t, ch.id), v: ch.ts });
          continue; // this device has the same or a newer edit
        }
        if (ch.t === "hotel") {
          const cur = (local as unknown as Hotel) ?? DEFAULT_HOTEL;
          await db.hotel.put({ ...cur, ...(ch.data as object), id: "main", updatedAt: ch.ts } as Hotel);
        } else await tbl[1].put({ ...ch.data, updatedAt: ch.ts });
        await db.meta.put({ k: vKey(ch.t, ch.id), v: ch.ts });
      }
      // Features and the hotel name are decided on the server. Keep this device's copy equal to it.
      const h = (await db.hotel.get("main")) ?? DEFAULT_HOTEL;
      await db.hotel.put({ ...h, id: "main", feat: { ...h.feat, ...r.j.hotel.feat }, name: h.name === DEFAULT_HOTEL.name ? r.j.hotel.name : h.name });
    });
    since = r.j.next;
    await setMeta("since", since);
    const s = loadSession();
    if (s) saveSession({ ...s, hotel: { ...s.hotel, ...r.j.hotel } });
    if (!r.j.more) return true;
  }
}

/** Sign out. If something is not yet on the server we say so instead of silently losing it. */
export async function signOut(force = false): Promise<"ok" | "unsynced"> {
  await syncNow();
  if (!force && (await countPending()) > 0) return "unsynced";
  await api("/auth/logout", "POST", {});
  saveSession(null);
  await wipeAll();
  set({ status: "signed-out", pending: 0 });
  return "ok";
}

/**
 * The free server plan allows 100,000 requests a day, so a phone must not ask all the time.
 * Busy: every 30 seconds. Quiet rounds slow it down step by step to 2 minutes. A hidden screen asks for nothing,
 * and coming back to the app, getting the internet back, or editing something checks again at once.
 */
export const BASE_DELAY = 30_000;
export const MAX_DELAY = 120_000;
export const nextDelay = (prev: number, changed: boolean) => (changed ? BASE_DELAY : Math.min(MAX_DELAY, Math.round(prev * 1.5)));

let timer: ReturnType<typeof setTimeout> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let delay = BASE_DELAY;
let started = false;

async function tick() {
  clearTimeout(timer);
  if (!document.hidden) {
    await syncNow();
    delay = nextDelay(delay, lastChanged);
  }
  timer = setTimeout(() => void tick(), delay);
}
function wake() {
  delay = BASE_DELAY;
  void tick();
}

export function startAutoSync() {
  if (started) return;
  started = true;
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  // Any local edit is sent a moment later.
  for (const [, t] of TABLES) {
    const later = function () {
      if (inSyncTx()) return; // changes that just came from the server are not sent back
      clearTimeout(debounce);
      debounce = setTimeout(wake, 1500);
    };
    (t as any).hook("creating", later);
    (t as any).hook("updating", later);
  }
  void tick();
}
