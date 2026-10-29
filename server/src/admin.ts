import { Hono } from "hono";
import { type App } from "./util";
import { safeEqual, sha256 } from "./crypto";
import { sendMail, type Env } from "./mail";
import { FEATURE_KEYS, featOf } from "./perms";

/** The seller's own tools. Every route needs the ADMIN_KEY; wrong keys are counted per address. */
export const admin = new Hono<App>();
const DAY = 86_400_000;
const like = (q: string) => "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";

admin.use("*", async (c, next) => {
  const key = "admin:" + (c.req.header("CF-Connecting-IP") ?? "local");
  const fails = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM admin_attempts WHERE key=? AND at>?").bind(key, Date.now() - 15 * 60_000).first<{ n: number }>();
  if ((fails?.n ?? 0) >= 10) return c.json({ error: "locked" }, 429);
  const given = c.req.header("x-admin-key") ?? "";
  if (!c.env.ADMIN_KEY || !given || !safeEqual(given, c.env.ADMIN_KEY)) {
    await c.env.DB.prepare("INSERT INTO admin_attempts (key,at) VALUES (?,?)").bind(key, Date.now()).run();
    return c.json({ error: "forbidden" }, 403);
  }
  c.header("X-Robots-Tag", "noindex");
  await next();
});

admin.get("/stats", async (c) => {
  const one = async (sql: string, ...a: unknown[]) => (await c.env.DB.prepare(sql).bind(...a).first<{ n: number }>())?.n ?? 0;
  const now = Date.now();
  return c.json({
    hotels: await one("SELECT COUNT(*) AS n FROM hotels"),
    newThisWeek: await one("SELECT COUNT(*) AS n FROM hotels WHERE created_at>?", now - 7 * DAY),
    activeDevices30d: await one("SELECT COUNT(*) AS n FROM devices WHERE revoked=0 AND last_seen>?", now - 30 * DAY),
    waitingRequests: await one("SELECT COUNT(*) AS n FROM closure_requests WHERE status='pending'"),
    scheduledDeletions: await one("SELECT COUNT(*) AS n FROM closure_requests WHERE status='approved'"),
  });
});

admin.get("/hotels", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 60);
  const r = await c.env.DB.prepare(
    `SELECT h.id,h.name,h.code,h.plan,h.feat,h.created_at,o.email,
      (SELECT COUNT(*) FROM users u WHERE u.hotel_id=h.id AND u.role<>'owner' AND u.active=1) AS staff,
      (SELECT COUNT(*) FROM devices d WHERE d.hotel_id=h.id AND d.revoked=0) AS devices,
      (SELECT COUNT(*) FROM records x WHERE x.hotel_id=h.id) AS records
     FROM hotels h JOIN users o ON o.hotel_id=h.id AND o.role='owner'
     WHERE (?1='' OR h.name LIKE ?2 ESCAPE '\\' OR o.email LIKE ?2 ESCAPE '\\') ORDER BY h.created_at DESC LIMIT 100`,
  ).bind(q, like(q)).all<any>();
  return c.json({ hotels: r.results.map((h) => ({ ...h, feat: featOf(h.feat) })) });
});

admin.get("/hotels/:id/logins", async (c) => {
  const r = await c.env.DB.prepare("SELECT id,who,kind,ok,reason,device_name,ip,country,at FROM login_events WHERE hotel_id=? ORDER BY id DESC LIMIT 200").bind(c.req.param("id")).all();
  return c.json({ logins: r.results });
});

/** The admin decides which features each hotel gets. */
admin.post("/hotels/:id/features", async (c) => {
  const b: any = await c.req.json().catch(() => null);
  if (!b || typeof b.feat !== "object" || !b.feat) return c.json({ error: "invalid" }, 400);
  const h = await c.env.DB.prepare("SELECT feat FROM hotels WHERE id=?").bind(c.req.param("id")).first<{ feat: string }>();
  if (!h) return c.json({ error: "not_found" }, 404);
  const feat = featOf(h.feat);
  for (const k of FEATURE_KEYS) if (typeof b.feat[k] === "boolean") feat[k] = b.feat[k];
  await c.env.DB.prepare("UPDATE hotels SET feat=? WHERE id=?").bind(JSON.stringify(feat), c.req.param("id")).run();
  if (typeof b.plan === "string" && ["free", "basic", "pro"].includes(b.plan)) await c.env.DB.prepare("UPDATE hotels SET plan=? WHERE id=?").bind(b.plan, c.req.param("id")).run();
  return c.json({ ok: true, feat });
});

admin.get("/closures", async (c) => {
  const st = c.req.query("status") ?? "";
  const r = await c.env.DB.prepare(`SELECT * FROM closure_requests ${["pending", "approved", "rejected", "cancelled", "done"].includes(st) ? "WHERE status=?" : "WHERE ?<>'x'"} ORDER BY requested_at DESC LIMIT 100`).bind(st || "all").all();
  return c.json({ requests: r.results });
});

const tell = async (env: Env, to: string, subject: string, text: string) => { await sendMail(env, to, subject, text).catch(() => false); };

admin.post("/closures/:id/approve", async (c) => {
  const b: any = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare("SELECT * FROM closure_requests WHERE id=? AND status='pending'").bind(c.req.param("id")).first<any>();
  if (!r) return c.json({ error: "not_pending" }, 404);
  const grace = b.graceDays === undefined ? 14 : Math.max(0, Math.min(60, Number(b.graceDays)));
  if (!Number.isFinite(grace)) return c.json({ error: "invalid" }, 400);
  const now = Date.now(), at = now + grace * DAY;
  await c.env.DB.prepare("UPDATE closure_requests SET status='approved', decided_at=?, scheduled_at=?, decision_note=? WHERE id=?").bind(now, at, typeof b.note === "string" ? b.note.slice(0, 500) : null, r.id).run();
  await tell(c.env, r.owner_email, "Pocket Hotel: account deletion approved", `तपाईंको खाता मेटाउने अनुरोध स्वीकृत भयो। सर्भरको डाटा ${new Date(at).toISOString().slice(0, 10)} मा मेटिन्छ। त्यसअघि रद्द गर्न मिल्छ।\nApproved. Server data will be erased on ${new Date(at).toISOString().slice(0, 10)}. You can cancel before then.`);
  return c.json({ ok: true, scheduledAt: at });
});

admin.post("/closures/:id/reject", async (c) => {
  const b: any = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare("UPDATE closure_requests SET status='rejected', decided_at=?, decision_note=? WHERE id=? AND status='pending' RETURNING owner_email").bind(Date.now(), typeof b.note === "string" ? b.note.slice(0, 500) : null, c.req.param("id")).first<{ owner_email: string }>();
  if (!r) return c.json({ error: "not_pending" }, 404);
  await tell(c.env, r.owner_email, "Pocket Hotel: request not approved", `तपाईंको अनुरोध स्वीकृत भएन।\nYour request was not approved.${b.note ? "\n" + String(b.note).slice(0, 500) : ""}`);
  return c.json({ ok: true });
});

admin.post("/run-deletions", async (c) => c.json({ ok: true, ...(await runDueDeletions(c.env)) }));

export async function purgeHotel(env: Env, hotelId: string) {
  const users = (await env.DB.prepare("SELECT id,email FROM users WHERE hotel_id=?").bind(hotelId).all<{ id: string; email: string | null }>()).results;
  const owner = users.find((u) => u.email);
  const stmts = [
    ...users.flatMap((u) => [
      env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id=?").bind(u.id),
      ...(u.email ? [env.DB.prepare("DELETE FROM otps WHERE email=?").bind(u.email), env.DB.prepare("DELETE FROM login_attempts WHERE key IN (?,?)").bind("owner:" + u.email, "closure:" + u.email)] : []),
    ]),
    ...["records", "conflicts", "audit", "login_events", "mail_log", "devices", "users"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE hotel_id=?`).bind(hotelId)),
    env.DB.prepare("DELETE FROM hotels WHERE id=?").bind(hotelId),
  ];
  await env.DB.batch(stmts);
  // Keep the request (reason and dates) but not who they were.
  const anon = owner?.email ? "deleted:" + (await sha256(owner.email)).slice(0, 16) : "deleted";
  await env.DB.prepare("UPDATE closure_requests SET status=CASE WHEN status='approved' THEN 'done' WHEN status='pending' THEN 'cancelled' ELSE status END, done_at=?, owner_email=?, hotel_name='(deleted)' WHERE hotel_id=?").bind(Date.now(), anon, hotelId).run();
}

export async function runDueDeletions(env: Env): Promise<{ deleted: number }> {
  const due = (await env.DB.prepare("SELECT DISTINCT hotel_id FROM closure_requests WHERE status='approved' AND scheduled_at<=?").bind(Date.now()).all<{ hotel_id: string }>()).results;
  for (const d of due) await purgeHotel(env, d.hotel_id);
  return { deleted: due.length };
}
