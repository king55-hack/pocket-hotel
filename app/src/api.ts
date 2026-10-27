export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:8790";

export type Session = {
  access: string;
  refresh: string;
  user: { id: string; name: string; role: string; perms: string[] };
  hotel: { id: string; name: string; code: string; plan: string; feat: Record<string, boolean> };
};

const KEY = "ph.session";
const DEV = "ph.device";

export function loadSession(): Session | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: the person will have to sign in again next time */ }
  listeners.forEach((f) => f());
}
const listeners = new Set<() => void>();
export const onSession = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

export function device(): { id: string; name: string } {
  let id = "";
  try { id = localStorage.getItem(DEV) ?? ""; } catch { /* ignore */ }
  if (!id) {
    id = "dev-" + crypto.randomUUID();
    try { localStorage.setItem(DEV, id); } catch { /* ignore */ }
  }
  const ua = navigator.userAgent;
  const name = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Browser";
  return { id, name };
}

export type ApiResult<T = any> = { s: number; j: T };

async function raw(path: string, method: string, body?: unknown, token?: string, extra?: Record<string, string>): Promise<ApiResult> {
  try {
    const r = await fetch(API_URL + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(extra ?? {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { s: r.status, j: await r.json().catch(() => ({})) };
  } catch {
    return { s: 0, j: { error: "offline" } }; // no internet or server not reachable
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const s = loadSession();
  if (!s) return false;
  refreshing ??= (async () => {
    const r = await raw("/auth/refresh", "POST", { refresh: s.refresh });
    if (r.s === 200) { saveSession(r.j as Session); return true; }
    if (r.s === 401 || r.s === 403) saveSession(null); // refused for good: signed out, revoked or switched off
    return false;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** Call the API as the signed-in person. Renews the short-lived token once if needed. */
export async function api(path: string, method = "GET", body?: unknown): Promise<ApiResult> {
  const s = loadSession();
  if (!s) return { s: 401, j: { error: "unauthorized" } };
  let r = await raw(path, method, body, s.access);
  if (r.s === 401 && (await refresh())) r = await raw(path, method, body, loadSession()!.access);
  return r;
}

export const publicApi = (path: string, body: unknown) => raw(path, "POST", body);
export const adminApi = (key: string, path: string, body?: unknown) => raw("/admin" + path, body === undefined ? "GET" : "POST", body, undefined, { "x-admin-key": key });
