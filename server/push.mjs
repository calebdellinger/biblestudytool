// Web Push from your PC, with no outside service or API key.
// Keys are made here once (VAPID); Apple's and Google's push services only relay the encrypted message.
// Encryption follows RFC 8291 (aes128gcm) and the sender identity RFC 8292 (VAPID), using Node's own crypto.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { HERE, log } from './lib.mjs'

const KEYS = path.join(HERE, 'push-keys.json')
const SUBS = path.join(HERE, 'push-subs.json')
const b64u = b => Buffer.from(b).toString('base64url')
const fromB64u = s => Buffer.from(s, 'base64url')
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2))

export function vapidKeys() {
  let k = readJson(KEYS, null)
  if (!k) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const jwk = privateKey.export({ format: 'jwk' })
    k = { publicKey: b64u(publicKey.export({ format: 'der', type: 'spki' }).subarray(-65)), privateJwk: jwk }
    writeJson(KEYS, k)
    log('Made new push keys')
  }
  return k
}

export function vapidHeader(endpoint, subject) {
  const k = vapidKeys()
  const aud = new URL(endpoint).origin
  const enc = o => b64u(JSON.stringify(o))
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`
  const key = crypto.createPrivateKey({ key: k.privateJwk, format: 'jwk' })
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${unsigned}.${b64u(sig)}, k=${k.publicKey}`
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
/** Encrypt a payload for one subscription (RFC 8291). */
export function encrypt(payload, p256dh, auth, salt = crypto.randomBytes(16)) {
  const uaPublic = fromB64u(p256dh), authSecret = fromB64u(auth)
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const shared = ecdh.computeSecret(uaPublic)
  const prkKey = hmac(authSecret, shared)
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]))
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body])
}

/** Send one message. Returns 'ok', 'gone' (subscription expired) or throws. */
export async function sendPush(sub, message, subject) {
  const body = encrypt(JSON.stringify(message), sub.keys.p256dh, sub.keys.auth)
  const r = await fetch(sub.endpoint, {
    method: 'POST', body,
    headers: {
      Authorization: vapidHeader(sub.endpoint, subject), 'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream', TTL: '43200', Urgency: 'normal',
      ...(message.tag ? { Topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
    },
  })
  if (r.status === 404 || r.status === 410) return 'gone'
  if (!r.ok) throw new Error(`push service ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return 'ok'
}

/* ---------- subscriptions ---------- */
export const loadSubs = () => readJson(SUBS, [])
export function saveSub(sub, device) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('bad subscription')
  const subs = loadSubs().filter(s => s.endpoint !== sub.endpoint)
  subs.push({ endpoint: sub.endpoint, keys: sub.keys, device: String(device ?? '').slice(0, 30), added: new Date().toISOString() })
  writeJson(SUBS, subs)
}
export function dropSub(endpoint) { writeJson(SUBS, loadSubs().filter(s => s.endpoint !== endpoint)) }

export async function sendAll(message, subject, only) {
  const subs = loadSubs().filter(s => !only || s.endpoint === only)
  let sent = 0
  for (const s of subs) {
    try {
      if ((await sendPush(s, message, subject)) === 'gone') { dropSub(s.endpoint); log(`Dropped expired ${s.device} subscription`) } else sent++
    } catch (e) { log(`Push to ${s.device} failed: ${e.message}`) }
  }
  return sent
}
