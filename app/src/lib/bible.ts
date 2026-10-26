// Static reference data: book metadata, chapter text, cross-references.
export type Book = {
  id: number; osis: string; name: string; abbr: string
  testament: 'OT' | 'NT'; verses: number[] // verse count per chapter
}
import { isOnlineTr, onlineChapter, ONLINE, reportView } from './apiBible'
export type Translation = 'BSB' | 'KJV' | 'NIV' | 'NLT' | 'NASB'
export const TRANSLATIONS: { id: Translation; name: string; online?: true }[] = [
  { id: 'BSB', name: 'Berean Standard Bible' },
  { id: 'KJV', name: 'King James Version' },
  { id: 'NASB', name: ONLINE.NASB.name, online: true },
  { id: 'NIV', name: ONLINE.NIV.name, online: true },
  { id: 'NLT', name: ONLINE.NLT.name, online: true },
]
export const trName = (tr: string) => TRANSLATIONS.find(t => t.id === tr)?.name ?? tr
/** Online translations are fetched a chapter at a time. Where a feature reads many chapters at once
 *  (search, word study, cross-references, lessons, the newspaper), it uses the BSB instead. */
export const localTr = (tr: string): 'BSB' | 'KJV' => (tr === 'KJV' ? 'KJV' : 'BSB')

// A verse id packs book, chapter and verse into one integer: Rom 8:28 = 45008028.
export const vid = (b: number, c: number, v: number) => b * 1_000_000 + c * 1000 + v
export const splitVid = (id: number) => ({
  b: Math.floor(id / 1_000_000), c: Math.floor((id % 1_000_000) / 1000), v: id % 1000,
})

let booksCache: Book[] | null = null
let booksPromise: Promise<Book[]> | null = null
export function loadBooks(): Promise<Book[]> {
  booksPromise ??= fetch('/data/books.json').then(r => r.json()).then((b: Book[]) => (booksCache = b))
  return booksPromise
}
export const books = () => booksCache ?? []
export const bookById = (id: number) => booksCache?.[id - 1]
export const bookByOsis = (osis: string) => booksCache?.find(b => b.osis === osis)

const bookText = new Map<string, Promise<string[][]>>()
export function loadBook(tr: Translation, b: number): Promise<string[][]> {
  if (isOnlineTr(tr)) tr = 'BSB'   // never fetch a whole online book
  const key = `${tr}/${b}`
  if (!bookText.has(key)) {
    bookText.set(key, fetch(`/data/bible/${tr}/${b}.json`).then(r => {
      if (!r.ok) throw new Error(`Couldn't load ${key}`)
      return r.json()
    }))
  }
  return bookText.get(key)!
}
/** One chapter's verses in any translation (online ones come from API.Bible). */
export async function loadChapter(tr: Translation, b: number, c: number): Promise<string[]> {
  if (isOnlineTr(tr)) {
    await loadBooks()
    const ch = await onlineChapter(tr, b, c, bookById(b)?.verses[c - 1] ?? 0)
    reportView(ch.fums)   // shown somewhere: counts as a view for API.Bible's fair-use reporting
    return ch.verses
  }
  return (await loadBook(tr, b))[c - 1] ?? []
}
export async function verseText(tr: Translation, id: number) {
  const { b, c, v } = splitVid(id)
  return (await loadChapter(tr, b, c))[v - 1] ?? ''
}

export type XRef = [number, number, number] // start id, end id, votes
const xrefCache = new Map<number, Promise<Record<string, XRef[]>>>()
export async function crossRefs(id: number): Promise<XRef[]> {
  const { b, c, v } = splitVid(id)
  if (!xrefCache.has(b)) {
    xrefCache.set(b, fetch(`/data/xrefs/${b}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})))
  }
  return (await xrefCache.get(b)!)[`${c}:${v}`] ?? []
}

/** "Psalm 23" when one psalm is meant, otherwise the book's name. */
export const chapterName = (b: number, short = false) => {
  const bk = bookById(b)
  if (!bk) return '?'
  if (bk.osis === 'Ps' && !short) return 'Psalm'
  return short ? bk.abbr : bk.name
}

export function formatRef(start: number, end = start, short = false): string {
  const s = splitVid(start), e = splitVid(end)
  const name = s.b === e.b && s.c === e.c ? chapterName(s.b, short) : chapterName(s.b, short).replace(/^Psalm$/, 'Psalms')
  if (start === end) return `${name} ${s.c}:${s.v}`
  if (s.b === e.b && s.c === e.c) return `${name} ${s.c}:${s.v}–${e.v}`
  if (s.b === e.b) return `${name} ${s.c}:${s.v}–${e.c}:${e.v}`
  return `${name} ${s.c}:${s.v} – ${formatRef(end, end, short)}`
}

// Download every book so the whole Bible works offline.
export async function downloadAll(tr: Translation, onProgress?: (n: number) => void) {
  await loadBooks()
  let n = 0
  for (const b of books()) {
    await loadBook(tr, b.id)
    onProgress?.(++n)
  }
}
