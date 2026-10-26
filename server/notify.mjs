// Sends the daily reading and memory reminders at the times chosen in Margin's Settings.
// Settings live in the synced "settings:daily" document, so any device can change them.
// Checks once a minute; a reminder missed while the PC slept is still sent up to three hours late.
import fs from 'node:fs'
import path from 'node:path'
import { HERE, couch, log } from './lib.mjs'
import { sendAll } from './push.mjs'

const STATE = path.join(HERE, 'push-state.json')
const LATE_LIMIT = 180 // minutes

export function startNotifier(cfg) {
  const db = couch(cfg)
  const data = p => JSON.parse(fs.readFileSync(path.join(cfg.appDir, 'data', p), 'utf8'))
  let books = null, plan = null, me = null
  const subject = cfg.pushSubject ?? `https://localhost:${cfg.httpsPort}`
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

  function ref(s, e) {
    books ??= data('books.json')
    const b = books.find(x => x.id === Math.floor(s / 1e6)), c = Math.floor((s % 1e6) / 1000), v = s % 1000
    const name = b ? (b.id === 19 ? 'Psalm' : b.name) : '?'
    if (s === e) return `${name} ${c}:${v}`
    const c2 = Math.floor((e % 1e6) / 1000), v2 = e % 1000
    return c2 === c ? `${name} ${c}:${v}–${v2}` : `${name} ${c}:${v}–${c2}:${v2}`
  }
  function planDay(y, m, d) {
    plan ??= data('plans/mcheyne.json')
    let n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000)
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    if (leap && n >= 59) n -= 1
    return plan[Math.min(n, 364)].map(r => r[0])
  }
  function spurgeon(m, d, period) {
    me ??= data('spurgeon/morning-evening.json')
    const r = me.find(x => x[0] === `${MONTHS[m - 1]}-${d}` && x[1] === period)
    if (!r) return null
    const verse = r[5].length > 150 ? `${r[5].slice(0, 147).replace(/\s+\S*$/, '')}…` : r[5]
    return { verse, scripture: r[2] }
  }
  async function dueMemory(today) {
    const r = await db('GET', `/${cfg.database}/_all_docs?include_docs=true&startkey=${encodeURIComponent('"mem:"')}&endkey=${encodeURIComponent('"mem:￰"')}`)
    if (!r.ok) throw new Error(`CouchDB ${r.status}`)
    return r.json.rows.map(x => x.doc).filter(m => m && !m.deleted && m.due <= today).sort((a, b) => a.due.localeCompare(b.due))
  }

  async function message(kind, s, now) {
    const [y, m, d] = now.date.split('-').map(Number)
    if (kind === 'reading') {
      const parts = []
      if (s.plan === 'mcheyne') parts.push(planDay(y, m, d).join(' · '))
      const sp = s.spurgeon ? spurgeon(m, d, 'morning') : null
      if (sp) parts.push(`“${sp.verse}” ${sp.scripture}`)
      if (!parts.length) return null
      return { title: s.plan === 'mcheyne' ? "Today's reading" : 'Morning', body: parts.join('\n'), url: '/#/today', tag: 'reading' }
    }
    if (kind === 'evening') {
      const sp = s.spurgeon ? spurgeon(m, d, 'evening') : null
      return sp && { title: 'Evening', body: `“${sp.verse}” ${sp.scripture}`, url: '/#/today', tag: 'evening' }
    }
    if (kind === 'memory') {
      const due = await dueMemory(now.date)
      if (!due.length) return null
      const list = due.slice(0, 3).map(x => ref(x.s, x.e)).join(', ') + (due.length > 3 ? '…' : '')
      return { title: 'Memory', body: `${due.length} ${due.length === 1 ? 'passage' : 'passages'} to practise: ${list}`, url: '/#/memory/practice', tag: 'memory' }
    }
    return null
  }

  function localNow(tz) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]))
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
  }

  let running = false
  async function tick() {
    if (running) return
    running = true
    try {
      const r = await db('GET', `/${cfg.database}/settings:daily`)
      if (!r.ok) return
      const s = r.json
      let now
      try { now = localNow(s.tz || 'UTC') } catch { now = localNow('UTC') }
      const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return {} } })()
      for (const kind of ['reading', 'evening', 'memory']) {
        const t = s.times?.[kind]
        if (!t || state[kind] === now.date) continue
        const [hh, mm] = t.split(':').map(Number)
        const late = now.minutes - (hh * 60 + mm)
        if (late < 0 || late > LATE_LIMIT) continue
        state[kind] = now.date
        fs.writeFileSync(STATE, JSON.stringify(state))
        const msg = await message(kind, s, now)
        if (msg) log(`Sent ${kind} reminder to ${await sendAll(msg, subject)} device(s)`)
      }
    } catch (e) {
      log(`Reminder check failed: ${e.message}`)
    } finally { running = false }
  }
  setTimeout(tick, 5_000)
  setInterval(tick, 60_000)
  return { message, localNow, subject }
}
