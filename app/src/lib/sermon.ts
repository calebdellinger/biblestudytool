// Sermon notes: typed notes with their own editor (components/Sermon.tsx). They are ordinary notes (kind 'sermon'),
// so categories, verse links, search and the Notebook work on them; `sermon.doc` holds the editor's document and
// `body` a plain-text copy of it for searching and for finding the verses mentioned.
import { bookById, books, formatRef, loadChapter, localTr, splitVid, vid, type Translation } from './bible'
import { deleteNote, getState, noteRanges, saveNote, type Note, type SermonMeta } from './db'
import { findRefs, parseQuery, type Range } from './refs'

export type DocNode = { type?: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string }
export const TAGS = { application: 'Apply', question: 'Question', follow: 'Follow up' } as const
export type Tag = keyof typeof TAGS
export const TAG_TITLES: Record<Tag, string> = { application: 'Applications', question: 'Questions', follow: 'To follow up' }

export type Block = { kind: 'p' | 'h' | 'li' | 'tag' | 'verse'; text: string; tag?: Tag; n?: number; depth?: number; attrs?: Record<string, unknown> }

const inline = (n: DocNode): string => (n.text ?? (n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join('')))

/** The document as a flat list of blocks (list items numbered, verse quotes kept whole). */
export function blocksOf(doc: unknown): Block[] {
  const out: Block[] = []
  const walk = (nodes: DocNode[] | undefined, depth: number) => {
    for (const n of nodes ?? []) {
      if (n.type === 'paragraph') out.push({ kind: 'p', text: inline(n) })
      else if (n.type === 'heading') out.push({ kind: 'h', text: inline(n) })
      else if (n.type === 'tagged') out.push({ kind: 'tag', text: inline(n), tag: n.attrs?.tag as Tag })
      else if (n.type === 'verseQuote') out.push({ kind: 'verse', text: String(n.attrs?.label ?? ''), attrs: n.attrs })
      else if (n.type === 'blockquote') walk(n.content, depth)
      else if (n.type === 'bulletList' || n.type === 'orderedList') {
        (n.content ?? []).forEach((li, i) => {
          const [first, ...rest] = li.content ?? []
          out.push({ kind: 'li', text: first ? inline(first) : '', n: n.type === 'orderedList' ? i + 1 : undefined, depth })
          walk(rest, depth + 1)
        })
      }
    }
  }
  walk((doc as DocNode | null)?.content, 0)
  return out
}

const pad = (d?: number) => '  '.repeat(d ?? 0)
/** Plain text of the notes, for search and for finding the references typed in them. */
export function plainText(doc: unknown): string {
  return blocksOf(doc).map(b => b.kind === 'li' ? `${pad(b.depth)}${b.n ? `${b.n}.` : '-'} ${b.text}` : b.kind === 'tag' ? `${TAGS[b.tag!] ?? ''}: ${b.text}` : b.text).join('\n').trim()
}
/** The notes as Markdown (verse quotes carry their words), for copying out. */
export function toMarkdown(note: Note): string {
  const m = note.sermon
  const head = [`# ${note.title || 'Sermon notes'}`, [m?.speaker, m?.date, m?.series, m?.passage ? formatRef(m.passage.s, m.passage.e) : ''].filter(Boolean).join(' · ')].filter(Boolean)
  const lines = blocksOf(m?.doc).map(b => {
    if (b.kind === 'h') return `\n## ${b.text}`
    if (b.kind === 'li') return `${pad(b.depth)}${b.n ? `${b.n}.` : '-'} ${b.text}`
    if (b.kind === 'tag') return `**${TAGS[b.tag!] ?? ''}:** ${b.text}`
    if (b.kind === 'verse') return `> ${String(b.attrs?.text ?? '')}\n> — ${b.text} (${String(b.attrs?.tr ?? '')})`
    return b.text
  })
  return [...head, '', ...lines].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
export const wordCount = (doc: unknown) => plainText(doc).split(/\s+/).filter(Boolean).length

export const isEmptySermon = (n: Note) => !n.title.trim() && !n.body.trim() && !n.sermon?.speaker && !n.sermon?.series && !n.sermon?.passage

const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const sermonNotes = () => getState().notes.filter(n => n.kind === 'sermon' && !n.deleted)

export async function createSermon(): Promise<Note> {
  return saveNote({ kind: 'sermon', title: '', body: '', refs: [], sermon: { speaker: '', date: localDay(), series: '', passage: null, doc: null } })
}
/** Save the sermon: title, details, document, category. Works out the plain text and the verses mentioned. */
export async function saveSermon(id: string, p: { title: string; meta: SermonMeta; category: string | null }): Promise<Note | null> {
  const base = getState().notes.find(n => n._id === id)
  if (!base) return null
  const body = plainText(p.meta.doc)
  const typed = [...findRefs(`${p.title}\n${body}`), ...(p.meta.passage ? [p.meta.passage] : [])]
  return saveNote({ ...base, title: p.title.trim(), body, category: p.category, refs: noteRanges([], typed), sermon: p.meta })
}
export function dropIfEmpty(id: string) {
  const n = getState().notes.find(x => x._id === id)
  if (n && n.kind === 'sermon' && isEmptySermon(n)) void deleteNote(n)
}
/** Speakers and series used before, to suggest while typing. */
export function sermonValues(field: 'speaker' | 'series'): string[] {
  return [...new Set(sermonNotes().map(n => n.sermon?.[field]?.trim() ?? '').filter(Boolean))].sort()
}

// ---- verses ------------------------------------------------------------------------------------
/** Every verse id from s to e (across chapter breaks). */
export function idsBetween(s: number, e: number): number[] {
  const out: number[] = []
  let { b, c, v } = splitVid(s)
  const book = books()[b - 1]
  for (let id = s; id <= e && out.length < 200;) {
    out.push(id)
    v++
    if (book && v > book.verses[c - 1]) { c++; v = 1 }
    id = vid(b, c, v)
  }
  return out
}
export const MAX_QUOTE = 30
/** What was typed in the verse box, as a range. A bare "28", "v28" or "28-30" means those verses of the chapter in `ctx`. */
export function resolveRef(input: string, ctx: Range | null): Range | null {
  const t = input.trim()
  if (!t) return null
  const m = /^(?:v|vv|verses?)?\.?\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/i.exec(t)
  let r: Range | null
  if (m && ctx) {
    const { b, c } = splitVid(ctx.s), a = +m[1], z = +(m[2] ?? m[1])
    r = { s: vid(b, c, a), e: vid(b, c, Math.max(a, z)) }
  } else r = parseQuery(t)
  if (!r) return null
  const s = splitVid(r.s), e = splitVid(r.e)
  const ok = (x: { b: number; c: number; v: number }) => (bookById(x.b)?.verses[x.c - 1] ?? 0) >= x.v && x.v >= 1
  return ok(s) && ok(e) && r.e >= r.s ? r : null
}
/** The words of a passage, for putting in the notes. Online translations (NIV, NLT, NASB) may not be kept in notes, so those use the BSB. */
export async function quoteOf(r: Range, tr: Translation): Promise<{ text: string; tr: string }> {
  const use = localTr(tr)
  const ids = idsBetween(r.s, r.e)
  const chapters = new Map<string, string[]>()
  const parts: string[] = []
  for (const id of ids) {
    const { b, c, v } = splitVid(id)
    const key = `${b}:${c}`
    if (!chapters.has(key)) chapters.set(key, await loadChapter(use, b, c))
    const t = chapters.get(key)![v - 1]
    if (t) parts.push(ids.length > 1 ? `${v} ${t}` : t)
  }
  return { text: parts.join(' '), tr: use }
}
