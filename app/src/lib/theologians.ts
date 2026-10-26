// The theologians library: Andrew Murray, E. M. Bounds and D. L. Moody (public-domain works from Project Gutenberg).
// Built by scripts/build_theologians.py and scripts/build_theologians_refs.mjs.

export type Chapter = [n: number, title: string, words: number]
export type Work = { id: string; title: string; gutenberg: number; chapters: Chapter[] }
export type Author = { id: string; name: string; years: string; about: string; works: Work[] }
export type TheoRef = { s: number; e: number; work: Work; author: Author; n: number; chapter: string; snippet: string }

let lib: Promise<Author[]> | null = null
export function loadLibrary() {
  lib ??= fetch('/data/theologians/index.json').then(r => r.json()).then((d: { authors: Author[] }) => d.authors)
  return lib
}
export async function findWork(id: string) {
  for (const a of await loadLibrary()) {
    const w = a.works.find(w => w.id === id)
    if (w) return { author: a, work: w }
  }
  return null
}
export async function chapterText(workId: string, n: number) {
  const r = await fetch(`/data/theologians/works/${encodeURIComponent(workId)}/${n}.md`)
  if (!r.ok) throw new Error('missing')
  return r.text()
}

const refCache = new Map<number, Promise<[number, number, string, number, string][]>>()
function bookRefs(b: number) {
  if (!refCache.has(b)) refCache.set(b, fetch(`/data/theologians/refs/${b}.json`).then(r => (r.ok ? r.json() : [])).catch(() => []))
  return refCache.get(b)!
}
/** Passages that quote or cite this verse: exact ones first, then ones about a wider passage around it. */
export async function theoRefsFor(verse: number): Promise<{ exact: TheoRef[]; wider: TheoRef[] }> {
  const [rows, authors] = await Promise.all([bookRefs(Math.floor(verse / 1_000_000)), loadLibrary()])
  const works = new Map(authors.flatMap(a => a.works.map(w => [w.id, { a, w }] as const)))
  const hits = rows.filter(r => r[0] <= verse && verse <= r[1]).flatMap(([s, e, wid, n, snippet]) => {
    const x = works.get(wid)
    return x ? [{ s, e, work: x.w, author: x.a, n, chapter: x.w.chapters.find(c => c[0] === n)?.[1] ?? '', snippet }] : []
  })
  const narrow = (r: TheoRef) => r.e - r.s <= 3
  return { exact: hits.filter(narrow), wider: hits.filter(r => !narrow(r)) }
}

export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230))
