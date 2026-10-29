export type RoomState = "free" | "clean" | "out";
export type Room = { updatedAt?: number; n: string; type: string; floor: number; beds: number; cap?: number; price: number; st: RoomState; deleted?: boolean };

export type BookingStatus = "booked" | "occupied" | "done" | "cancelled" | "noshow";
export type Line = { name: string; qty: number; price: number };
export type Payment = { id: string; method: "cash" | "qr" | "card" | "bank" | "credit"; amount: number; at: number; kind: "advance" | "bill" | "refund" };
export type GuestInfo = { nationality: string; persons: number; idNo: string; visa: string; extraBeds: number };

export type Booking = {
  id: string;
  room: string;
  from: string; // YYYY-MM-DD, first night
  nights: number;
  guest: string;
  phone: string;
  src: string;
  status: BookingStatus;
  payments: Payment[];
  food: Line[];
  extra: number;
  info?: GuestInfo;
  persons?: number; // how many people the booking is for
  rate?: number; // price per night agreed at check-in; the room's price is used when missing
  discount?: number; // Rs taken off the bill at check-out
  outAt?: number; // when the guest checked out
  billNo?: string;
  cancelReason?: string;
  createdAt: number;
  updatedAt: number;
};

export type OrderPay = { method: "cash" | "qr" | "card"; amount: number; at: number };
export type Order = { updatedAt?: number; id: string; to: string; items: Line[]; done: boolean; billed: boolean; at: number; paid?: OrderPay };

export type BillSettings = { vatInvoice: boolean; taxIncluded: boolean; svc: boolean; vat: number; svcPct: number; idPhoto: boolean };
export type Features = { restaurant: boolean; housekeeping: boolean; sources: boolean; excel: boolean; email: boolean; publicLink: boolean; ical: boolean; shifts: boolean; attendance: boolean; backup: boolean; smart: boolean };

/** A kind of room (Single, Triple, Quad ...) that the owner defines: how many people fit and the usual price. */
export type RoomCat = { id: string; name: string; cap: number; price: number };
export type Policy = { confirmPrice: boolean; editRate: boolean };
export type DiscountCfg = { on: boolean; presets: number[]; maxPct: number };
export type ShiftTpl = { id: string; name: string; start: string; end: string };
/** One person's shift on one day. tpl is a ShiftTpl id, or "" for a day off. */
export type Shift = { updatedAt?: number; id: string; uid: string; name: string; day: string; tpl: string };
export type Break = { s: number; e?: number };
export type Punch = { in: number; out?: number; breaks?: Break[] };
export type PayMode = "monthly" | "daily" | "hourly";
export type PayAdj = { month: string; bonus: number; deduct: number; note: string };
/** What one person is paid. Only managers (and the person) ever receive this record. */
export type PayRec = { updatedAt?: number; id: string; uid: string; name: string; mode: PayMode; rate: number; adj: PayAdj[] };
export type Attendance = { updatedAt?: number; id: string; uid: string; name: string; day: string; punches: Punch[] };

export type MenuItem = { id: string; name: string; price: number; cat: string };

export type Hotel = {
  id: "main";
  updatedAt?: number;
  name: string;
  pan: string;
  phone: string;
  address: string;
  lang: "ne" | "en";
  bill: BillSettings;
  feat: Features;
  sources: string[];
  menu?: MenuItem[]; // undefined = the starter menu, which the owner can change
  cats?: RoomCat[]; // undefined = the starter categories
  policy?: Policy;
  disc?: DiscountCfg;
  shiftTpl?: ShiftTpl[];
  invoiceSeq: number;
  receiptSeq: number;
};

export type Audit = { id?: number; at: number; action: string; detail: string };
