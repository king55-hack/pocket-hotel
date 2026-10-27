const enc = new TextEncoder()

export const hex = (b: ArrayBuffer | Uint8Array) =>
  [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, '0')).join('')
export const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)))
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uStr = (s: string) => b64u(enc.encode(s))
const fromB64uStr = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))

/** PBKDF2-SHA256. Cloudflare Workers allows at most 100000 iterations. */
export async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256)
  return hex(bits)
}

export async function sha256(s: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

const hmacKey = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number) {
  const head = b64uStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64uStr(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(head + '.' + body))
  return `${head}.${body}.${b64u(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, any> | null> {
  const [h, b, s] = token.split('.')
  if (!h || !b || !s) return null
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(h + '.' + b))
  if (!safeEqual(b64u(sig), s)) return null
  const p = JSON.parse(fromB64uStr(b))
  return p.exp * 1000 > Date.now() ? p : null
}
