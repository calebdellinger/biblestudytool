// The NIV, NLT and NASB come from API.Bible, one chapter at a time, because their publishers don't allow a full
// download. Two routes: straight from API.Bible when this device has a key (Settings › Reading), otherwise
// through your PC, which holds its own key. Under API.Bible's rules only a little is kept for offline reading:
// at most 450 verses per translation on each device, each kept no more than 14 days.
// Every time a chapter is shown, a view is reported to API.Bible's fair-use counter (no personal information).

export const ONLINE = {
  NIV: { id: '78a9f6124f344018-01', name: 'New International Version', copyright: 'Scripture quotations taken from The Holy Bible, New International Version® NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ Used by permission. All rights reserved worldwide.' },
  NLT: { id: 'd6e14a625393b4da-01', name: 'New Living Translation', copyright: 'Scripture quotations are taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, Carol Stream, Illinois 60188. All rights reserved.' },
  NASB: { id: 'b8ee27bcd1cae43a-01', name: 'New American Standard Bible 1995', copyright: 'Scripture taken from the NEW AMERICAN STANDARD BIBLE®, Copyright © 1960, 1962, 1963, 1968, 1971, 1972, 1973, 1975, 1977, 1995 by The Lockman Foundation. Used by permission. www.lockman.org' },
} as const
export type OnlineTr = keyof typeof ONLINE
export const isOnlineTr = (tr: string): tr is OnlineTr => tr in ONLINE

const USFM = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV']

export type OnlineChapter = { verses: string[]; red: Record<number, [number, number][]>; fums?: string }

/* ---------- the key on this device ---------- */
const KEY = 'margin.apibible.key'
export const deviceKey = () => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } }
export const setDeviceKey = (k: string) => { try { if (k.trim()) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY) } catch { /* ignore */ } }

/* ---------- turning API.Bible's chapter into plain verses ---------- */
type Node = { type: 'tag' | 'text'; name?: string; text?: string; attrs?: Record<string, unknown>; items?: Node[] }
export function parseChapter(b: number, c: number, content: Node[], verseCount: number): Omit<OnlineChapter, 'fums'> {
  const verses: string[] = Array(verseCount).fill('')
  const red: Record<number, [number, number][]> = {}
  let boundary = false, curV = 0
  const add = (v: number, t: string, wj: boolean) => {
    if (v < 1) return
    while (verses.length < v) verses.push('')
    let cur = verses[v - 1]
    t = t.replace(/\s+/g, ' ')
    if (boundary && cur && !/\s$/.test(cur) && !/^\s/.test(t)) cur += ' '   // a new paragraph or poetry line
    boundary = false
    if (!cur || cur.endsWith(' ')) t = t.replace(/^ /, '')
    const start = cur.length
    cur += t
    verses[v - 1] = cur
    if (wj && t.trim()) {
      const id = b * 1_000_000 + c * 1000 + v
      const list = (red[id] ??= [])
      const last = list[list.length - 1]
      if (last && last[1] >= start - 1) last[1] = cur.length; else list.push([start, cur.length])
    }
  }
  const walk = (n: Node, wj: boolean, upper: boolean) => {
    if (n.type === 'text') {
      const vId = String(n.attrs?.verseId ?? '')
      const v = Number(vId.split('.')[2]?.split('-')[0]) || curV   // some poetry lines carry no verse id
      if (v && n.text) add(v, upper ? n.text.toUpperCase() : n.text, wj)
      return
    }
    const style = String(n.attrs?.style ?? '')
    if (n.name === 'para' && /^(s\d?|ms\d?|mr|r|d|sp|cl)$/.test(style)) return   // headings: not part of the verses
    if (n.name === 'verse') { curV = parseInt(String(n.attrs?.number ?? '')) || curV; return }
    if (n.name === 'note') return                          // the verse number itself, notes
    if (n.name === 'para') boundary = true
    for (const k of n.items ?? []) walk(k, wj || style === 'wj', upper || style === 'nd' || style === 'sc')
  }
  for (const n of content) walk(n, false, false)
  // A verse left out of the main text (e.g. Matt 17:21 in the NIV): say so rather than show nothing.
  for (let i = 0; i < verses.length; i++) verses[i] = verses[i].trim() || '[Not in this translation’s main text; some manuscripts include this verse.]'
  for (const id in red) red[id] = red[id].map(([s, e]) => [s, Math.min(e, verses[(Number(id) % 1000) - 1].length)])
  return { verses, red }
}

/* ---------- the small store on this device ---------- */
const MAX_VERSES = 450, MAX_AGE = 14 * 86_400_000
const mem = new Map<string, Promise<OnlineChapter>>()
const ck = (tr: string, b: number, c: number) => `margin.apich.${tr}.${b}.${c}`
type Kept = OnlineChapter & { at: number }
function readKept(tr: string, b: number, c: number): Kept | null {
  try {
    const k = JSON.parse(localStorage.getItem(ck(tr, b, c)) ?? 'null') as Kept | null
    if (k && Date.now() - k.at < MAX_AGE) return k
    if (k) localStorage.removeItem(ck(tr, b, c))
  } catch { /* ignore */ }
  return null
}
function keep(tr: string, b: number, c: number, ch: OnlineChapter) {
  try {
    const idxKey = `margin.apich.${tr}.index`
    const idx = (JSON.parse(localStorage.getItem(idxKey) ?? '[]') as [string, number][]).filter(([k]) => k !== ck(tr, b, c))
    idx.push([ck(tr, b, c), ch.verses.length])
    let total = idx.reduce((a, [, n]) => a + n, 0)
    while (total > MAX_VERSES && idx.length > 1) { const [k, n] = idx.shift()!; localStorage.removeItem(k); total -= n }
    localStorage.setItem(ck(tr, b, c), JSON.stringify({ ...ch, at: Date.now() }))
    localStorage.setItem(idxKey, JSON.stringify(idx))
  } catch { /* storage full or blocked: fine, it just won't be kept */ }
}

/* ---------- fetching ---------- */
async function fetchJson(tr: OnlineTr, chapterId: string) {
  const qs = 'content-type=json&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false'
  const key = deviceKey()
  if (key) {
    try {
      const r = await fetch(`https://rest.api.bible/v1/bibles/${ONLINE[tr].id}/chapters/${chapterId}?${qs}`, { headers: { 'api-key': key }, signal: AbortSignal.timeout(12_000) })
      if (r.ok) return r.json()
      if (r.status === 401 || r.status === 403) throw new Error('API.Bible refused the key saved on this device. Check it in Settings › Reading.')
    } catch (e) { if (e instanceof Error && e.message.startsWith('API.Bible refused')) throw e /* otherwise try the PC */ }
  }
  const r = await fetch(`/api/bible?tr=${tr}&ch=${chapterId}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!r || !r.ok || !(r.headers.get('content-type') ?? '').includes('json')) {
    throw new Error(key ? `Couldn't reach API.Bible for the ${tr}. Check your connection.` : `The ${tr} comes from API.Bible through your PC, which isn't reachable. Add your API.Bible key in Settings › Reading to read it without the PC.`)
  }
  return r.json()
}

export function onlineChapter(tr: OnlineTr, b: number, c: number, verseCount: number): Promise<OnlineChapter> {
  const k = ck(tr, b, c)
  if (!mem.has(k)) {
    const kept = readKept(tr, b, c)
    const p = kept ? Promise.resolve(kept) : fetchJson(tr, `${USFM[b - 1]}.${c}`).then(j => {
      const ch: OnlineChapter = { ...parseChapter(b, c, j.data.content, verseCount), fums: j.meta?.fumsToken }
      keep(tr, b, c, ch)
      return ch
    })
    mem.set(k, p)
    p.catch(() => mem.delete(k))
  }
  return mem.get(k)!
}

/* ---------- fair-use reporting ---------- */
const session = Math.random().toString(36).slice(2, 12)
const reported = new Set<string>()
export function reportView(token?: string) {
  if (!token || reported.has(token)) return
  reported.add(token)
  let device = 'web'
  try { device = localStorage.getItem('margin.device') ?? 'web' } catch { /* ignore */ }
  const q = new URLSearchParams({ t: token, dId: device, sId: session })
  fetch(`https://fums.api.bible/f3?${q}`, { mode: 'no-cors', keepalive: true }).catch(() => {})
}
