import Dexie, { type Table } from "dexie";
import type { Audit, Booking, Hotel, MenuItem, Order, Room } from "./lib/types";

export type Meta = { k: string; v: unknown };

/** True while the server's data is being written in, so those writes are not mistaken for local edits. */
export const inSyncTx = () => !!(Dexie.currentTransaction as unknown as { _sync?: boolean } | null)?._sync;

class HotelDB extends Dexie {
  rooms!: Table<Room, string>;
  bookings!: Table<Booking, string>;
  orders!: Table<Order, string>;
  hotel!: Table<Hotel, string>;
  audit!: Table<Audit, number>;
  meta!: Table<Meta, string>;
  constructor(name = "pocket-hotel") {
    super(name);
    this.version(1).stores({
      rooms: "n",
      bookings: "id, room, from, status",
      orders: "id, at",
      hotel: "id",
      audit: "++id, at",
    });
    // Version 2: every record carries updatedAt so edits can be sent to the server and merged newest-wins.
    this.version(2)
      .stores({
        rooms: "n, updatedAt",
        bookings: "id, room, from, status, updatedAt",
        orders: "id, at, updatedAt",
        hotel: "id, updatedAt",
        meta: "k",
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        for (const t of ["rooms", "orders", "hotel"]) await tx.table(t).toCollection().modify((r: { updatedAt?: number }) => { r.updatedAt ??= now; });
      });
    for (const t of [this.rooms, this.bookings, this.orders, this.hotel] as Table<{ updatedAt?: number }, string>[]) {
      // Stamp every local edit. Records applied from the server skip this (the transaction is marked).
      t.hook("creating", function (_k, obj) {
        if (inSyncTx()) return;
        obj.updatedAt ??= Date.now();
      });
      t.hook("updating", function (mods) {
        if (inSyncTx()) return;
        return { ...(mods as object), updatedAt: Date.now() };
      });
    }
  }
}

export const db = new HotelDB();

export const STARTER_MENU: MenuItem[] = [
  { id: "m1", name: "Dal Bhat set", price: 350, cat: "Meals" },
  { id: "m2", name: "Momo (10)", price: 250, cat: "Meals" },
  { id: "m3", name: "Chowmein", price: 220, cat: "Meals" },
  { id: "m4", name: "Fried rice", price: 260, cat: "Meals" },
  { id: "m5", name: "Tea", price: 40, cat: "Drinks" },
  { id: "m6", name: "Coffee", price: 90, cat: "Drinks" },
];

export const DEFAULT_HOTEL: Hotel = {
  id: "main",
  updatedAt: 0, // not sent to the server until someone really edits it
  name: "My Hotel",
  pan: "",
  phone: "",
  address: "",
  lang: "ne",
  bill: { vatInvoice: true, taxIncluded: true, svc: true, vat: 13, svcPct: 10, idPhoto: false },
  feat: { restaurant: true, housekeeping: true, sources: true, excel: true, email: false, publicLink: false, ical: false },
  sources: ["Phone", "Walk-in", "WhatsApp", "Booking.com"],
  invoiceSeq: 0,
  receiptSeq: 0,
};

export async function ensureHotel(): Promise<Hotel> {
  const h = await db.hotel.get("main");
  if (h) return h;
  await db.hotel.put(DEFAULT_HOTEL);
  return DEFAULT_HOTEL;
}

export async function logAudit(action: string, detail: string) {
  await db.audit.add({ at: Date.now(), action, detail });
}

export const uid = () => crypto.randomUUID();

export async function getMeta<T>(k: string, d: T): Promise<T> {
  const r = await db.meta.get(k);
  return r ? (r.v as T) : d;
}
export const setMeta = (k: string, v: unknown) => db.meta.put({ k, v });

/** Wipe everything on this device (used when a different hotel or person signs in). */
export async function wipeAll() {
  await db.transaction("rw", [db.rooms, db.bookings, db.orders, db.hotel, db.audit, db.meta], async () => {
    await Promise.all([db.rooms.clear(), db.bookings.clear(), db.orders.clear(), db.hotel.clear(), db.audit.clear(), db.meta.clear()]);
  });
}

/** Language is a choice of this device, so changing it must not look like a hotel-settings edit. */
export async function setLang(lang: "ne" | "en") {
  await db.transaction("rw", db.hotel, async (tx) => {
    (tx as unknown as { _sync: boolean })._sync = true;
    await db.hotel.update("main", { lang });
  });
}
