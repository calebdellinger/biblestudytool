// Who's speaking (BSB): ranges of spoken words and of the words naming the speaker, per chapter.
// Built from checked Gemini output by scripts/build_speakers.py.
import { useEffect, useState } from 'react'
export type Voice = [number, number, number, 0 | 1] // start, end, person index in the chapter, 0 = words / 1 = name
export type ChapterVoices = { people: [string, string][]; v: Record<string, Voice[]> }
type Book = Record<string, ChapterVoices>
let index: Promise<number[]> | null = null
const books = new Map<number, Promise<Book>>()
const loadIndex = () => (index ??= fetch('/data/speakers/BSB/index.json').then(r => (r.ok ? r.json() : [])).catch(() => []))
function loadBook(b: number) {
  if (!books.has(b)) books.set(b, fetch(`/data/speakers/BSB/${b}.json`).then(r => r.json()))
  return books.get(b)!
}
/** Speaker data for one chapter: undefined while loading, null when there is none (or not BSB). */
export function useChapterVoices(tr: string, book: number, chapter: number): ChapterVoices | null | undefined {
  const [data, setData] = useState<ChapterVoices | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setData(undefined)
    if (tr !== 'BSB') { setData(null); return }
    loadIndex().then(ix => (ix.includes(book) ? loadBook(book).then(d => d[String(chapter)] ?? null) : null))
      .then(d => { if (live) setData(d) }).catch(() => { if (live) setData(null) })
    return () => { live = false }
  }, [tr, book, chapter])
  return data
}
export const SPEAKER_COLORS = 8
