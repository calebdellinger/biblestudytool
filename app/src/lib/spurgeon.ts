// Spurgeon: sermons (Metropolitan Tabernacle Pulpit), The Treasury of David, Morning and Evening.
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { bookByOsis } from './bible'
import { findRefs } from './refs'
import bcvLang from './bcv'

export type Sermon = { id: string; num: string; title: string; vol: number; s: number; e: number; quote: string }
export type TodEntry = [number, number, string]
export type Tod = { title: string; intro: string; exposition: TodEntry[]; notes: TodEntry[]; hints: TodEntry[]; works: string }
export type Reading = { date: string; period: 'morning' | 'evening'; scripture: string; s: number; e: number; verse: string; text: string }

const once = <T,>(fn: () => Promise<T>) => { let p: Promise<T> | null = null; return () => (p ??= fn()) }

export const loadSermons = once(async (): Promise<Sermon[]> => {
  const r = await fetch('/data/spurgeon/sermons.json')
  const rows: [string, string, string, number, number, number, string][] = await r.json()
  return rows.map(([id, num, title, vol, s, e, quote]) => ({ id, num, title, vol, s, e, quote }))
})
export async function sermonsFor(verse: number) {
  return (await loadSermons()).filter(s => s.s && s.s <= verse && verse <= s.e)
}
export async function sermonsInChapter(verse: number) {
  const ch = Math.floor(verse / 1000)
  return (await loadSermons()).filter(s => s.s && Math.floor(s.s / 1000) === ch && !(s.s <= verse && verse <= s.e))
}
export async function sermonById(id: string) { return (await loadSermons()).find(s => s.id === id) }
export async function sermonText(id: string) {
  const r = await fetch(`/data/spurgeon/sermons/${encodeURIComponent(id)}.md`)
  if (!r.ok) throw new Error('missing')
  return r.text()
}

const todCache = new Map<number, Promise<Tod | null>>()
export function loadTod(psalm: number) {
  if (!todCache.has(psalm)) todCache.set(psalm, fetch(`/data/spurgeon/tod/${psalm}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null))
  return todCache.get(psalm)!
}
/** Treasury of David material for one verse of a psalm. */
export async function todFor(verse: number) {
  const b = Math.floor(verse / 1_000_000), c = Math.floor((verse % 1_000_000) / 1000), v = verse % 1000
  if (b !== 19) return null
  const t = await loadTod(c)
  if (!t) return null
  type Hit = { s: number; e: number; md: string; i: number }
  const pick = (l: TodEntry[]): Hit[] => l.map((x, i) => ({ s: x[0], e: x[1], md: x[2], i })).filter(x => x.s <= v && v <= x.e)
  return { psalm: c, exposition: pick(t.exposition), notes: pick(t.notes), hints: pick(t.hints) }
}

export const loadReadings = once(async (): Promise<Reading[]> => {
  const rows: [string, 'morning' | 'evening', string, number, number, string, string][] = await (await fetch('/data/spurgeon/morning-evening.json')).json()
  return rows.map(([date, period, scripture, s, e, verse, text]) => ({ date, period, scripture, s, e, verse, text }))
})
export async function readingsFor(verse: number) {
  return (await loadReadings()).filter(r => r.s && r.s <= verse && verse <= r.e)
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
export const dateKey = (d: Date) => `${MONTHS[d.getMonth()]}-${d.getDate()}`
export const dateLabel = (key: string) => {
  const [m, day] = key.split('-')
  return `${m[0].toUpperCase()}${m.slice(1)} ${day}`
}

/** Markdown to safe HTML, with every Bible reference turned into a link into the reader. */
export function renderSpurgeon(md: string) {
  const html = marked.parse(md, { async: false, gfm: true, breaks: false }) as string
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'em', 'strong', 'i', 'b', 'blockquote', 'br', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'hr', 'a', 'sup', 'span'], ALLOWED_ATTR: ['href', 'class'] })
  return linkRefsInHtml(clean)
}
function linkRefsInHtml(html: string) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    if (node.parentElement?.closest('a')) continue
    const text = node.data
    const hits = bcvLang.indices(text)
    if (!hits.length) continue
    const frag = doc.createDocumentFragment()
    let at = 0
    for (const h of hits) {
      const [a, b] = h.indices
      const ref = findRefs(text.slice(a, b))[0]
      if (!ref) continue
      frag.append(text.slice(at, a))
      const link = doc.createElement('a')
      const id = ref.s, bk = Math.floor(id / 1_000_000), c = Math.floor((id % 1_000_000) / 1000), v = id % 1000
      link.href = `#/read/${bk}/${c}/${v}`
      link.className = 'ref-link'
      link.textContent = text.slice(a, b)
      frag.append(link)
      at = b
    }
    frag.append(text.slice(at))
    node.replaceWith(frag)
  }
  return doc.body.firstElementChild!.innerHTML
}

export type SearchHit = { kind: 'sermon' | 'psalm' | 'reading' | 'work'; id: string; title: string; ref: string; snippet: string }
/** Asks the PC first; if it can't be reached, searches the offline library on this device (when saved). */
export async function searchSpurgeon(q: string): Promise<{ hits: SearchHit[]; onDevice: boolean } | 'offline'> {
  try {
    const r = await fetch(`/api/spurgeon/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10_000) })
    if (r.ok) return { hits: await r.json(), onDevice: false }
  } catch { /* PC out of reach */ }
  const { searchOnDevice } = await import('./offlineSearch')
  const hits = await searchOnDevice(q).catch(() => null)
  return hits ? { hits, onDevice: true } : 'offline'
}

export { bookByOsis }
