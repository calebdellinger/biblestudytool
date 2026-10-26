// Memorizing Scripture: a few passages a week, three boxes, and spaced review.
//   Not yet  → practise again tomorrow
//   Almost   → in 2 days
//   Got it   → 3, 7, 14 days; after four in a row it's Kept and comes back monthly.
// Forgetting a Kept passage moves it back into the box you grade it.
import { getState, newId, saveDoc, type Grade, type Mem, type MemBox, type MemPassage } from './db'
import { books, splitVid, verseText, vid, type Translation } from './bible'

export const BOX_LABEL: Record<MemBox, string> = { not: 'Not yet', almost: 'Almost', got: 'Got it', kept: 'Kept' }
export const WEEKLY_GOAL = 5
const GOT_STEPS = [3, 7, 14]
const KEPT_DAYS = 30

/** Local calendar date as YYYY-MM-DD. */
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number)
  return today(new Date(y, m - 1, d + n))
}
/** Monday of the week containing `day`. */
export function weekStart(day = today()) {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return addDays(day, -((dt.getDay() + 6) % 7))
}

export const mems = () => getState().mems.filter(m => !m.deleted)
export const isDue = (m: Mem, day = today()) => m.due <= day
export const dueMems = (day = today()) => sortForPractice(mems().filter(m => isDue(m, day)))
/** The weekly five counts single verses only; passage sections sit outside it. */
export const thisWeek = () => { const w = weekStart(); return mems().filter(m => !m.passage && m.added >= w) }
export const singles = () => mems().filter(m => !m.passage)
export const memFor = (verse: number) => mems().find(m => m.s <= verse && verse <= m.e)

const ORDER: MemBox[] = ['not', 'almost', 'got', 'kept']
export function sortForPractice(list: Mem[]) {
  return [...list].sort((a, b) => ORDER.indexOf(a.box) - ORDER.indexOf(b.box) || a.due.localeCompare(b.due) || a.s - b.s)
}

export async function addMem(s: number, e: number, tr: string): Promise<Mem> {
  const existing = mems().find(m => m.s === s && m.e === e)
  if (existing) return existing
  const d = today()
  return saveDoc<Mem>({
    _id: newId('mem'), type: 'mem', s, e, tr, box: 'not', due: d, streak: 0, added: d, reviews: [],
    createdAt: new Date().toISOString(), updatedAt: '',
  })
}
export const removeMem = (m: Mem) => saveDoc<Mem>({ ...m, deleted: true })

/** Where a passage goes after you grade yourself on it. */
export function nextState(m: Mem, g: Grade, day = today()): Pick<Mem, 'box' | 'due' | 'streak'> {
  if (g === 'not') return { box: 'not', due: addDays(day, 1), streak: 0 }
  if (g === 'almost') return { box: 'almost', due: addDays(day, 2), streak: 0 }
  const streak = m.streak + 1
  if (m.box === 'kept' || streak > GOT_STEPS.length) return { box: 'kept', due: addDays(day, KEPT_DAYS), streak }
  return { box: 'got', due: addDays(day, GOT_STEPS[streak - 1]), streak }
}
export async function grade(m: Mem, g: Grade) {
  const cur = getState().mems.find(x => x._id === m._id) ?? m
  const d = today()
  const saved = await saveDoc<Mem>({ ...cur, ...nextState(cur, g, d), reviews: [...cur.reviews, { d, g }].slice(-60), learned: cur.learned ?? (g === 'got' ? d : cur.reviews.find(r => r.g === 'got')?.d) })
  if (saved.passage) await afterSection(saved)
  return saved
}

/** Every verse id from s to e, across chapter breaks. */
export function verseIds(s: number, e: number): number[] {
  const out: number[] = []
  let { b, c, v } = splitVid(s)
  const book = books()[b - 1]
  for (let id = s; id <= e && out.length < 400;) {
    out.push(id)
    v++
    if (book && v > book.verses[c - 1]) { c++; v = 1 } // (without the book list, stays in the chapter)
    id = vid(b, c, v)
  }
  return out
}

/** The passage's words, verse by verse. */
export async function memText(m: Pick<Mem, 's' | 'e' | 'tr'>): Promise<string[]> {
  const out: string[] = []
  for (const v of verseIds(m.s, m.e)) {
    const t = await verseText(m.tr as Translation, v)
    if (t) out.push(t)
  }
  return out
}

/* ---------- longer passages, a section at a time ---------- */
export const SECTION_MAX = 3
export const passages = () => getState().passages.filter(p => !p.deleted)
export const passageById = (id: string) => getState().passages.find(p => p._id === id && !p.deleted)
/** [start, end] of every section, in order. */
export function sectionsOf(p: Pick<MemPassage, 's' | 'e' | 'cuts'>): [number, number][] {
  const ids = verseIds(p.s, p.e), out: [number, number][] = []
  let start = ids[0]
  ids.forEach((id, i) => {
    if (p.cuts.includes(id) || i === ids.length - 1) { out.push([start, id]); start = ids[i + 1] }
  })
  return out
}
export const sectionMems = (p: MemPassage) => mems().filter(m => m.passage === p._id).sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))

/** Split a passage into sections of 2–3 verses, ending each at the end of a sentence where possible. */
export function suggestCuts(ids: number[], texts: string[]): number[] {
  const ends = (t = '') => /[.!?][”’"')\]]*\s*$/.test(t.trim())
  const groups: number[][] = []
  let cur: number[] = []
  ids.forEach((id, i) => {
    cur.push(id)
    if (cur.length >= SECTION_MAX || (cur.length >= 2 && ends(texts[i]))) { groups.push(cur); cur = [] }
  })
  if (cur.length) {
    const last = groups[groups.length - 1]
    if (cur.length === 1 && last && last.length < SECTION_MAX) last.push(...cur); else groups.push(cur)
  }
  return groups.slice(0, -1).map(g => g[g.length - 1])
}

export async function addPassage(s: number, e: number, tr: string, cuts: number[]): Promise<MemPassage> {
  const existing = passages().find(p => p.s === s && p.e === e)
  if (existing) return existing
  const d = today()
  const p = await saveDoc<MemPassage>({
    _id: newId('mempass'), type: 'mempass', s, e, tr, cuts: [...cuts].sort((a, b) => a - b), open: 1, added: d,
    run: null, runs: [], createdAt: new Date().toISOString(), updatedAt: '',
  })
  await openSection(p, 0, d)
  return p
}
async function openSection(p: MemPassage, idx: number, due: string) {
  const [s, e] = sectionsOf(p)[idx]
  return saveDoc<Mem>({
    _id: newId('mem'), type: 'mem', s, e, tr: p.tr, box: 'not', due, streak: 0, added: today(), reviews: [],
    passage: p._id, idx, createdAt: new Date().toISOString(), updatedAt: '',
  })
}
/** After a section is graded: open the next one once the newest reaches Got it, and schedule a "say it all" run
 *  once two or more sections are learned. One new section a day at most (it opens tomorrow). */
async function afterSection(m: Mem) {
  let p = passageById(m.passage!)
  if (!p) return
  const total = sectionsOf(p).length
  const d = today()
  if (m.idx === p.open - 1 && p.open < total && (m.box === 'got' || m.box === 'kept')) {
    await openSection(p, p.open, addDays(d, 1))
    p = await saveDoc<MemPassage>({ ...p, open: p.open + 1 })
  }
  if (!p.run && runReady(p)) await saveDoc<MemPassage>({ ...p, run: { box: 'not', due: addDays(d, 1), streak: 0 } })
}
/** How many sections, from the start, are learned (Got it or Kept). */
export function knownSections(p: MemPassage) {
  const list = sectionMems(p)
  let n = 0
  while (n < p.open && list.some(m => m.idx === n && (m.box === 'got' || m.box === 'kept'))) n++
  return n
}
/** A "say it all" run needs two or more learned sections in a row from the start. The newest one, still being learned, waits. */
export const runReady = (p: MemPassage) => knownSections(p) >= 2
export const runDue = (p: MemPassage, day = today()) => !!p.run && p.run.due <= day && runReady(p)
/** The verses covered by a run: from the start to the end of the last learned section. */
export const runRange = (p: MemPassage): [number, number] => [p.s, sectionsOf(p)[Math.max(1, knownSections(p)) - 1][1]]

/** Grade a run: said it all → spaced like Got it; stumbles → the run comes back in 2 days and each section you stumbled in drops to Almost. */
export async function gradeRun(p: MemPassage, missed: number[]) {
  const cur = passageById(p._id) ?? p
  const d = today()
  const run = cur.run ?? { box: 'not' as MemBox, due: d, streak: 0 }
  const next = nextState({ ...run } as Mem, missed.length ? 'almost' : 'got', d)
  await saveDoc<MemPassage>({ ...cur, run: next, runs: [...cur.runs, { d, missed }].slice(-60) })
  const list = sectionMems(cur)
  for (const i of missed) { const m = list.find(x => x.idx === i); if (m) await grade(m, 'almost') }
}

/** Change where sections split, for the part not started yet. Earlier splits stay as they are. */
export async function setCuts(p: MemPassage, cuts: number[]) {
  const fixedEnd = sectionsOf(p)[p.open - 1][1]
  const keep = p.cuts.filter(c => c <= fixedEnd)
  const next = [...new Set([...keep, ...cuts.filter(c => c > fixedEnd && c < p.e)])].sort((a, b) => a - b)
  return saveDoc<MemPassage>({ ...p, cuts: next })
}
export async function removePassage(p: MemPassage) {
  for (const m of sectionMems(p)) await removeMem(m)
  await saveDoc<MemPassage>({ ...p, deleted: true })
}

/** Everything to practise today: single verses and passage sections, then passage runs. Ids; runs are "run:<passage id>". */
export function dueQueue(day = today(), only?: string): string[] {
  const pass = only?.startsWith('pass:') ? only.slice(5) : null
  const items = dueMems(day).filter(m => !pass || m.passage === pass).map(m => m._id)
  const runs = passages().filter(p => (!pass || p._id === pass) && runDue(p, day)).map(p => `run:${p._id}`)
  return [...items, ...runs]
}
export const dueCount = (day = today()) => dueQueue(day).length

/** "In 3 days", "Tomorrow", "Today". */
export function dueLabel(due: string, day = today()) {
  if (due <= day) return 'Today'
  const [y1, m1, d1] = day.split('-').map(Number), [y2, m2, d2] = due.split('-').map(Number)
  const n = Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86_400_000)
  if (n === 1) return 'Tomorrow'
  if (n < 7) return new Date(y2, m2 - 1, d2).toLocaleDateString(undefined, { weekday: 'long' })
  return new Date(y2, m2 - 1, d2).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* ---------- practice helpers ---------- */
export type Token = { word: string; pre: string; post: string }
/** Split text into words, keeping punctuation attached so it stays visible when a word is hidden. */
export function tokens(text: string): Token[] {
  return text.split(/\s+/).filter(Boolean).map(w => {
    const m = w.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u)!
    return { pre: m[1], word: m[2], post: m[3] }
  })
}
/** First letter of each word, keeping punctuation: "And we know that" → "A w k t". */
export const firstLetters = (t: Token) => t.word ? t.pre + t.word[0] + t.post : t.pre + t.post

/** A fixed, shuffled order for hiding words, so each step hides more of the same words. */
export function hideOrder(n: number, seed: number) {
  const idx = [...Array(n).keys()]
  let x = seed % 2147483647 || 1
  for (let i = n - 1; i > 0; i--) {
    x = (x * 48271) % 2147483647
    const j = x % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}
