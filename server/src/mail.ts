export interface Env {
  DB: D1Database
  JWT_SECRET: string
  ADMIN_KEY?: string
  /** Where the admin is told about new closure requests. Optional. */
  ADMIN_EMAIL?: string
  RESEND_API_KEY?: string
  /** Gmail sending, for when there is no own domain yet. All four must be set (see the README). */
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
  GMAIL_SENDER?: string
  MAIL_FROM: string
  ALLOWED_ORIGINS: string
  DEV_RETURN_OTP?: string
}

export interface MailOpts { attachments?: { filename: string; content: string }[]; replyTo?: string }

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s) }
const b64url = (s: string) => b64(new TextEncoder().encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const wrap = (s: string) => s.replace(/(.{76})/g, '$1\r\n')
/** One line only: a stray line break in a header would let someone add their own headers (for example another recipient). */
const oneLine = (s: string) => s.replace(/[\r\n\u0000]+/g, ' ').trim()
const encodedWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? oneLine(s) : `=?UTF-8?B?${b64(new TextEncoder().encode(oneLine(s)))}?=`)
const MIME: Record<string, string> = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', png: 'image/png' }

/** A complete email message (RFC 5322 / MIME) with Nepali text and attachments that any mail program reads correctly. */
export function buildMime(m: { from: string; to: string; subject: string; text: string; replyTo?: string; attachments?: { filename: string; content: string }[] }): string {
  const boundary = 'ph_' + crypto.randomUUID().replace(/-/g, '')
  const head = [
    `From: ${encodedWord('Pocket Hotel')} <${oneLine(m.from).replace(/^.*<|>.*$/g, '')}>`,
    `To: ${oneLine(m.to)}`,
    `Subject: ${encodedWord(m.subject)}`,
    ...(m.replyTo ? [`Reply-To: ${oneLine(m.replyTo)}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(new TextEncoder().encode(m.text)))}`,
    ...(m.attachments ?? []).map((a) => {
      const name = a.filename.replace(/[^\w .()-]/g, '_').replace(/\.{2,}/g, '.')
      const type = MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
      return `--${boundary}\r\nContent-Type: ${type}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(a.content)}`
    }),
  ]
  return head.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + `\r\n--${boundary}--\r\n`
}

let gToken: { value: string; until: number } | null = null
export const _resetGmailToken = () => { gToken = null }

async function gmailAccessToken(env: Env): Promise<string | null> {
  if (gToken && gToken.until > Date.now() + 60_000) return gToken.value
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID!, client_secret: env.GMAIL_CLIENT_SECRET!, refresh_token: env.GMAIL_REFRESH_TOKEN!, grant_type: 'refresh_token' }),
  })
  if (!r.ok) { console.log('[mail] gmail token error', r.status, (await r.text()).slice(0, 200)); return null }
  const j = (await r.json()) as { access_token?: string; expires_in?: number }
  if (!j.access_token) return null
  gToken = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3000) * 1000 }
  return gToken.value
}

async function sendViaGmail(env: Env, to: string, subject: string, text: string, opts: MailOpts): Promise<boolean> {
  const token = await gmailAccessToken(env)
  if (!token) return false
  const raw = b64url(buildMime({ from: env.GMAIL_SENDER!, to, subject, text, replyTo: opts.replyTo, attachments: opts.attachments }))
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
  })
  if (!r.ok) { console.log('[mail] gmail send error', r.status, (await r.text()).slice(0, 200)); if (r.status === 401) gToken = null }
  return r.ok
}

async function sendViaResend(env: Env, to: string, subject: string, text: string, opts: MailOpts): Promise<boolean> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, ...(opts.attachments ? { attachments: opts.attachments } : {}), ...(opts.replyTo ? { reply_to: opts.replyTo } : {}) }),
  })
  if (!r.ok) console.log('[mail] provider error', r.status, await r.text())
  return r.ok
}

export const gmailConfigured = (env: Env) => !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_SENDER)

/**
 * Sends one email. Gmail is used when its four settings exist, otherwise Resend when its key exists.
 * With neither, the message is only logged (local runs) and false is returned.
 */
export async function sendMail(env: Env, to: string, subject: string, text: string, opts: MailOpts = {}): Promise<boolean> {
  try {
    if (gmailConfigured(env)) return await sendViaGmail(env, to, subject, text, opts)
    if (env.RESEND_API_KEY) return await sendViaResend(env, to, subject, text, opts)
  } catch (e) {
    console.log('[mail] send failed', String(e).slice(0, 200))
    return false
  }
  console.log(`[mail:not sent, no mail provider is set] to=${to} subject=${subject}\n${text}`)
  return false
}

export const otpMail = (code: string) => ({
  subject: 'Pocket Hotel: तपाईंको कोड / your code',
  text: `तपाईंको प्रमाणीकरण कोड: ${code}\nYour verification code: ${code}\n\nयो कोड १० मिनेटसम्म मान्य छ। कसैलाई नदिनुस्।\nThis code is valid for 10 minutes. Do not share it.`,
})
