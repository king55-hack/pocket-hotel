import { Hono } from "hono";
import { audit, bad, body, need, type App } from "./util";
import { hashPassword, randomHex } from "./crypto";
import { ROLE_DEFAULTS, isPerm, isRole, permsOf, type Perm, type Role } from "./perms";

export const staff = new Hono<App>();

staff.use("*", async (c, next) => {
  if (!need(c, "staff.manage")) return bad(c, 403, "forbidden");
  await next();
});

const USERNAME = /^[a-z0-9._-]{3,30}$/;
const PIN = /^\d{6,10}$/;
const WEAK = new Set(["000000", "111111", "123456", "654321", "121212", "123123", "112233", "0000000", "1234567", "12345678"]);
const pinOk = (p: unknown): p is string => typeof p === "string" && PIN.test(p) && !WEAK.has(p);
const view = (u: any) => ({ id: u.id, name: u.name, username: u.username, role: u.role, perms: [...permsOf(u)], active: !!u.active, email: u.email ?? null });

staff.get("/", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM users WHERE hotel_id=? ORDER BY created_at").bind(c.get("hotel")).all<any>();
  return c.json({ staff: r.results.map(view) });
});

/** Nobody can hand out a right they do not have themselves. */
function grantable(c: any, wanted: unknown): Perm[] | null {
  if (!Array.isArray(wanted) || !wanted.every(isPerm)) return null;
  const mine = permsOf(c.get("user"));
  return wanted.every((p: Perm) => mine.has(p)) ? [...new Set(wanted)] : null;
}

staff.post("/", async (c) => {
  const b = await body(c);
  if (!b || typeof b.name !== "string" || !b.name.trim() || b.name.length > 80 || typeof b.username !== "string" || !USERNAME.test(b.username.toLowerCase()) || !isRole(b.role) || b.role === "owner" || !pinOk(b.pin)) return bad(c, 400, "invalid");
  const mine = permsOf(c.get("user"));
  const perms = b.perms === undefined ? ROLE_DEFAULTS[b.role as Role].filter((p: Perm) => mine.has(p)) : grantable(c, b.perms);
  if (!perms) return bad(c, 403, "cannot_grant");
  const hotel = c.get("hotel"), username = b.username.toLowerCase();
  if (await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE hotel_id=? AND username=?").bind(hotel, username).first()) return bad(c, 409, "exists");
  const salt = randomHex(12), id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO users (id,hotel_id,username,name,role,perms,salt,hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, hotel, username, b.name.trim(), b.role, JSON.stringify(perms), salt, await hashPassword(b.pin, salt), Date.now()).run();
  await audit(c.env, hotel, c.get("user").id, "staff added", `${username} ${b.role}`);
  return c.json({ ok: true, id });
});

staff.post("/:id", async (c) => {
  const b = await body(c);
  if (!b) return bad(c, 400, "invalid");
  const hotel = c.get("hotel"), me = c.get("user");
  const t = await c.env.DB.prepare("SELECT * FROM users WHERE id=? AND hotel_id=?").bind(c.req.param("id"), hotel).first<any>();
  if (!t) return bad(c, 404, "not_found");
  if (t.role === "owner" || t.id === me.id) return bad(c, 403, "forbidden"); // nobody edits the owner or themselves here
  const mine = permsOf(me);
  if (me.role !== "owner" && [...permsOf(t)].some((p) => !mine.has(p))) return bad(c, 403, "forbidden"); // a person with more rights than me is not mine to change
  const set: string[] = [], vals: unknown[] = [];
  let kill = false;
  if (b.name !== undefined) { if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 80) return bad(c, 400, "invalid"); set.push("name=?"); vals.push(b.name.trim()); }
  if (b.role !== undefined) { if (!isRole(b.role) || b.role === "owner") return bad(c, 400, "invalid"); set.push("role=?"); vals.push(b.role); }
  if (b.perms !== undefined) { const p = grantable(c, b.perms); if (!p) return bad(c, 403, "cannot_grant"); set.push("perms=?"); vals.push(JSON.stringify(p)); }
  if (b.active !== undefined) { if (typeof b.active !== "boolean") return bad(c, 400, "invalid"); set.push("active=?"); vals.push(b.active ? 1 : 0); if (!b.active) kill = true; }
  if (b.pin !== undefined) {
    if (!pinOk(b.pin)) return bad(c, 400, "invalid");
    const salt = randomHex(12);
    set.push("salt=?", "hash=?"); vals.push(salt, await hashPassword(b.pin, salt));
    kill = true; // a new PIN signs the person out everywhere
  }
  if (!set.length) return bad(c, 400, "invalid");
  await c.env.DB.prepare(`UPDATE users SET ${set.join(",")} WHERE id=? AND hotel_id=?`).bind(...vals, t.id, hotel).run();
  if (kill) await c.env.DB.prepare("UPDATE refresh_tokens SET revoked=1 WHERE user_id=?").bind(t.id).run();
  await audit(c.env, hotel, me.id, "staff changed", `${t.username}: ${Object.keys(b).filter((k) => k !== "pin").join(",")}${b.pin ? " pin" : ""}`);
  return c.json({ ok: true });
});
