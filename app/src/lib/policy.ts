import type { Booking, DiscountCfg, Hotel, Policy, Room, RoomCat, ShiftTpl } from "./types";

export const MAX_MONEY = 10_000_000; // no single amount on a bill can be above one crore
export const MAX_PERSONS = 50;
export const MAX_EXTRA_BEDS = 2;

export const STARTER_CATS: RoomCat[] = [
  { id: "c1", name: "Single", cap: 1, price: 1500 },
  { id: "c2", name: "Double", cap: 2, price: 2500 },
  { id: "c3", name: "Triple", cap: 3, price: 3300 },
  { id: "c4", name: "Quad", cap: 4, price: 4000 },
  { id: "c5", name: "Deluxe", cap: 2, price: 3500 },
  { id: "c6", name: "Family", cap: 5, price: 4500 },
  { id: "c7", name: "Dorm bed", cap: 1, price: 600 },
];
export const DEFAULT_POLICY: Policy = { confirmPrice: true, editRate: false };
export const DEFAULT_DISC: DiscountCfg = { on: true, presets: [5, 10, 15], maxPct: 20 };
export const STARTER_SHIFTS: ShiftTpl[] = [
  { id: "s1", name: "Morning", start: "06:00", end: "14:00" },
  { id: "s2", name: "Day", start: "14:00", end: "22:00" },
  { id: "s3", name: "Night", start: "22:00", end: "06:00" },
];

export const catsOf = (h: Pick<Hotel, "cats">) => h.cats ?? STARTER_CATS;
export const policyOf = (h: Pick<Hotel, "policy">): Policy => ({ ...DEFAULT_POLICY, ...h.policy });
export const discOf = (h: Pick<Hotel, "disc">): DiscountCfg => ({ ...DEFAULT_DISC, ...h.disc });
export const tplOf = (h: Pick<Hotel, "shiftTpl">) => h.shiftTpl ?? STARTER_SHIFTS;

/** How many people the room is meant for: set on the room, else from its category, else its beds. */
export function capOf(room: Pick<Room, "type" | "beds" | "cap">, cats: RoomCat[]): number {
  return room.cap ?? cats.find((c) => c.name === room.type)?.cap ?? Math.max(1, room.beds || 1);
}

/** The most people allowed in the room, counting the extra beds. */
export const maxPersons = (room: Pick<Room, "type" | "beds" | "cap">, cats: RoomCat[], extraBeds = 0) => capOf(room, cats) + Math.max(0, Math.min(MAX_EXTRA_BEDS, Math.floor(extraBeds) || 0));

export const rateOf = (b: Pick<Booking, "rate">, room: Pick<Room, "price"> | undefined) => b.rate ?? room?.price ?? 0;

export const isMoney = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_MONEY;

/** Highest discount (Rs) allowed on a bill of this size. */
export const maxDiscount = (sub: number, cfg: DiscountCfg) => Math.max(0, Math.min(sub, Math.floor((sub * Math.min(100, Math.max(0, cfg.maxPct))) / 100)));
