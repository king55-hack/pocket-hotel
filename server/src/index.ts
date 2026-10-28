import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { hashPassword, randomHex, safeEqual, sha256, signJwt, verifyJwt } from "./crypto";
import { sendMail, type Env } from "./mail";
import { otpEmail } from "./otpEmail";
import { DEFAULT_FEATURES, PERMS, permsOf } from "./perms";
import { audit, bad, body, logLogin, need, type App } from "./util";
import { sync } from "./sync";
import { staff } from "./staff";
import { account } from "./account";
import { send } from "./send";
import { admin, runDueDeletions } from "./admin";

const app = new Hono<App>();

const DAY = 86400000;
const emailOk = (e: unknown): e is string => typeof e === "string" && e.length < 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const norm = (e: string) => e.trim().toLowerCase();
const uid = () => crypto.randomUUID();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

app.use("*", async (c, next) => {
  const origins = (c.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
  return cors({ origin: (o) => (origins.includes(o) ? o : ""), allowHeaders: ["Authorization", "Content-Type", "x-admin-key"], allowMethods: ["GET", "POST", "OPTIONS"], maxAge: 600 })(c, next);
});

app.use("*", async (c, next) => {
  // A weak secret would make every login token forgeable, so refuse to serve rather than run unsafely.
  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) return c.json({ error: "misconfigured" }, 500);
  if (Number(c.req.header("content-length") ?? 0) > 2 * 1024 * 1024) return c.json({ error: "too_big" }, 413);
  await next();
  const h = c.res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  h.set("Cross-Origin-Resource-Policy", "same-site");
  h.set("Cache-Control", "no-store");
});

/* ---------- OTP by email ---------- */
async function issueOtp(env: Env, email: string, purpose: "signup" | "login" | "reset") {
  const now = Date.now();
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM otps WHERE email=? AND created_at>?").bind(email, now - 3600_000).first<{ n: number }>();
  if ((r?.n ?? 0) >= 5) return { error: "rate" as const };
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await env.DB.prepare("INSERT INTO otps (email,purpose,code_hash,expires,created_at) VALUES (?,?,?,?,?)").bind(email, purpose, await sha256(`${code}:${email}:${env.JWT_SECRET}`), now + 10 * 60_000, now).run();
  const m = otpEmail(code, env.APP_URL ?? "https://pocket-hotel.dahal-khani.workers.dev", purpose === "reset" ? "reset" : "code");
  const sent = await sendMail(env, email, m.subject, m.text, { html: m.html });
  if (!sent && env.DEV_RETURN_OTP !== "1") {
    await env.DB.prepare("DELETE FROM otps WHERE email=? AND created_at=?").bind(email, now).run();
    return { error: "mail" as const }; // say so now, instead of leaving the person waiting for mail that never comes
  }
  return { ok: true as const, devCode: env.DEV_RETURN_OTP === "1" ? code : undefined };
}
async function checkOtp(env: Env, email: string, purpose: string, code: unknown) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const row = await env.DB.prepare("SELECT id,code_hash,attempts FROM otps WHERE email=? AND purpose=? AND used=0 AND expires>? ORDER BY id DESC LIMIT 1").bind(email, purpose, Date.now()).first<{ id: number; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= 5) return false;
  await env.DB.prepare("UPDATE otps SET attempts=attempts+1 WHERE id=?").bind(row.id).run();
  if (!safeEqual(row.code_hash, await sha256(`${code}:${email}:${env.JWT_SECRET}`))) return false;
  await env.DB.prepare("UPDATE otps SET used=1 WHERE id=?").bind(row.id).run();
  return true;
}

/* ---------- tokens and devices ---------- */
async function tokens(env: Env, userId: string, hotelId: string, deviceId: string) {
  const access = await signJwt({ sub: userId, hotel: hotelId, dev: deviceId }, env.JWT_SECRET, 15 * 60);
  const rid = randomHex(8), secret = randomHex(32);
  await env.DB.prepare("INSERT INTO refresh_tokens (id,user_id,device_id,hash,expires) VALUES (?,?,?,?,?)").bind(rid, userId, deviceId, await sha256(secret), Date.now() + 60 * DAY).run();
  return { access, refresh: `${rid}.${secret}`, expiresIn: 15 * 60 };
}
const deviceOk = (d: any): d is { id: string; name: string } => d && typeof d.id === "string" && d.id.length >= 8 && d.id.length <= 64 && typeof d.name === "string";

/** false when this device id already belongs to another hotel: nobody may take over another hotel's device record. */
async function upsertDevice(env: Env, id: string, hotelId: string, userId: string, name: string, ownerOk = false): Promise<boolean> {
  const ex = await env.DB.prepare("SELECT hotel_id,revoked FROM devices WHERE id=?").bind(id).first<{ hotel_id: string; revoked: number }>();
  const now = Date.now();
  if (!ex) await env.DB.prepare("INSERT INTO devices (id,hotel_id,user_id,name,owner_ok,created_at,last_seen) VALUES (?,?,?,?,?,?,?)").bind(id, hotelId, userId, name.slice(0, 60), ownerOk ? 1 : 0, now, now).run();
  else if (ex.hotel_id !== hotelId) return false;
  else await env.DB.prepare("UPDATE devices SET user_id=?,name=?,last_seen=?,owner_ok=MAX(owner_ok,?) WHERE id=?").bind(userId, name.slice(0, 60), now, ownerOk ? 1 : 0, id).run();
  return true;
}

async function hotelInfo(env: Env, hotelId: string) {
  const h = await env.DB.prepare("SELECT id,name,code,plan,feat FROM hotels WHERE id=?").bind(hotelId).first<any>();
  return h && { id: h.id, name: h.name, code: h.code, plan: h.plan, feat: JSON.parse(h.feat) };
}
async function session(env: Env, u: any, deviceId: string) {
  return { ...(await tokens(env, u.id, u.hotel_id, deviceId)), user: { id: u.id, name: u.name, role: u.role, perms: [...permsOf(u)] }, hotel: await hotelInfo(env, u.hotel_id) };
}

/* ---------- public routes ---------- */
app.get("/health", (c) => c.json({ ok: true, time: Date.now() }));

app.post("/auth/otp", async (c) => {
  const b = await body(c);
  if (!b || !emailOk(b.email) || !["signup", "login"].includes(b.purpose)) return bad(c, 400, "invalid");
  const email = norm(b.email);
  const exists = await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE email=?").bind(email).first();
  if (b.purpose === "signup" && exists) return bad(c, 409, "exists");
  if (b.purpose === "login" && !exists) return c.json({ ok: true }); // do not reveal who has an account
  const r = await issueOtp(c.env, email, b.purpose);
  if ("error" in r) return r.error === "mail" ? bad(c, 503, "mail") : bad(c, 429, "rate");
  return c.json({ ok: true, devCode: r.devCode });
});

/**
 * Forgot password: a code goes to the owner's email, and the code lets them choose a new password.
 * The reply never says whether the email has an account. A new password signs the owner out everywhere.
 */
app.post("/auth/reset/otp", async (c) => {
  const b = await body(c);
  if (!b || !emailOk(b.email)) return bad(c, 400, "invalid");
  const email = norm(b.email);
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE email=? AND active=1").bind(email).first();
  if (!u) return c.json({ ok: true });
  const r = await issueOtp(c.env, email, "reset");
  if ("error" in r) return r.error === "mail" ? bad(c, 503, "mail") : bad(c, 429, "rate");
  return c.json({ ok: true, devCode: r.devCode });
});

app.post("/auth/reset", async (c) => {
  const b = await body(c);
  if (!b || !emailOk(b.email) || typeof b.password !== "string" || b.password.length < 8 || b.password.length > 200) return bad(c, 400, "invalid");
  const email = norm(b.email);
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE email=? AND active=1").bind(email).first<any>();
  // the same answer for an unknown email and for a wrong code
  if (!u || !(await checkOtp(c.env, email, "reset", b.code))) return bad(c, 401, "bad_code");
  const salt = randomHex(12);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").bind(salt, await hashPassword(b.password, salt), u.id),
    c.env.DB.prepare("UPDATE refresh_tokens SET revoked=1 WHERE user_id=?").bind(u.id),
    c.env.DB.prepare("DELETE FROM login_attempts WHERE key IN (?,?)").bind("owner:" + email, "closure:" + email),
  ]);
  await audit(c.env, u.hotel_id, u.id, "password reset", "by email code");
  await logLogin(c, { hotel: u.hotel_id, user: u.id, who: email, kind: "owner", ok: true, reason: "password reset", device: { id: "", name: "password reset" } });
  return c.json({ ok: true });
});

app.post("/auth/signup", async (c) => {
  const b = await body(c);
  if (!b || !emailOk(b.email) || typeof b.password !== "string" || b.password.length < 8 || b.password.length > 200 || !deviceOk(b.device) || typeof b.hotelName !== "string" || !b.hotelName.trim()) return bad(c, 400, "invalid");
  const email = norm(b.email);
  if (await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE email=?").bind(email).first()) return bad(c, 409, "exists");
  if (await c.env.DB.prepare("SELECT 1 AS x FROM devices WHERE id=?").bind(b.device.id).first()) return bad(c, 409, "device_conflict");
  if (!(await checkOtp(c.env, email, "signup", b.code))) return bad(c, 401, "bad_code");
  const now = Date.now(), hotelId = uid(), userId = uid(), salt = randomHex(12);
  let code = newCode();
  while (await c.env.DB.prepare("SELECT 1 AS x FROM hotels WHERE code=?").bind(code).first()) code = newCode();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO hotels (id,name,code,feat,created_at) VALUES (?,?,?,?,?)").bind(hotelId, String(b.hotelName).trim().slice(0, 100), code, JSON.stringify(DEFAULT_FEATURES), now),
    c.env.DB.prepare("INSERT INTO users (id,hotel_id,email,name,role,perms,salt,hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(userId, hotelId, email, String(b.name || "").slice(0, 80), "owner", JSON.stringify(PERMS), salt, await hashPassword(b.password, salt), now),
  ]);
  await upsertDevice(c.env, b.device.id, hotelId, userId, b.device.name, true);
  await logLogin(c, { hotel: hotelId, user: userId, who: email, kind: "signup", ok: true, device: b.device });
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userId).first<any>();
  return c.json(await session(c.env, u, b.device.id));
});

app.post("/auth/login", async (c) => {
  const b = await body(c);
  if (!b || !emailOk(b.email) || typeof b.password !== "string" || b.password.length > 200 || !deviceOk(b.device)) return bad(c, 400, "invalid");
  const email = norm(b.email), key = "owner:" + email;
  if (await tooMany(c.env, key, 8)) return bad(c, 429, "locked");
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE email=? AND active=1").bind(email).first<any>();
  const good = u ? safeEqual(await hashPassword(b.password, u.salt), u.hash) : (await hashPassword(b.password, "x".repeat(24)), false);
  if (!u || !good) {
    await fail(c.env, key);
    if (u) await logLogin(c, { hotel: u.hotel_id, user: u.id, who: email, kind: "owner", ok: false, reason: "wrong password", device: b.device });
    return bad(c, 401, "bad_login");
  }
  const dev = await c.env.DB.prepare("SELECT hotel_id,revoked,owner_ok FROM devices WHERE id=?").bind(b.device.id).first<{ hotel_id: string; revoked: number; owner_ok: number }>();
  if (dev && dev.hotel_id !== u.hotel_id) return bad(c, 409, "device_conflict");
  if (dev?.revoked) return bad(c, 403, "device_revoked");
  if (!dev?.owner_ok) {
    // A device we have not seen must prove it has the email inbox.
    if (!b.code) {
      const r = await issueOtp(c.env, email, "login");
      if ("error" in r && r.error === "mail") return bad(c, 503, "mail");
      return c.json({ error: "otp_required", devCode: "error" in r ? undefined : r.devCode }, 401);
    }
    if (!(await checkOtp(c.env, email, "login", b.code))) {
      await logLogin(c, { hotel: u.hotel_id, user: u.id, who: email, kind: "owner", ok: false, reason: "wrong email code", device: b.device });
      return bad(c, 401, "bad_code");
    }
  }
  if (!(await upsertDevice(c.env, b.device.id, u.hotel_id, u.id, b.device.name, true))) return bad(c, 409, "device_conflict");
  await logLogin(c, { hotel: u.hotel_id, user: u.id, who: email, kind: "owner", ok: true, device: b.device, newDevice: !dev });
  return c.json(await session(c.env, u, b.device.id));
});

/** Staff sign in with the hotel code, their login name and a PIN. They never get an email. */
app.post("/auth/staff", async (c) => {
  const b = await body(c);
  if (!b || typeof b.hotelCode !== "string" || typeof b.username !== "string" || typeof b.pin !== "string" || b.pin.length > 20 || !deviceOk(b.device)) return bad(c, 400, "invalid");
  const code = b.hotelCode.trim().toUpperCase(), username = b.username.trim().toLowerCase();
  const key = `staff:${code}:${username}`;
  if (await tooMany(c.env, key, 5)) return bad(c, 429, "locked");
  const u = await c.env.DB.prepare("SELECT u.* FROM users u JOIN hotels h ON h.id=u.hotel_id WHERE h.code=? AND u.username=? AND u.active=1").bind(code, username).first<any>();
  const good = u ? safeEqual(await hashPassword(b.pin, u.salt), u.hash) : (await hashPassword(b.pin, "x".repeat(24)), false);
  if (!u || !good) {
    await fail(c.env, key);
    if (u) await logLogin(c, { hotel: u.hotel_id, user: u.id, who: username, kind: "staff", ok: false, reason: "wrong PIN", device: b.device });
    return bad(c, 401, "bad_login");
  }
  const dev = await c.env.DB.prepare("SELECT hotel_id,revoked FROM devices WHERE id=?").bind(b.device.id).first<{ hotel_id: string; revoked: number }>();
  if (dev?.revoked) return bad(c, 403, "device_revoked");
  if (!(await upsertDevice(c.env, b.device.id, u.hotel_id, u.id, b.device.name))) return bad(c, 409, "device_conflict");
  await logLogin(c, { hotel: u.hotel_id, user: u.id, who: username, kind: "staff", ok: true, device: b.device, newDevice: !dev });
  return c.json(await session(c.env, u, b.device.id));
});

async function tooMany(env: Env, key: string, max: number) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key=? AND at>?").bind(key, Date.now() - 15 * 60_000).first<{ n: number }>();
  return (r?.n ?? 0) >= max;
}
const fail = (env: Env, key: string) => env.DB.prepare("INSERT INTO login_attempts (key,at) VALUES (?,?)").bind(key, Date.now()).run();

app.post("/auth/refresh", async (c) => {
  const b = await body(c);
  const [rid, secret] = String(b?.refresh ?? "").split(".");
  if (!rid || !secret) return bad(c, 400, "invalid");
  const r = await c.env.DB.prepare("SELECT * FROM refresh_tokens WHERE id=?").bind(rid).first<any>();
  if (!r || r.revoked || r.expires < Date.now() || !safeEqual(r.hash, await sha256(secret))) return bad(c, 401, "bad_refresh");
  const d = await c.env.DB.prepare("SELECT revoked FROM devices WHERE id=?").bind(r.device_id).first<any>();
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE id=? AND active=1").bind(r.user_id).first<any>();
  if (!d || d.revoked || !u) return bad(c, 403, "device_revoked");
  await c.env.DB.prepare("UPDATE refresh_tokens SET revoked=1 WHERE id=?").bind(rid).run();
  return c.json(await session(c.env, u, r.device_id));
});

/* ---------- everything below needs a valid token from a live device and an active user ---------- */
async function auth(c: Context<App>, next: () => Promise<void>) {
  const h = c.req.header("Authorization") ?? "";
  const p = h.startsWith("Bearer ") ? await verifyJwt(h.slice(7), c.env.JWT_SECRET) : null;
  if (!p) return bad(c, 401, "unauthorized");
  const d = await c.env.DB.prepare("SELECT revoked FROM devices WHERE id=? AND hotel_id=?").bind(p.dev, p.hotel).first<{ revoked: number }>();
  const u = await c.env.DB.prepare("SELECT id,role,perms,name,active FROM users WHERE id=? AND hotel_id=?").bind(p.sub, p.hotel).first<any>();
  if (!d || d.revoked || !u || !u.active) return bad(c, 403, "device_revoked");
  c.set("user", { id: u.id, role: u.role, perms: u.perms, name: u.name });
  c.set("hotel", p.hotel);
  c.set("dev", p.dev);
  await next();
}
for (const p of ["/me", "/staff", "/staff/*", "/devices", "/devices/*", "/audit", "/logins", "/send/*", "/sync/*", "/account/*", "/auth/logout"]) app.use(p, auth);


app.post("/auth/logout", async (c) => {
  await c.env.DB.prepare("UPDATE refresh_tokens SET revoked=1 WHERE device_id=? AND user_id=?").bind(c.get("dev"), c.get("user").id).run();
  return c.json({ ok: true });
});

app.get("/me", async (c) => {
  const u = c.get("user");
  return c.json({ user: { id: u.id, name: u.name, role: u.role, perms: [...permsOf(u)] }, hotel: await hotelInfo(c.env, c.get("hotel")), serverTime: Date.now() });
});

app.get("/devices", async (c) => {
  if (!need(c, "staff.manage")) return bad(c, 403, "forbidden");
  const r = await c.env.DB.prepare("SELECT d.id,d.name,d.revoked,d.created_at,d.last_seen,u.name AS user FROM devices d LEFT JOIN users u ON u.id=d.user_id WHERE d.hotel_id=? ORDER BY d.last_seen DESC").bind(c.get("hotel")).all();
  return c.json({ devices: r.results, current: c.get("dev") });
});
app.post("/devices/:id/revoke", async (c) => {
  if (!need(c, "staff.manage")) return bad(c, 403, "forbidden");
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("UPDATE devices SET revoked=1 WHERE id=? AND hotel_id=? RETURNING id").bind(id, c.get("hotel")).first();
  if (!r) return bad(c, 404, "not_found");
  await c.env.DB.prepare("UPDATE refresh_tokens SET revoked=1 WHERE device_id=?").bind(id).run();
  await audit(c.env, c.get("hotel"), c.get("user").id, "device revoked", id);
  return c.json({ ok: true });
});

/** Who signed in, from which device. Owner only. */
app.get("/logins", async (c) => {
  if (c.get("user").role !== "owner") return bad(c, 403, "forbidden");
  const r = await c.env.DB.prepare("SELECT id,who,kind,ok,reason,device_name,ip,country,at FROM login_events WHERE hotel_id=? ORDER BY id DESC LIMIT 200").bind(c.get("hotel")).all();
  return c.json({ logins: r.results });
});

app.get("/audit", async (c) => {
  if (!need(c, "reports.view")) return bad(c, 403, "forbidden");
  const r = await c.env.DB.prepare("SELECT a.id,a.at,a.action,a.detail,u.name AS user FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.hotel_id=? ORDER BY a.id DESC LIMIT 100").bind(c.get("hotel")).all();
  return c.json({ audit: r.results });
});

app.route("/sync", sync);
app.route("/staff", staff);
app.route("/account", account);
app.route("/send", send);
app.route("/admin", admin);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((e, c) => { console.log("error", e); return c.json({ error: "server" }, 500); });

export default {
  fetch: app.fetch,
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDueDeletions(env));
  },
};
