// Makes the printable newspaper as a real PDF on the PC, with Chrome (or Edge) running hidden.
// iPhone Safari can't lay out newspaper columns across printed pages, so the phone asks the PC for the file.
// Talks to the browser over its DevTools connection (Node 22 has WebSocket built in); no extra packages.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/opt/pw-browsers/chromium',
]
const sleep = ms => new Promise(r => setTimeout(r, ms))
let busy = Promise.resolve()

export function paperPdf(url) {
  // One at a time: each run starts and stops its own hidden browser.
  const run = busy.then(() => make(url))
  busy = run.catch(() => {})
  return run
}

async function make(url) {
  const exe = BROWSERS.find(p => fs.existsSync(p))
  if (!exe) throw new Error('Chrome or Edge is needed on the PC to make PDFs.')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yhwh-pdf-'))
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  try {
    let port
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100)
      try { port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim() } catch { /* not yet */ }
    }
    if (!port) throw new Error('The hidden browser did not start.')
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = targets.find(t => t.type === 'page')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
    let id = 0
    const waiting = new Map()
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } }
    const send = (method, params = {}) => new Promise((ok, fail) => {
      const n = ++id
      waiting.set(n, m => (m.error ? fail(new Error(m.error.message)) : ok(m.result)))
      ws.send(JSON.stringify({ id: n, method, params }))
    })
    await send('Page.enable')
    await send('Page.navigate', { url })
    // Wait until the paper has its text (up to 25 seconds), then for the fonts.
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      await sleep(250)
      const r = await send('Runtime.evaluate', { expression: "!!document.querySelector('.paper .story') && !document.querySelector('.paper-root .loading-lines')", returnByValue: true }).catch(() => null)
      ready = r?.result?.value === true
    }
    if (!ready) throw new Error('The paper took too long to load.')
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })
    await sleep(300)
    const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
    ws.close()
    return Buffer.from(pdf.data, 'base64')
  } finally {
    proc.kill()
    await sleep(300)
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
