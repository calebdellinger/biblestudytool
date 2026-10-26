// Matthew Henry (concise and complete) and Barnes' Notes on the New Testament. All public domain.
import { splitVid } from './bible'

type Concise = Record<string, { outline: string; sections: [number, number, string][] }>
type Complete = Record<string, { intro: string; sections: [number, number, string, string][] }>
type Barnes = Record<string, Record<string, string>>

const cache = new Map<string, Promise<unknown>>()
function load<T>(path: string): Promise<T | null> {
  if (!cache.has(path)) cache.set(path, fetch(path).then(r => (r.ok ? r.json() : null)).catch(() => null))
  return cache.get(path) as Promise<T | null>
}

export type CommentaryForVerse = {
  outline: string
  concise: { s: number; e: number; md: string; i: number }[]
  complete: { s: number; e: number; title: string; md: string; i: number }[]
  barnes: string | null
}

export async function commentaryFor(verse: number): Promise<CommentaryForVerse> {
  const { b, c, v } = splitVid(verse)
  const [concise, complete, barnes] = await Promise.all([
    load<Concise>(`/data/commentary/henry-concise/${b}.json`),
    load<Complete>(`/data/commentary/henry/${b}.json`),
    b >= 40 ? load<Barnes>(`/data/commentary/barnes/${b}.json`) : Promise.resolve(null),
  ])
  const ch = concise?.[c], full = complete?.[c]
  const note = barnes?.[c]?.[v] ?? null
  return {
    outline: ch?.outline ?? '',
    concise: (ch?.sections ?? []).map(([s, e, md], i) => ({ s, e, md, i })).filter(x => x.s <= v && v <= x.e),
    complete: (full?.sections ?? []).map(([s, e, title, md], i) => ({ s, e, title, md, i })).filter(x => x.s <= v && v <= x.e),
    // Barnes starts each note with "Verse 28." — the panel already says which verse.
    barnes: note ? note.replace(/^\s*Verses?\s+[\d\-, ]+\.\s*/, '') : null,
  }
}
