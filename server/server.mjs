// Margin's server on your PC.
//   /         the app (static files from app/dist)
//   /db/...   CouchDB, forwarded to 127.0.0.1:5984 so the app and database share one address
// Tailscale serve puts this on https://<your-pc>.<tailnet>.ts.net for your devices only.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { loadConfig, log } from './lib.mjs'
import { dropSub, saveSub, sendAll, vapidKeys } from './push.mjs'
import { startNotifier } from './notify.mjs'
import { paperPdf } from './paper-pdf.mjs'

const cfg = loadConfig()
const notifier = startNotifier(cfg)
const couch = new URL(cfg.couchUrl)
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.txt': 'text/plain',
}

function proxy(req, res) {
  const target = req.url.replace(/^\/db/, '') || '/'
  const up = http.request({
    host: couch.hostname, port: couch.port || 5984, method: req.method, path: target,
    headers: { ...req.headers, host: couch.host },
  }, r => {
    // Drop CouchDB's Basic-auth challenge so browsers never pop up their own login box; the app shows its own message.
    const { 'www-authenticate': _drop, ...headers } = r.headers
    res.writeHead(r.statusCode ?? 502, headers); r.pipe(res)
  })
  up.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'couchdb_unreachable', reason: 'CouchDB is not running on this PC.' }))
  })
  req.pipe(up)
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x')
  let file = path.normalize(path.join(cfg.appDir, decodeURIComponent(url.pathname)))
  if (!file.startsWith(path.normalize(cfg.appDir))) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(cfg.appDir, 'index.html')
  const ext = path.extname(file)
  const hashed = /\/assets\//.test(url.pathname)
  const gzip = /\.(json|js|css|html|svg|webmanifest|txt)$/.test(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    // Hashed build files never change; everything else must be revalidated so updates reach your devices.
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  })
  const stream = fs.createReadStream(file)
  if (gzip) stream.pipe(zlib.createGzip({ level: 6 })).pipe(res); else stream.pipe(res)
}

// ---- Search across all of Spurgeon (sermons, Treasury of David, Morning and Evening) ------------
// Runs here on the PC so phones don't have to download 130 MB of sermons. Files are read per search;
// Windows keeps them cached, so repeat searches are quick.
const SP = path.join(cfg.appDir, 'data', 'spurgeon')
let spIndex = null
function spLoad() {
  if (spIndex) return spIndex
  const read = f => JSON.parse(fs.readFileSync(path.join(SP, f), 'utf8'))
  spIndex = { sermons: read('sermons.json'), readings: read('morning-evening.json') }
  return spIndex
}
const plain = t => t.replace(/[*_>#`]/g, '').replace(/\s+/g, ' ')
function scoreText(text, res) {
  let score = 0
  for (const re of res) {
    re.lastIndex = 0
    let n = 0
    while (re.exec(text) && n < 50) n++
    if (!n) return 0
    score += n
  }
  return score
}
function snippet(text, re) {
  re.lastIndex = 0
  const m = re.exec(text)
  const at = m ? m.index : 0
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 110)))
  return (start > 0 ? '…' : '') + plain(text.slice(start, at + 170)).trim() + '…'
}
async function spSearch(q) {
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1).slice(0, 8)
  if (!words.length) return []
  const res = words.map(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'))
  const { sermons, readings } = spLoad()
  const hits = []
  const queue = [...sermons]
  async function worker() {
    for (let s; (s = queue.shift());) {
      let text
      try { text = await fs.promises.readFile(path.join(SP, 'sermons', `${s[0]}.md`), 'utf8') } catch { continue }
      const score = scoreText(text, res) + (scoreText(s[2], res) ? 40 : 0)
      if (score) hits.push({ score, kind: 'sermon', id: s[0], title: s[2], ref: `Sermon ${s[1]}`, snippet: snippet(text, res[0]) })
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker))
  for (const r of readings) {
    const score = scoreText(r[6], res)
    if (score) hits.push({ score: score + 5, kind: 'reading', id: `${r[0]}-${r[1]}`, title: `${r[1] === 'morning' ? 'Morning' : 'Evening'}, ${r[0].replace('-', ' ')}`, ref: r[2], snippet: snippet(r[6], res[0]) })
  }
  for (const f of fs.readdirSync(path.join(SP, 'tod'))) {
    const t = JSON.parse(fs.readFileSync(path.join(SP, 'tod', f), 'utf8'))
    const text = [t.intro, ...t.exposition.map(x => x[2]), ...t.notes.map(x => x[2]), ...t.hints.map(x => x[2])].join('\n\n')
    const score = scoreText(text, res)
    if (score) hits.push({ score, kind: 'psalm', id: f.replace('.json', ''), title: `Psalm ${f.replace('.json', '')}`, ref: 'The Treasury of David', snippet: snippet(text, res[0]) })
  }
  // Murray, Bounds and Moody
  const TH = path.join(cfg.appDir, 'data', 'theologians')
  try {
    const lib = JSON.parse(fs.readFileSync(path.join(TH, 'index.json'), 'utf8'))
    for (const a of lib.authors) for (const w of a.works) for (const [n, title] of w.chapters) {
      let text
      try { text = await fs.promises.readFile(path.join(TH, 'works', w.id, `${n}.md`), 'utf8') } catch { continue }
      const score = scoreText(text, res) + (scoreText(title, res) || scoreText(w.title, res) ? 30 : 0)
      if (score) hits.push({ score, kind: 'work', id: `${w.id}/${n}`, title: `${w.title}: ${title}`, ref: a.name, snippet: snippet(text, res[0]) })
    }
  } catch { /* library not installed */ }
  hits.sort((a, b) => b.score - a.score)
  // Spurgeon's 3,500 sermons would crowd out the books, so keep the best book chapters in view too.
  const top = hits.slice(0, 60), books = hits.filter(h => h.kind === 'work').slice(0, 15)
  const missing = books.filter(b => !top.includes(b))
  const out = [...top.slice(0, 60 - missing.length), ...missing].sort((a, b) => b.score - a.score)
  return out.map(({ score, ...h }) => h)
}

// ---- Offline library: every data file with its size and date, so a device can save it all --------
let manifest = null
function offlineManifest() {
  if (manifest && manifest.at > Date.now() - 30_000) return manifest.body
  const root = path.join(cfg.appDir, 'data'), files = []
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) { const st = fs.statSync(p); files.push(['/data/' + path.relative(root, p).split(path.sep).join('/'), st.size, Math.floor(st.mtimeMs)]) }
    }
  }
  walk(root)
  manifest = { at: Date.now(), body: JSON.stringify({ files }) }
  return manifest.body
}

// ---- Push notifications -----------------------------------------------------------------------
// Only someone who can sign in to your CouchDB may subscribe a device or send a test.
const authed = new Map()
async function checkAuth(req) {
  const h = req.headers.authorization
  if (!h) return false
  if ((authed.get(h) ?? 0) > Date.now()) return true
  try {
    const r = await fetch(`${cfg.couchUrl}/_session`, { headers: { Authorization: h } })
    const j = await r.json()
    if (r.ok && j.userCtx?.name) { authed.set(h, Date.now() + 10 * 60_000); return true }
  } catch { /* CouchDB down */ }
  return false
}
function readBody(req) {
  return new Promise((ok, fail) => {
    let s = ''
    req.on('data', c => { s += c; if (s.length > 20_000) { fail(new Error('too big')); req.destroy() } })
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}) } catch (e) { fail(e) } })
  })
}
async function pushApi(req, res) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)) }
  const what = req.url.replace(/^\/api\/push\//, '').split('?')[0]
  try {
    if (what === 'key' && req.method === 'GET') return send(200, { key: vapidKeys().publicKey })
    if (req.method !== 'POST') return send(405, { reason: 'POST only' })
    if (!(await checkAuth(req))) return send(401, { reason: 'Sign in to sync first (Settings › Sync with your PC); notifications use the same account.' })
    const body = await readBody(req)
    if (what === 'subscribe') { saveSub(body.sub, body.device); return send(200, { ok: true }) }
    if (what === 'unsubscribe') { dropSub(body.endpoint); return send(200, { ok: true }) }
    if (what === 'test') {
      const n = await sendAll({ title: 'YHWH', body: 'Notifications are working. Reminders will arrive at the times you chose.', url: '/#/today', tag: 'test' }, notifier.subject, body.endpoint)
      return n ? send(200, { ok: true }) : send(502, { reason: 'The push service refused the message. Try turning notifications off and on again.' })
    }
    if (what === 'preview') {
      const s = (await fetch(`${cfg.couchUrl}/${cfg.database}/settings:daily`, { headers: { Authorization: req.headers.authorization } }).then(r => r.json()))
      const now = notifier.localNow(s.tz || 'UTC')
      return send(200, { reading: await notifier.message('reading', s, now), evening: await notifier.message('evening', s, now), memory: await notifier.message('memory', s, now) })
    }
    return send(404, { reason: 'unknown' })
  } catch (e) {
    log('push api', e.message)
    return send(400, { reason: e.message })
  }
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/push/')) { pushApi(req, res); return }
  if (req.url.startsWith('/api/paper.pdf')) {
    // The printable newspaper as a PDF, made by a hidden browser on this PC from the app's own page.
    const q = new URL(req.url, 'http://x').searchParams
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? q.get('date') : new Date().toISOString().slice(0, 10)
    const edition = q.get('edition') === 'split' ? 'split' : 'full'
    const tr = q.get('tr') === 'KJV' ? 'KJV' : 'BSB'
    paperPdf(`http://127.0.0.1:${cfg.port}/?pdf=1&tr=${tr}#/paper/${date}/${edition}`)
      .then(buf => {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
          'Content-Disposition': `inline; filename="The Daily Word ${date}${edition === 'split' ? ' (morning and evening)' : ''}.pdf"` })
        res.end(buf)
      })
      .catch(e => { log('paper pdf', e.message); res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`Couldn't make the PDF: ${e.message}`) })
    return
  }
  if (req.url === '/db' || req.url.startsWith('/db/')) return proxy(req, res)
  if (req.url.startsWith('/api/offline/manifest')) {
    try {
      const body = offlineManifest()
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body)
    } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e) })) }
    return
  }
  if (req.url.startsWith('/api/bible?')) {
    // NIV / NLT / NASB chapters from API.Bible, using the key in config.json, for devices that don't hold their own key.
    const q = new URL(req.url, 'http://x').searchParams
    const ids = { NIV: '78a9f6124f344018-01', NLT: 'd6e14a625393b4da-01', NASB: 'b8ee27bcd1cae43a-01' }
    const id = ids[q.get('tr')], ch = q.get('ch') ?? ''
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)) }
    if (!id || !/^[1-3A-Z]{3}\.\d{1,3}$/.test(ch)) return json(400, { error: 'bad request' })
    if (!cfg.apiBibleKey) return json(503, { error: 'No apiBibleKey in config.json' })
    const qs = 'content-type=json&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false'
    fetch(`https://rest.api.bible/v1/bibles/${id}/chapters/${ch}?${qs}`, { headers: { 'api-key': cfg.apiBibleKey }, signal: AbortSignal.timeout(15_000) })
      .then(async r => json(r.status, await r.text()))
      .catch(e => { log('api.bible', e.message); json(502, { error: e.message }) })
    return
  }
  if (req.url.startsWith('/api/spurgeon/search')) {
    const q = new URL(req.url, 'http://x').searchParams.get('q') ?? ''
    spSearch(q).then(r => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(r)) })
      .catch(e => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e) })) })
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }
  serveStatic(req, res)
}).listen(cfg.port, '127.0.0.1', () => log(`Margin is serving ${cfg.appDir} on http://127.0.0.1:${cfg.port}`))
