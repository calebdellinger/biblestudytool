// One-time CouchDB setup: lock it down and create the "margin" database.
// Safe to run again; every step checks before it changes anything.
import { couch, loadConfig, log } from './lib.mjs'

const cfg = loadConfig()
const db = couch(cfg)

const hello = await db('GET', '/').catch(() => null)
if (!hello) { console.error('CouchDB is not reachable at ' + cfg.couchUrl + '. Is it installed and running?'); process.exit(1) }
const who = await db('GET', '/_session')
if (!who.json?.userCtx?.roles?.includes('_admin')) {
  console.error('CouchDB rejected the admin username or password in server/config.json.'); process.exit(1)
}

// Single-node system databases
for (const name of ['_users', '_replicator', cfg.database]) {
  const r = await db('PUT', `/${name}`)
  log(name, r.status === 201 ? 'created' : r.status === 412 ? 'already exists' : `status ${r.status}`)
}

// Only the admin account may read or write your notes.
await db('PUT', `/${cfg.database}/_security`, {
  admins: { names: [cfg.couchUser], roles: [] },
  members: { names: [cfg.couchUser], roles: ['_admin'] },
})
log('database restricted to', cfg.couchUser)

// Listen on this PC only (Tailscale reaches it through server.mjs), and require a login for everything.
const settings = [
  ['chttpd', 'bind_address', '127.0.0.1'],
  ['chttpd', 'require_valid_user', 'true'],
  ['chttpd_auth', 'require_valid_user', 'true'],
  ['couchdb', 'max_document_size', '8000000'],
]
const nodes = await db('GET', '/_membership')
const node = nodes.json?.all_nodes?.[0] ?? '_local'
for (const [section, key, value] of settings) {
  const r = await db('PUT', `/_node/${node}/_config/${section}/${key}`, JSON.stringify(value))
  log(`${section}.${key} = ${value}`, r.ok ? 'ok' : `status ${r.status}`)
}
log('CouchDB is ready.')
