export const PERMS = [
  "rooms.manage", "prices.edit", "booking.create", "booking.cancel", "checkin", "checkout", "discount",
  "restaurant", "kitchen", "housekeeping", "money.view", "reports.view", "staff.manage", "settings.edit", "delete",
] as const;
export type Perm = (typeof PERMS)[number];
export const ROLES = ["owner", "manager", "reception", "housekeeping", "restaurant", "kitchen", "other"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_DEFAULTS: Record<Role, Perm[]> = {
  owner: [...PERMS],
  manager: PERMS.filter((p) => p !== "staff.manage" && p !== "delete"),
  reception: ["booking.create", "checkin", "checkout", "money.view"],
  housekeeping: ["housekeeping"],
  restaurant: ["restaurant"],
  kitchen: ["kitchen"],
  other: [],
};

export const isPerm = (p: unknown): p is Perm => typeof p === "string" && (PERMS as readonly string[]).includes(p);
export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);

export const DEFAULT_FEATURES = { restaurant: true, housekeeping: true, sources: true, excel: true, email: false, publicLink: false, ical: false, shifts: true, attendance: false, backup: false, smart: false, guestOrder: false };
export const FEATURE_KEYS = Object.keys(DEFAULT_FEATURES) as (keyof typeof DEFAULT_FEATURES)[];

/** Owner always has everything, whatever is stored. */
export function permsOf(u: { role: string; perms: string }): Set<Perm> {
  if (u.role === "owner") return new Set(PERMS);
  try {
    const l = JSON.parse(u.perms);
    return new Set(Array.isArray(l) ? l.filter(isPerm) : []);
  } catch {
    return new Set();
  }
}

/** Hotels made before a feature existed have no entry for it: use the default. */
export const featOf = (stored: string): Record<string, boolean> => ({ ...DEFAULT_FEATURES, ...JSON.parse(stored) });
