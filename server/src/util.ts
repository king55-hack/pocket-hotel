import type { Context } from "hono";
import type { Env } from "./mail";
import { permsOf, type Perm } from "./perms";

export type AuthUser = { id: string; role: string; perms: string; name: string };
export type App = { Bindings: Env; Variables: { user: AuthUser; hotel: string; dev: string } };

export async function body<T = any>(c: Context<App>): Promise<T | null> {
  try { return (await c.req.json()) as T; } catch { return null; }
}
export const bad = (c: Context<App>, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, error: string) => c.json({ error }, status);
export const audit = (env: Env, hotel: string, user: string | null, action: string, detail: string) =>
  env.DB.prepare("INSERT INTO audit (hotel_id,at,user_id,action,detail) VALUES (?,?,?,?,?)").bind(hotel, Date.now(), user, action, detail.slice(0, 300)).run();
export const need = (c: Context<App>, perm: Perm) => permsOf(c.get("user")).has(perm);

/** The IP is shortened (last part dropped) so the log shows the area, not the exact address. */
export function shortIp(ip: string | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + ":…";
  const p = ip.split(".");
  return p.length === 4 ? p.slice(0, 3).join(".") + ".x" : null;
}

export async function logLogin(
  c: Context<App>,
  e: { hotel: string; user: string | null; who: string; kind: "owner" | "staff" | "signup"; ok: boolean; reason?: string; device: { id: string; name: string }; newDevice?: boolean },
) {
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO login_events (hotel_id,user_id,who,kind,ok,reason,device_id,device_name,ip,country,at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(e.hotel, e.user, e.who.slice(0, 120), e.kind, e.ok ? 1 : 0, e.reason ?? (e.newDevice ? "new device" : null), e.device.id, e.device.name.slice(0, 60), shortIp(c.req.header("CF-Connecting-IP")), c.req.header("cf-ipcountry") ?? null, now).run();
  // keep three months only
  await c.env.DB.prepare("DELETE FROM login_events WHERE hotel_id=? AND at<?").bind(e.hotel, now - 90 * 86400000).run();
}
