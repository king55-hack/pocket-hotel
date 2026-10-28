import { Hono } from "hono";
import { audit, bad, body, need, type App } from "./util";
import { sendMail } from "./mail";
import { billEmail } from "./billEmail";

/**
 * Emails a bill (PDF) to a guest. The phone makes the PDF; the server only delivers it.
 * Safe by design: the hotel must have the feature (switched on by the admin), one recipient, only a PDF whose first bytes
 * match, a fixed sender and subject, and a daily limit per hotel.
 */
export const send = new Hono<App>();

const MAX_B64 = 1_200_000; // about 900 KB of file
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const emailOk = (e: unknown): e is string => typeof e === "string" && e.length <= 120 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e);
const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\r\n\t\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

send.post("/email", async (c) => {
  if (!need(c, "checkout") && !need(c, "booking.create")) return bad(c, 403, "forbidden");
  const b = await body(c);
  if (!b || !emailOk(b.to)) return bad(c, 400, "invalid_email" as never);
  const data = String(b.data ?? "");
  if (!data || data.length > MAX_B64) return bad(c, 400, "too_big" as never);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return bad(c, 400, "invalid_file" as never);
  let head: Uint8Array;
  try { head = Uint8Array.from(atob(data.slice(0, 8)), (ch) => ch.charCodeAt(0)); } catch { return bad(c, 400, "invalid_file" as never); }
  if (!PDF_MAGIC.every((x, i) => head[i] === x)) return bad(c, 400, "invalid_file" as never);

  const hotel = c.get("hotel");
  const h = await c.env.DB.prepare("SELECT name,feat FROM hotels WHERE id=?").bind(hotel).first<{ name: string; feat: string }>();
  if (!h || !JSON.parse(h.feat).email) return bad(c, 403, "feature_off" as never);

  const now = Date.now();
  const limit = Math.max(1, Number(c.env.MAIL_DAILY_LIMIT) || 100);
  const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE hotel_id=? AND at>?").bind(hotel, now - 86_400_000).first<{ n: number }>();
  if ((used?.n ?? 0) >= limit) return bad(c, 429, "limit");

  const name = clean(h.name, 60) || "Pocket Hotel";
  const billNo = clean(b.billNo, 40);
  const owner = await c.env.DB.prepare("SELECT email FROM users WHERE hotel_id=? AND role='owner' LIMIT 1").bind(hotel).first<{ email: string }>();
  const m = billEmail(name, billNo, clean(b.summary, 200));
  // Count it first so a failure cannot be retried without limit.
  await c.env.DB.prepare("INSERT INTO mail_log (hotel_id,at,kind) VALUES (?,?,?)").bind(hotel, now, "bill").run();
  const file = `bill-${billNo.replace(/[^\w-]/g, "") || "copy"}.pdf`;
  const sent = await sendMail(c.env, b.to, m.subject, m.text, { html: m.html, attachments: [{ filename: file, content: data }], replyTo: owner?.email });
  if (!sent) return bad(c, 503, "mail");
  await audit(c.env, hotel, c.get("user").id, "bill emailed", `${billNo} to ${mask(b.to)}`);
  return c.json({ ok: true });
});
