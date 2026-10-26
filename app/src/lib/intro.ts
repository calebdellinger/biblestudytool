// Book and section introductions (written for Margin; see scripts/build_intros.py).
export type Section = { id: string; name: string; also: string; t: 'OT' | 'NT'; first: number; last: number; summary: string; reading: string }
export type BookIntro = {
  id: number; section: string; means: string; kind: string; author: string; authorMeans?: string; authorNote?: string
  date: string; to: string; covers?: string; summary: string; themes: string[]
  key: [string, number, number][]; outline: [string, number, number, number, number][]; fits: string
}
/** Section names and ranges, available instantly for the book picker. */
export const SECTIONS: Pick<Section, 'id' | 'name' | 't' | 'first' | 'last'>[] = [
  { id: 'law', name: 'The Pentateuch', t: 'OT', first: 1, last: 5 },
  { id: 'history', name: 'History', t: 'OT', first: 6, last: 17 },
  { id: 'wisdom', name: 'Wisdom and Poetry', t: 'OT', first: 18, last: 22 },
  { id: 'major', name: 'Major Prophets', t: 'OT', first: 23, last: 27 },
  { id: 'minor', name: 'Minor Prophets', t: 'OT', first: 28, last: 39 },
  { id: 'gospels', name: 'The Gospels', t: 'NT', first: 40, last: 43 },
  { id: 'acts', name: 'History of the Church', t: 'NT', first: 44, last: 44 },
  { id: 'paul', name: "Paul's Letters", t: 'NT', first: 45, last: 57 },
  { id: 'general', name: 'General Letters', t: 'NT', first: 58, last: 65 },
  { id: 'prophecy', name: 'Prophecy', t: 'NT', first: 66, last: 66 },
]
export const sectionOf = (book: number) => SECTIONS.find(s => s.first <= book && book <= s.last)!
let data: Promise<{ sections: Section[]; books: BookIntro[] }> | null = null
const load = () => (data ??= fetch('/data/intro.json').then(r => r.json() as Promise<{ sections: Section[]; books: BookIntro[] }>))
export async function introFor(book: number) {
  const d = await load()
  const b = d.books.find(x => x.id === book)
  return b ? { book: b, section: d.sections.find(s => s.id === b.section)! } : null
}
