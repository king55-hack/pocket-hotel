import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV, addStaff, call, signup } from "./helpers";

const H = { "x-admin-key": "admin-key-for-tests" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF").toString("base64");
const sent: any[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function setup(emailOn = true) {
  const env = { ...ENV(), RESEND_API_KEY: "re_test", MAIL_FROM: "Pocket Hotel <a@b.com>" };
  const a = await signup(env, "Himal Lodge");
  if (emailOn) await call(env, `/admin/hotels/${a.hotel.id}/features`, { headers: H, body: { feat: { email: true } } });
  sent.length = 0; // signup itself sent an email code
  return { env, a };
}
const body = (over: object = {}) => ({ to: "guest@example.com", billNo: "INV-0007", summary: "Total Rs 5,180", data: PDF, ...over });

describe("emailing a bill", () => {
  it("sends one email with the PDF attached, a fixed subject, and writes it to the log", async () => {
    const { env, a } = await setup();
    const r = await call(env, "/send/email", { token: a.tok, body: body() });
    expect(r.s).toBe(200);
    expect(sent).toHaveLength(1);
    const m = sent[0].body;
    expect(m.to).toEqual(["guest@example.com"]);
    expect(m.subject).toBe("Himal Lodge: बिल / Bill INV-0007");
    expect(m.attachments[0]).toMatchObject({ filename: "bill-INV-0007.pdf", content: PDF });
    expect(m.html).toContain("Total Rs 5,180");
    expect(m.reply_to).toBe(a.email);
    const log = (await call(env, "/audit", { token: a.tok })).j.audit;
    expect(log[0]).toMatchObject({ action: "bill emailed" });
    expect(log[0].detail).toContain("g***@example.com"); // the address is masked in the log
  });

  it("is refused when the admin has not switched the feature on, or without a login", async () => {
    const { env, a } = await setup(false);
    expect((await call(env, "/send/email", { token: a.tok, body: body() })).j.error).toBe("feature_off");
    expect((await call(env, "/send/email", { body: body() })).s).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("only people who take bookings or check out may send", async () => {
    const { env, a } = await setup();
    const w = await addStaff(env, a.tok, a.hotel.code, "waiter", "restaurant");
    expect((await call(env, "/send/email", { token: w.tok, body: body() })).s).toBe(403);
    const d = await addStaff(env, a.tok, a.hotel.code, "desk", "reception");
    expect((await call(env, "/send/email", { token: d.tok, body: body() })).s).toBe(200);
  });

  it("refuses anything that is not a PDF, bad or several addresses, and big files", async () => {
    const { env, a } = await setup();
    const send = (o: object) => call(env, "/send/email", { token: a.tok, body: body(o) });
    expect((await send({ data: Buffer.from("not a pdf at all").toString("base64") })).j.error).toBe("invalid_file");
    expect((await send({ data: "%%%" })).j.error).toBe("invalid_file");
    expect((await send({ to: "a@b.com, c@d.com" })).j.error).toBe("invalid_email");
    expect((await send({ to: "a@b.com\r\nBcc: x@y.com" })).j.error).toBe("invalid_email");
    expect((await send({ to: "nope" })).j.error).toBe("invalid_email");
    expect((await send({ data: "A".repeat(1_300_000) })).j.error).toBe("too_big");
    expect(sent).toHaveLength(0);
  });

  it("the file name and subject cannot be chosen by the sender", async () => {
    const { env, a } = await setup();
    await call(env, "/send/email", { token: a.tok, body: body({ billNo: "../../x\r\nBcc: bad@example.com", filename: "evil.exe", subject: "Win a prize" }) });
    const m = sent[0].body;
    expect(m.subject).not.toContain("prize");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.attachments[0].filename).toMatch(/^bill-[\w-]*\.pdf$/);
  });

  it("stops at the daily limit, and says so when no email service is set", async () => {
    const { env, a } = await setup();
    (env as any).MAIL_DAILY_LIMIT = "2";
    expect((await call(env, "/send/email", { token: a.tok, body: body() })).s).toBe(200);
    expect((await call(env, "/send/email", { token: a.tok, body: body() })).s).toBe(200);
    expect((await call(env, "/send/email", { token: a.tok, body: body() })).j.error).toBe("limit");
    const none = { ...ENV() };
    const b = await signup(none, "NoMail");
    await call(none, `/admin/hotels/${b.hotel.id}/features`, { headers: H, body: { feat: { email: true } } });
    expect((await call(none, "/send/email", { token: b.tok, body: body() })).j.error).toBe("mail");
  });
});
