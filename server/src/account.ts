import { Hono } from "hono";
import { bad, body, type App } from "./util";
import { hashPassword, safeEqual } from "./crypto";
import { sendMail } from "./mail";

/**
 * The owner asks to close the account. Nothing is erased on the spot: the admin approves,
 * and the server data is erased 14 days after approval. The owner can cancel before that.
 */
export const account = new Hono<App>();

export const REASONS = ["too_expensive", "not_using", "missing_features", "hard_to_use", "other_app", "closing_business", "privacy", "problems", "other"] as const;

const row = (r: any) => r && ({ id: r.id, reason: r.reason_code, status: r.status, requestedAt: r.requested_at, decidedAt: r.decided_at, note: r.decision_note, scheduledAt: r.scheduled_at });

account.use("*", async (c, next) => {
  if (c.get("user").role !== "owner") return bad(c, 403, "forbidden");
  await next();
});

account.get("/closure", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM closure_requests WHERE hotel_id=? ORDER BY requested_at DESC LIMIT 1").bind(c.get("hotel")).first<any>();
  return c.json({ request: row(r) });
});

account.post("/closure", async (c) => {
  const b = await body(c);
  if (!b || !REASONS.includes(b.reasonCode) || typeof b.password !== "string" || b.password.length > 200) return bad(c, 400, "invalid");
  const text = b.reasonText == null ? "" : String(b.reasonText);
  if (text.length > 1000) return bad(c, 400, "invalid");
  if (b.reasonCode === "other" && text.trim().length < 3) return bad(c, 400, "reason_needed");
  const owner = await c.env.DB.prepare("SELECT id,email,salt,hash FROM users WHERE id=?").bind(c.get("user").id).first<any>();
  const key = "closure:" + owner.email;
  const fails = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key=? AND at>?").bind(key, Date.now() - 15 * 60_000).first<{ n: number }>();
  if ((fails?.n ?? 0) >= 5) return bad(c, 429, "locked");
  if (!safeEqual(await hashPassword(b.password, owner.salt), owner.hash)) {
    await c.env.DB.prepare("INSERT INTO login_attempts (key,at) VALUES (?,?)").bind(key, Date.now()).run();
    return bad(c, 403, "bad_password");
  }
  if (await c.env.DB.prepare("SELECT id FROM closure_requests WHERE hotel_id=? AND status IN ('pending','approved')").bind(c.get("hotel")).first()) return bad(c, 409, "already_open");
  const h = await c.env.DB.prepare("SELECT name FROM hotels WHERE id=?").bind(c.get("hotel")).first<{ name: string }>();
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO closure_requests (id,hotel_id,hotel_name,owner_email,reason_code,reason_text,status,requested_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, c.get("hotel"), h?.name ?? "", owner.email, b.reasonCode, text.trim() || null, "pending", Date.now()).run();
  const tasks = [sendMail(c.env, owner.email, "Pocket Hotel: we received your request", "तपाईंको खाता बन्द गर्ने अनुरोध प्राप्त भयो। हामी ७ दिनभित्र जाँच गर्छौं। स्वीकृत भएपछि १४ दिनमा सर्भरको डाटा मेटिन्छ। त्यसअघि रद्द गर्न मिल्छ।\nWe received your account closing request. We review it within 7 days. After approval the server data is erased 14 days later. You can cancel before that.")];
  if (c.env.ADMIN_EMAIL) tasks.push(sendMail(c.env, c.env.ADMIN_EMAIL, "Pocket Hotel: new closure request", `${h?.name} (${owner.email}) asked to close. Reason: ${b.reasonCode}\n${text.slice(0, 300)}`));
  try { c.executionCtx.waitUntil(Promise.allSettled(tasks)); } catch { /* no execution context in tests */ }
  return c.json({ ok: true, request: row(await c.env.DB.prepare("SELECT * FROM closure_requests WHERE id=?").bind(id).first()) });
});

account.post("/closure/cancel", async (c) => {
  const r = await c.env.DB.prepare("UPDATE closure_requests SET status='cancelled', decided_at=? WHERE hotel_id=? AND status IN ('pending','approved') RETURNING id").bind(Date.now(), c.get("hotel")).first();
  if (!r) return bad(c, 404, "nothing_to_cancel");
  return c.json({ ok: true });
});
