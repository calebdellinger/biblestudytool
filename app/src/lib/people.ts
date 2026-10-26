// People, events and dates from Theographic Bible Metadata (CC BY-SA 4.0); biographies from Easton's Bible Dictionary (1897).
import { splitVid } from './bible'

export type Person = {
  n: number; name: string; title: string; gender: string; birth: number | null; death: number | null
  father: number[]; mother: number[]; siblings: number[]; partners: number[]; children: number[]
  verseCount: number; minYear: number | null; maxYear: number | null; aka: string[]
}
type Row = [string, string, string, number | null, number | null, number[], number[], number[], number[], number[], number, number | null, number | null, string[]]
export type BibleEvent = { title: string; year: number; duration: string; s: number; e: number; people: number[] }
export type WorldEvent = { start: number; end: number | null; title: string; region: string; note: string }

const cache = new Map<string, Promise<unknown>>()
const get = <T,>(path: string, fallback: T): Promise<T> => {
  if (!cache.has(path)) cache.set(path, fetch(path).then(r => (r.ok ? r.json() : fallback)).catch(() => fallback))
  return cache.get(path) as Promise<T>
}

export async function loadPeople(): Promise<Person[]> {
  const rows = await get<Row[]>('/data/people/people.json', [])
  return rows.map((r, n) => ({
    n, name: r[0], title: r[1], gender: r[2], birth: r[3], death: r[4], father: r[5], mother: r[6], siblings: r[7],
    partners: r[8], children: r[9], verseCount: r[10], minYear: r[11], maxYear: r[12], aka: r[13],
  }))
}
const HIDDEN = new Set(['God', 'Holy Spirit', 'Spirit'])

export async function peopleInVerse(v: number) {
  const { b, c, v: vv } = splitVid(v)
  const [all, idx] = await Promise.all([loadPeople(), get<Record<string, number[]>>(`/data/people/verses/${b}.json`, {})])
  return (idx[`${c}:${vv}`] ?? []).map(n => all[n]).filter(p => p && !HIDDEN.has(p.name))
}
export async function peopleInChapter(v: number) {
  const { b, c } = splitVid(v)
  const [all, idx] = await Promise.all([loadPeople(), get<Record<string, number[]>>(`/data/people/verses/${b}.json`, {})])
  const count = new Map<number, number>()
  for (const [k, ns] of Object.entries(idx)) if (k.startsWith(`${c}:`)) for (const n of ns) count.set(n, (count.get(n) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => all[n]).filter(p => p && !HIDDEN.has(p.name))
}
export async function personBio(p: Person): Promise<string> {
  const letter = /[A-Z]/i.test(p.name[0]) ? p.name[0].toUpperCase() : '_'
  return (await get<Record<string, string>>(`/data/people/bio/${letter}.json`, {}))[String(p.n)] ?? ''
}
export async function personMentions(n: number): Promise<number[]> {
  return (await get<Record<string, number[]>>(`/data/people/mentions/${Math.floor(n / 200)}.json`, {}))[String(n)] ?? []
}

/** The approximate year of a chapter, from the traditional chronology the data follows. */
export async function chapterYear(v: number): Promise<{ year: number; min: number; max: number } | null> {
  const { b, c } = splitVid(v)
  const r = (await get<Record<string, [number, number]>>(`/data/people/years/${b}.json`, {}))[String(c)]
  return r ? { year: Math.round((r[0] + r[1]) / 2), min: r[0], max: r[1] } : null
}
export async function loadEvents(): Promise<BibleEvent[]> {
  const rows = await get<[string, number, string, number, number, number[]][]>('/data/people/events.json', [])
  return rows.map(([title, year, duration, s, e, people]) => ({ title, year, duration, s, e, people }))
}
export async function loadWorld(): Promise<WorldEvent[]> {
  const rows = await get<[number, number | null, string, string, string][]>('/data/people/world.json', [])
  return rows.map(([start, end, title, region, note]) => ({ start, end, title, region, note }))
}

export const fmtYear = (y: number) => (y < 0 ? `${-y} BC` : `AD ${y}`)
export const fmtSpan = (a: number, b: number | null) => {
  if (b == null || b === a) return fmtYear(a)
  if (a < 0 && b < 0) return `${-a}–${-b} BC`
  if (a > 0 && b > 0) return `AD ${a}–${b}`
  return `${-a} BC – AD ${b}`
}
export const lifespan = (p: Person) => (p.birth != null || p.death != null
  ? `${p.birth != null ? fmtYear(p.birth) : '?'} – ${p.death != null ? fmtYear(p.death) : '?'}`.replace(/^(\d+) BC – (\d+) BC$/, '$1–$2 BC')
  : '')
