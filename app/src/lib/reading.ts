// Where your reading time goes, and what you've marked as read.
// Time is counted only while the page is on screen and you've scrolled, tapped or typed in the last couple of minutes.
// Keys: b:<book>.<chapter> (Scripture), s:<sermon id>, p:<psalm> (Treasury of David), w:<work id>/<chapter> (Murray, Bounds, Moody).
import { useEffect, useSyncExternalStore } from 'react'
import { db, getState, saveDoc, subscribe, type ReadMark, type TimeLog } from './db'

const IDLE_MS = 150_000, TICK_MS = 5_000, FLUSH_MS = 30_000

function deviceId() {
  try {
    let id = localStorage.getItem('margin.device')
    if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('margin.device', id) }
    return id
  } catch { return 'unknown' }
}
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/* ---------- the timer ---------- */
let current: string | null = null
let lastActive = Date.now()
let pending: Record<string, Record<string, number>> = {}  // day -> key -> seconds not yet saved
let started = false
let saving: Promise<void> = Promise.resolve()

function start() {
  if (started) return
  started = true
  const poke = () => { lastActive = Date.now() }
  for (const ev of ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel']) addEventListener(ev, poke, { passive: true, capture: true })
  setInterval(() => {
    if (!current || document.visibilityState !== 'visible' || Date.now() - lastActive > IDLE_MS) return
    const d = dayKey()
    pending[d] ??= {}
    pending[d][current] = (pending[d][current] ?? 0) + TICK_MS / 1000
  }, TICK_MS)
  setInterval(flush, FLUSH_MS)
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  addEventListener('pagehide', flush)
}

function flush() {
  const batch = pending
  pending = {}
  if (!Object.keys(batch).length) return
  const device = deviceId()
  saving = saving.then(async () => {
    for (const [date, add] of Object.entries(batch)) {
      const _id = `timelog:${date}:${device}`
      let doc: TimeLog
      try { doc = await db.get(_id) as TimeLog } catch { doc = { _id, type: 'timelog', date, device, t: {}, updatedAt: '' } }
      for (const [k, s] of Object.entries(add)) doc.t[k] = (doc.t[k] ?? 0) + s
      doc.updatedAt = new Date().toISOString()
      await db.put(doc as never).catch(() => { /* lost a few seconds; fine */ })
    }
  })
}

/** Count active time against `key` while the calling page is showing. */
export function useReadingTime(key: string | null) {
  useEffect(() => {
    if (!key) return
    start()
    flush()  // close off the previous item
    current = key
    lastActive = Date.now()
    return () => { if (current === key) { flush(); current = null } }
  }, [key])
}

/* ---------- reading the logs ---------- */
export type LogDay = { date: string; t: Record<string, number> }
export async function loadLogs(): Promise<LogDay[]> {
  flush()
  await saving
  const r = await db.allDocs({ startkey: 'timelog:', endkey: 'timelog:￿', include_docs: true })
  const byDay = new Map<string, Record<string, number>>()
  for (const row of r.rows) {
    const d = row.doc as unknown as TimeLog | undefined
    if (!d?.t) continue
    const acc = byDay.get(d.date) ?? {}
    for (const [k, s] of Object.entries(d.t)) acc[k] = (acc[k] ?? 0) + s
    byDay.set(d.date, acc)
  }
  return [...byDay].map(([date, t]) => ({ date, t })).sort((a, b) => a.date.localeCompare(b.date))
}

/* ---------- marked as read (only ever by you) ---------- */
export const useReadMarks = () => useSyncExternalStore(subscribe, () => getState().read)
export function readMark(key: string): ReadMark | undefined { return getState().read.get(key) }
export async function markRead(key: string) {
  const cur = readMark(key)
  const today = dayKey()
  if (cur?.dates.at(-1) === today) return
  const _id = `read:${key}`
  await saveDoc<ReadMark>({ ...(cur ?? { _id, type: 'read', key, dates: [], updatedAt: '' }), dates: [...(cur?.dates ?? []), today], deleted: false })
}
export async function unmarkRead(key: string) {
  const cur = readMark(key)
  if (!cur) return
  await saveDoc<ReadMark>({ ...cur, dates: cur.dates.slice(0, -1) })
}
export { dayKey }
