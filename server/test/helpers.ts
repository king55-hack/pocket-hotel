import worker from "../src/index";
import { makeDB } from "./d1";

export const ENV = () => ({
  DB: makeDB(),
  JWT_SECRET: "test-secret-test-secret-test-secret-123456",
  ADMIN_KEY: "admin-key-for-tests",
  ALLOWED_ORIGINS: "http://localhost:5173",
  MAIL_FROM: "x",
  DEV_RETURN_OTP: "1",
});
export type TestEnv = ReturnType<typeof ENV>;

export async function call(env: TestEnv, path: string, o: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const r = await worker.fetch(
    new Request("http://api" + path, {
      method: o.method ?? (o.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}), ...(o.headers ?? {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    }),
    env as any,
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
  return { s: r.status, j: (await r.json().catch(() => ({}))) as any, h: r.headers };
}

let n = 0;
export async function signup(env: TestEnv, hotelName = "Hotel A") {
  n++;
  const email = `owner${n}@example.com`;
  const device = { id: `device-owner-${n}-${Math.random().toString(36).slice(2)}`, name: "Owner phone" };
  const o = await call(env, "/auth/otp", { body: { email, purpose: "signup" } });
  const r = await call(env, "/auth/signup", { body: { email, code: o.j.devCode, password: "secret-pass-1", name: "Owner", hotelName, device } });
  if (r.s !== 200) throw new Error("signup failed " + JSON.stringify(r.j));
  return { email, device, tok: r.j.access as string, refresh: r.j.refresh as string, hotel: r.j.hotel, user: r.j.user };
}

export async function addStaff(env: TestEnv, ownerTok: string, hotelCode: string, username: string, role: string, perms?: string[], pin = "482915") {
  const a = await call(env, "/staff", { token: ownerTok, body: { name: username, username, role, pin, ...(perms ? { perms } : {}) } });
  if (a.s !== 200) throw new Error("add staff failed " + JSON.stringify(a.j));
  const device = { id: `device-${username}-${Math.random().toString(36).slice(2)}`, name: username + " phone" };
  const l = await call(env, "/auth/staff", { body: { hotelCode, username, pin, device } });
  if (l.s !== 200) throw new Error("staff login failed " + JSON.stringify(l.j));
  return { id: a.j.id as string, tok: l.j.access as string, device, pin };
}

const now = Date.now();
export const room = (n: string, over: Record<string, unknown> = {}) => ({ n, type: "Double", floor: 1, beds: 2, price: 2500, st: "free", ...over });
export const booking = (id: string, r: string, from: string, nights = 2, over: Record<string, unknown> = {}) => ({
  id, room: r, from, nights, guest: "Ram", phone: "", src: "Phone", status: "booked", payments: [], food: [], extra: 0, createdAt: now, updatedAt: now, ...over,
});
export const push = (env: TestEnv, token: string, ...changes: { t: string; id: string; data: any; ts?: number }[]) =>
  call(env, "/sync/push", { token, body: { changes: changes.map((c) => ({ ts: Date.now(), ...c })) } });
