// Backups of your notes, highlights and photos.
//   node backup.mjs            nightly copy to the backup drive (keeps the last 60)
//   node backup.mjs --offsite  encrypted copy to your Google Drive folder (keeps the last 12)
// Both are plain JSON of every document (with photos inlined) so a restore needs nothing but Node.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { couch, loadConfig, log, stamp } from './lib.mjs'

const cfg = loadConfig()
const offsite = process.argv.includes('--offsite')
const db = couch(cfg)

const r = await db('GET', `/${cfg.database}/_all_docs?include_docs=true&attachments=true`)
if (!r.ok) { console.error('Backup failed: CouchDB answered', r.status, JSON.stringify(r.json)); process.exit(1) }
const docs = r.json.rows.map(row => row.doc).filter(d => !d._id.startsWith('_design/'))
const payload = zlib.gzipSync(Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), database: cfg.database, docs })))

function prune(dir, prefix, keep) {
  const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix)).sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f))
}

if (!offsite) {
  if (!cfg.backupDir) { console.error('backupDir is not set in config.json'); process.exit(1) }
  fs.mkdirSync(cfg.backupDir, { recursive: true })
  const file = path.join(cfg.backupDir, `margin-${stamp()}.json.gz`)
  fs.writeFileSync(file, payload)
  prune(cfg.backupDir, 'margin-', cfg.keepNightly)
  log(`Saved ${docs.length} documents to ${file}`)
} else {
  if (!cfg.offsiteDir || !cfg.offsitePassword) { console.error('offsiteDir and offsitePassword must be set in config.json'); process.exit(1) }
  fs.mkdirSync(cfg.offsiteDir, { recursive: true })
  // AES-256-GCM with a key stretched from your backup password (scrypt).
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(cfg.offsitePassword, salt, 32)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(payload), c.final()])
  const out = Buffer.concat([Buffer.from('MRGN1'), salt, iv, c.getAuthTag(), body])
  const file = path.join(cfg.offsiteDir, `margin-${stamp()}.mrgn`)
  fs.writeFileSync(file, out)
  prune(cfg.offsiteDir, 'margin-', cfg.keepOffsite)
  log(`Saved an encrypted copy of ${docs.length} documents to ${file}`)
}
