import Dexie, { type Table } from "dexie";
import type { Audit, Booking, Hotel, Order, Room } from "./lib/types";

class HotelDB extends Dexie {
  rooms!: Table<Room, string>;
  bookings!: Table<Booking, string>;
  orders!: Table<Order, string>;
  hotel!: Table<Hotel, string>;
  audit!: Table<Audit, number>;
  constructor(name = "pocket-hotel") {
    super(name);
    this.version(1).stores({
      rooms: "n",
      bookings: "id, room, from, status",
      orders: "id, at",
      hotel: "id",
      audit: "++id, at",
    });
  }
}

export const db = new HotelDB();

export const DEFAULT_HOTEL: Hotel = {
  id: "main",
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
