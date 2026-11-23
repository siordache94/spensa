// The token in a check-in push that lets the service worker answer "Cooked as planned" without a session (ADR 0005).
// HMAC-SHA256 over user, meal and expiry, keyed from the server's PUSH_WEBHOOK_SECRET. The push payload is encrypted
// end to end to that one device, so only that device holds it. It can do exactly one thing: answer 'planned' for that
// person on that meal's check-in, until it expires. WebCrypto only, so it runs in browsers, Deno and Node.
const enc = new TextEncoder()
export const TOKEN_TTL_DAYS = 30

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function key(secret: string) {
  const root = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  // a derived key, so the webhook secret itself never signs anything the browser sees
  const derived = await crypto.subtle.sign('HMAC', root, enc.encode('spensa-checkin-token-v1'))
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** Token format: `<userId>.<expiresAtUnixSeconds>.<signature>`. */
export async function signCheckinToken(secret: string, userId: string, mealId: string, now = new Date(), ttlDays = TOKEN_TTL_DAYS): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + ttlDays * 86400
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(`${userId}.${mealId}.${exp}`))
  return `${userId}.${exp}.${b64url(sig)}`
}

/** The user the token was issued to, or null when it is malformed, expired, for another meal, or not signed by us. */
export async function verifyCheckinToken(secret: string, token: string, mealId: string, now = new Date()): Promise<string | null> {
  const [userId, exp, sig] = token.split('.')
  if (!userId || !exp || !sig || token.split('.').length !== 3 || !/^\d+$/.test(exp)) return null
  if (Number(exp) < Math.floor(now.getTime() / 1000)) return null
  const want = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(`${userId}.${mealId}.${exp}`))
  const a = enc.encode(b64url(want)), b = enc.encode(sig)
  if (a.length !== b.length) return null
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0 ? userId : null
}
