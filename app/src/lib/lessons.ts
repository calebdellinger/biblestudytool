// Lessons: teaching material made of sections and blocks, stored with your notes and synced.
// Ready-made lessons ship as seed files (data/lessons/*.json) and are copied into your own, editable lesson.
import { getState, newLessonId, saveLesson, type Lesson, type LessonBlock, type LessonSection } from './db'
import { parseQuery } from './refs'
import { verseText, type Translation } from './bible'
import { verseIds } from './memory'

export const SEEDS = [
  { id: 'names-of-god', title: 'The Names of God', subtitle: 'Part 1 · How God makes Himself known in the Old Testament', file: '/data/lessons/names-of-god.json' },
]

type SeedBlock = { t: 'text' | 'question' | 'prep'; text: string } | { t: 'verse'; ref: string } | { t: 'word'; strong: string; note?: string }
type Seed = { title: string; subtitle?: string; sections: { title: string; subtitle?: string; blocks: SeedBlock[] }[] }

export const uid = () => Math.random().toString(36).slice(2, 10)
export const lessons = () => [...getState().lessons.values()].filter(l => !l.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

/** A verse block from a typed reference, or null if it can't be read. */
export function verseBlock(ref: string, id = uid()): Extract<LessonBlock, { t: 'verse' }> | null {
  const r = parseQuery(ref.trim())
  return r ? { id, t: 'verse', s: r.s, e: r.e, ref: ref.trim() } : null
}

export async function importSeed(seedId: string): Promise<Lesson> {
  const seed = SEEDS.find(s => s.id === seedId)!
  const data = (await (await fetch(seed.file)).json()) as Seed
  const bad: string[] = []
  const sections: LessonSection[] = data.sections.map(sec => ({
    id: uid(), title: sec.title, subtitle: sec.subtitle,
    blocks: sec.blocks.map(b => {
      if (b.t === 'verse') { const v = verseBlock(b.ref); if (!v) bad.push(b.ref); return v }
      return { id: uid(), ...b } as LessonBlock
    }).filter((b): b is LessonBlock => !!b),
  }))
  if (bad.length) console.warn('Lesson references not understood:', bad)
  const now = new Date().toISOString()
  return saveLesson({ _id: newLessonId(), type: 'lesson', title: data.title, subtitle: data.subtitle, seed: seedId, sections, createdAt: now, updatedAt: now })
}

export async function newLesson(title: string): Promise<Lesson> {
  const now = new Date().toISOString()
  return saveLesson({
    _id: newLessonId(), type: 'lesson', title: title || 'Untitled lesson', sections: [{ id: uid(), title: 'Introduction', blocks: [{ id: uid(), t: 'text', text: '' }] }],
    createdAt: now, updatedAt: now,
  })
}

/** The words of a verse block in a translation (verse numbers shown when there are several). */
export async function versesFor(s: number, e: number, tr: Translation): Promise<string> {
  const ids = verseIds(s, e)
  const parts: string[] = []
  for (const id of ids) {
    const t = await verseText(tr, id)
    if (t) parts.push(ids.length > 1 ? `${id % 1000} ${t}` : t)
  }
  return parts.join(' ')
}
