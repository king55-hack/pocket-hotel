export type RoomState = "free" | "clean" | "out";
export type Room = { updatedAt?: number; n: string; type: string; floor: number; beds: number; price: number; st: RoomState };

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
  billNo?: string;
  cancelReason?: string;
  createdAt: number;
  updatedAt: number;
};

export type Order = { updatedAt?: number; id: string; to: string; items: Line[]; done: boolean; billed: boolean; at: number };

export type BillSettings = { vatInvoice: boolean; taxIncluded: boolean; svc: boolean; vat: number; svcPct: number; idPhoto: boolean };
export type Features = { restaurant: boolean; housekeeping: boolean; sources: boolean; excel: boolean; email: boolean; publicLink: boolean; ical: boolean };

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
  invoiceSeq: number;
  receiptSeq: number;
};

export type Audit = { id?: number; at: number; action: string; detail: string };
