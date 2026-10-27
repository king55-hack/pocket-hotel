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
