// Shared helpers for the PC-side scripts. No dependencies beyond Node itself.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CONFIG_PATH = path.join(HERE, 'config.json')

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`No config found at ${CONFIG_PATH}. Run install.ps1 first.`)
  }
  const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return {
    port: 8787,
    httpsPort: 8443,
    couchUrl: 'http://127.0.0.1:5984',
    database: 'margin',
    appDir: path.join(HERE, '..', 'app', 'dist'),
    keepNightly: 60,
    keepOffsite: 12,
    ...c,
  }
}

export function couch(cfg) {
  const auth = 'Basic ' + Buffer.from(`${cfg.couchUser}:${cfg.couchPassword}`).toString('base64')
  return async (method, p, body) => {
    const r = await fetch(cfg.couchUrl + p, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await r.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    return { status: r.status, ok: r.ok, json }
  }
}

export const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace(/[:T]/g, '-')
export function log(...a) { console.log(new Date().toISOString(), ...a) }
