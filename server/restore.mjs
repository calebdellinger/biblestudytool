// Put a backup back into CouchDB.
//   node restore.mjs <file.json.gz | file.mrgn> [--into <database>]
// Restores into a NEW database by default ("margin-restored-<date>") so nothing is overwritten;
// check it, then rename or point the app at it. Pass --into margin to restore over the live one.
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import readline from 'node:readline/promises'
import { couch, loadConfig, log, stamp } from './lib.mjs'

const cfg = loadConfig()
const file = process.argv[2]
if (!file) { console.error('Usage: node restore.mjs <backup file> [--into <database>]'); process.exit(1) }
const intoIdx = process.argv.indexOf('--into')
const target = intoIdx > 0 ? process.argv[intoIdx + 1] : `margin-restored-${stamp().slice(0, 10)}`

let raw = fs.readFileSync(file)
if (raw.subarray(0, 5).toString() === 'MRGN1') {
  const pw = cfg.offsitePassword ?? await readline.createInterface({ input: process.stdin, output: process.stdout }).question('Backup password: ')
  const salt = raw.subarray(5, 21), iv = raw.subarray(21, 33), tag = raw.subarray(33, 49)
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pw, salt, 32), iv)
  d.setAuthTag(tag)
  try { raw = Buffer.concat([d.update(raw.subarray(49)), d.final()]) }
  catch { console.error('Wrong password, or the file is damaged.'); process.exit(1) }
}
const { docs, exportedAt } = JSON.parse(zlib.gunzipSync(raw).toString())
const db = couch(cfg)
await db('PUT', `/${target}`)
const clean = docs.map(({ _rev, ...d }) => d) // eslint-disable-line no-unused-vars
const r = await db('POST', `/${target}/_bulk_docs`, { docs: clean, new_edits: true })
const failed = Array.isArray(r.json) ? r.json.filter(x => x.error) : []
log(`Restored ${clean.length - failed.length} of ${clean.length} documents from ${exportedAt} into "${target}".`)
if (failed.length) log(`${failed.length} documents already existed there and were left as they are.`)
