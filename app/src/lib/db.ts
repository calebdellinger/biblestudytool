// Your own data: notes, highlights and where you left off.
// Stored on this device with PouchDB and synced to CouchDB on your PC when it's reachable.
import PouchDB from 'pouchdb-browser'
import { useSyncExternalStore } from 'react'
import type { Range } from './refs'

export type HighlightColor = 'amber' | 'sage' | 'sky' | 'rose' | 'iris'
export const HIGHLIGHT_COLORS: HighlightColor[] = ['amber', 'sage', 'sky', 'rose', 'iris']

/** Where a highlight sits.
 *  bible: verses s..e in translation tr; so = start offset in verse s, eo = end offset in verse e (-1 = end of verse).
 *  text:  any other document (sermon, Treasury of David, reading); b1/o1 to b2/o2 are block index + character offset. */
export type BibleSrc = { kind: 'bible'; tr: string; s: number; e: number; so: number; eo: number }
export type TextSrc = { kind: 'text'; doc: string; label: string; href: string; b1: number; o1: number; b2: number; o2: number }
export type Mark = {
  _id: string; _rev?: string; type: 'mark'
  src: BibleSrc | TextSrc
  quote: string                 // the highlighted words, for showing in notes
  color: HighlightColor | null  // null = no colour, just an anchor for a note
  links: Range[]                // verses this highlight is linked to (for sermon/Treasury highlights)
  createdAt: string; updatedAt: string; deleted?: boolean
}
export type NoteRef = Range & { confirmed: boolean }
export type Note = {
  _id: string; _rev?: string; type: 'note'
  kind: 'typed' | 'handwritten' | 'ink' | 'sermon'   // handwritten = photo pages (older); ink = vector pages (inkpage: docs); sermon = typed sermon notes (own editor)
  title: string; body: string
  anchors?: string[]            // highlight ids this note belongs to
  category?: string | null      // category id
  refs: NoteRef[]               // every verse range the note touches (from its highlights and references in the text)
  tags: string[]
  /** Handwritten notes: photo pages (attachment names) or, for ink notes, the ids of their inkpage: documents, in order. */
  pages?: string[]
  _attachments?: PouchDB.Core.Attachments
  /** Sermon notes: who preached, when, the passage, and the editor's document (the plain-text copy lives in `body`). */
  sermon?: SermonMeta
  createdAt: string; updatedAt: string; deleted?: boolean
}
export type SermonMeta = { speaker: string; date: string; series: string; passage: Range | null; doc: unknown }
/** One page of an ink note: traced paper notes (fixed) plus pen strokes written in the app. Its own document so
 *  writing on one page only re-syncs that page. */
export type InkPageDoc = {
  _id: string; _rev?: string; type: 'inkpage'; note: string
  w: number; h: number; paper: 'plain' | 'lined' | 'grid'
  trace: { k: 'ink' | 'blue' | 'red' | 'green'; d: string }[]
  strokes: { c: 'ink' | 'blue' | 'red' | 'green' | 'yellow'; w: number; hl?: boolean; p: number[] }[]
  /** Shapes and text boxes placed on this band (band-local coordinates). */
  items?: InkItemDoc[]
  createdAt: string; updatedAt: string; deleted?: boolean
}
/** rect/ellipse/tri: box x,y,w,h · line/arrow: from (x,y) to (x+w, y+h) · text: top-left x,y, font size `size`. */
export type InkItemDoc = {
  id: string; t: 'rect' | 'ellipse' | 'tri' | 'line' | 'arrow' | 'text' | 'verse'
  x: number; y: number; w: number; h: number
  c: 'ink' | 'blue' | 'red' | 'green' | 'yellow'; sw: number; fill?: boolean
  text?: string; size?: number
  /** line/arrow: the items each end is attached to (the ends then follow those items around) */
  from?: string; to?: string
  /** verse card: the passage (verse ids), translation and a label; `text` holds the words */
  s?: number; e?: number; tr?: string; ref?: string
}
/** A teaching lesson: sections made of blocks. Prep notes are private and never shown when presenting or printing. */
export type LessonBlock =
  | { id: string; t: 'text'; text: string }
  | { id: string; t: 'verse'; s: number; e: number; ref: string }
  | { id: string; t: 'word'; strong: string; note?: string }
  | { id: string; t: 'question'; text: string }
  | { id: string; t: 'prep'; text: string }
export type LessonSection = { id: string; title: string; subtitle?: string; blocks: LessonBlock[] }
export type Lesson = {
  _id: string; _rev?: string; type: 'lesson'
  title: string; subtitle?: string; seed?: string
  sections: LessonSection[]
  createdAt: string; updatedAt: string; deleted?: boolean
}
export type Category = { id: string; name: string; parent: string | null }
type Categories = { _id: 'categories'; _rev?: string; type: 'categories'; items: Category[] }
// Highlights from the first version (one colour per verse); converted to marks on load.
type LegacyHighlight = { _id: string; _rev?: string; type: 'highlight'; verse: number; color: HighlightColor; deleted?: boolean }
export type Place = {
  _id: 'session:last'; _rev?: string; type: 'session'
  verse: number; scope: Scope; translation: string; updatedAt: string
}
export type Scope = 'verse' | 'chapter' | 'book'
/** A passage you're memorizing. box: not = not there yet, almost, got = got it, kept = learned, reviewed monthly. */
export type MemBox = 'not' | 'almost' | 'got' | 'kept'
export type Grade = 'not' | 'almost' | 'got'
export type Mem = {
  _id: string; _rev?: string; type: 'mem'
  s: number; e: number; tr: string
  box: MemBox; due: string; streak: number; added: string
  reviews: { d: string; g: Grade }[]
  createdAt: string; updatedAt: string; deleted?: boolean
  /** Set when this is one section of a longer passage (see MemPassage): the passage's id and the section's place in it. */
  passage?: string; idx?: number
  /** The day it first reached Got it (kept even when the practice history is trimmed). */
  learned?: string
}
/** A longer passage learned a few verses at a time. Each opened section is its own Mem; `cuts` are the last verse of every
 *  section but the final one. When two or more sections are learned, a "say it all" run is scheduled like a Mem. */
export type MemPassage = {
  _id: string; _rev?: string; type: 'mempass'
  s: number; e: number; tr: string; cuts: number[]
  open: number; added: string
  run: { box: MemBox; due: string; streak: number } | null
  runs: { d: string; missed: number[] }[]
  createdAt: string; updatedAt: string; deleted?: boolean
}
/** Daily reading and reminders. Synced, so the PC knows what to send and when. Times are "HH:MM" or "" for off. */
export type Daily = {
  _id: 'settings:daily'; _rev?: string; type: 'daily'
  plan: 'mcheyne' | 'none'; spurgeon: boolean
  times: { reading: string; evening: string; memory: string }
  tz: string; updatedAt: string
}
/** Which of the day's plan readings you've ticked off, by "MM-DD". */
export type PlanProgress = { _id: string; _rev?: string; type: 'planprog'; year: number; done: Record<string, number[]>; updatedAt: string }
/** Something you marked as read (a Bible chapter, sermon, psalm or book chapter), with every date you marked it. */
export type ReadMark = { _id: string; _rev?: string; type: 'read'; key: string; dates: string[]; updatedAt: string; deleted?: boolean }
/** Seconds of active reading per item on one day from one device (one writer per doc, so no sync conflicts). */
export type TimeLog = { _id: string; _rev?: string; type: 'timelog'; date: string; device: string; t: Record<string, number>; updatedAt: string }
type Doc = Note | InkPageDoc | Lesson | Mark | Place | Categories | LegacyHighlight | Mem | MemPassage | Daily | PlanProgress | ReadMark | TimeLog

export const db = new PouchDB<Doc>('margin')

// ---- in-memory store with subscriptions -------------------------------------------------
type State = { notes: Note[]; marks: Map<string, Mark>; categories: Category[]; mems: Mem[]; passages: MemPassage[]; daily: Daily | null; progress: Record<number, PlanProgress>; read: Map<string, ReadMark>; ink: Map<string, InkPageDoc>; lessons: Map<string, Lesson>; ready: boolean }
let state: State = { notes: [], marks: new Map(), categories: [], mems: [], passages: [], daily: null, progress: {}, read: new Map(), ink: new Map(), lessons: new Map(), ready: false }
const listeners = new Set<() => void>()
export const subscribe = (fn: () => void) => (listeners.add(fn), () => { listeners.delete(fn) })
export const getState = () => state
/** Re-render when highlights or notes change (cheap counter, for components that read getState directly). */
let version = 0
export function useMarkVersion() {
  return useSyncExternalStore(subscribe, () => version)
}
function emit() { state = { ...state }; version++; listeners.forEach(f => f()) }

function absorb(doc: Doc & { _deleted?: boolean }) {
  const gone = doc._deleted || (doc as { deleted?: boolean }).deleted
  if (doc.type === 'note') {
    const rest = state.notes.filter(n => n._id !== doc._id)
    state.notes = gone ? rest : [...rest, doc]
  } else if (doc.type === 'lesson') {
    const m = new Map(state.lessons)
    if (gone) m.delete(doc._id); else m.set(doc._id, doc)
    state.lessons = m
  } else if (doc.type === 'inkpage') {
    const m = new Map(state.ink)
    if (gone) m.delete(doc._id); else m.set(doc._id, doc)
    state.ink = m
  } else if (doc.type === 'mark') {
    const m = new Map(state.marks)
    if (gone) m.delete(doc._id); else m.set(doc._id, doc)
    state.marks = m
  } else if (doc.type === 'mem') {
    const rest = state.mems.filter(m => m._id !== doc._id)
    state.mems = gone ? rest : [...rest, doc]
  } else if (doc.type === 'mempass') {
    const rest = state.passages.filter(m => m._id !== doc._id)
    state.passages = gone ? rest : [...rest, doc]
  } else if (doc.type === 'daily') {
    state.daily = gone ? null : doc
  } else if (doc.type === 'planprog') {
    const p = { ...state.progress }
    if (gone) delete p[doc.year]; else p[doc.year] = doc
    state.progress = p
  } else if (doc.type === 'read') {
    const m = new Map(state.read)
    if (gone || !doc.dates.length) m.delete(doc.key); else m.set(doc.key, doc)
    state.read = m
  } else if (doc.type === 'categories') {
    state.categories = gone ? [] : doc.items
  }
}

async function migrateLegacy(docs: Doc[]) {
  const legacy = docs.filter((d): d is LegacyHighlight => d.type === 'highlight')
  for (const h of legacy) {
    try {
      if (!h.deleted) {
        await db.put({
          _id: `mark:hl-${h.verse}`, type: 'mark', src: { kind: 'bible', tr: 'BSB', s: h.verse, e: h.verse, so: 0, eo: -1 },
          quote: '', color: h.color, links: [], createdAt: now(), updatedAt: now(),
        }).catch(() => {})
      }
      await db.remove(h._id, h._rev!)
    } catch { /* another device migrated it */ }
  }
}

export async function initStore() {
  const all = await db.allDocs({ include_docs: true })
  const docs = all.rows.map(r => r.doc as Doc).filter(Boolean)
  for (const d of docs) absorb(d)
  state.ready = true
  emit()
  db.changes({ since: 'now', live: true, include_docs: true }).on('change', ch => {
    if (ch.doc && (ch.doc as Doc).type !== 'timelog') { absorb(ch.doc as Doc); emit() }
  })
  migrateLegacy(docs)
}

const now = () => new Date().toISOString()
const newId = (p: string) => `${p}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
async function putFresh<T extends { _id: string; _rev?: string }>(doc: T): Promise<T> {
  try { const cur = await db.get(doc._id); doc = { ...doc, _rev: cur._rev } } catch { /* new */ }
  const r = await db.put(doc as unknown as Doc)
  return { ...doc, _rev: r.rev }
}

/** Save any of your documents and update the in-memory store straight away. */
export async function saveDoc<T extends Doc>(doc: T): Promise<T> {
  const saved = await putFresh({ ...doc, updatedAt: now() })
  absorb(saved); emit()
  return saved
}
export { newId }

// ---- highlights (marks) -------------------------------------------------------------------
/** Verses a highlight covers: its own verses for Scripture, its links for everything else. */
export function markRanges(m: Mark): Range[] {
  return m.src.kind === 'bible' ? [{ s: m.src.s, e: m.src.e }, ...m.links] : m.links
}
export function marksInChapter(b: number, c: number): Mark[] {
  const lo = b * 1_000_000 + c * 1000, hi = lo + 999
  return [...state.marks.values()].filter(m => m.src.kind === 'bible' && m.src.s <= hi && m.src.e >= lo)
}
export function marksForDoc(doc: string): Mark[] {
  return [...state.marks.values()].filter(m => m.src.kind === 'text' && m.src.doc === doc)
}
/** Highlights touching one verse: Scripture highlights on it, and sermon/Treasury highlights linked to it. */
export function marksForVerse(v: number): Mark[] {
  return [...state.marks.values()].filter(m => markRanges(m).some(r => r.s <= v && v <= r.e))
}
export async function saveMark(m: Partial<Mark> & { src: Mark['src']; quote: string }): Promise<Mark> {
  const doc: Mark = { type: 'mark', color: null, links: [], createdAt: now(), ...m, _id: m._id ?? newId('mark'), updatedAt: now() } as Mark
  const saved = await putFresh(doc)
  absorb(saved); emit()
  return saved
}
export async function deleteMark(m: Mark) {
  await putFresh({ ...m, deleted: true, updatedAt: now() })
  // Notes keep their text; they just lose this anchor.
  for (const n of state.notes.filter(n => n.anchors?.includes(m._id))) {
    await saveNote({ ...n, anchors: n.anchors!.filter(a => a !== m._id) })
  }
}
/** Whole-verse colour from the study panel, for one verse or a run of verses. */
export function wholeRangeMark(s: number, e: number): Mark | undefined {
  return [...state.marks.values()].find(m => m.src.kind === 'bible' && m.src.s === s && m.src.e === e && m.src.so === 0 && m.src.eo === -1)
}
export const wholeVerseMark = (v: number) => wholeRangeMark(v, v)
export async function setRangeColor(s: number, e: number, color: HighlightColor | null, tr: string) {
  const m = wholeRangeMark(s, e)
  if (!color) {
    if (!m) return
    if (state.notes.some(n => n.anchors?.includes(m._id))) await saveMark({ ...m, color: null })
    else await deleteMark(m)
    return
  }
  await saveMark(m ? { ...m, color } : { src: { kind: 'bible', tr, s, e, so: 0, eo: -1 }, quote: '', color })
}
export const setVerseColor = (v: number, color: HighlightColor | null, tr: string) => setRangeColor(v, v, color, tr)

// ---- notes --------------------------------------------------------------------------------
export function notesFor(verse: number): Note[] {
  return state.notes
    .filter(n => n.refs.some(r => r.s <= verse && verse <= r.e))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export function notesInRange(s: number, e: number): Note[] {
  return state.notes.filter(n => n.refs.some(r => r.s <= e && r.e >= s))
}
export function notesForMark(id: string): Note[] {
  return state.notes.filter(n => n.anchors?.includes(id))
}
/** Every verse range a note touches: its Scripture highlights, highlight links and references typed in it. */
export function noteRanges(anchors: string[], typed: Range[]): NoteRef[] {
  const out: NoteRef[] = []
  const seen = new Set<string>()
  const add = (r: Range) => { const k = `${r.s}-${r.e}`; if (!seen.has(k)) { seen.add(k); out.push({ ...r, confirmed: true }) } }
  for (const id of anchors) { const m = state.marks.get(id); if (m) markRanges(m).forEach(add) }
  typed.forEach(add)
  return out
}
export async function saveNote(n: Partial<Note> & { refs: NoteRef[]; body: string }): Promise<Note> {
  const doc: Note = {
    type: 'note', kind: 'typed', title: '', tags: [], anchors: [], category: null, createdAt: now(),
    ...n, _id: n._id ?? newId('note'), updatedAt: now(),
  } as Note
  const saved = await putFresh(doc)
  absorb(saved); emit()
  return saved
}
export async function deleteNote(n: Note) {
  absorb(await putFresh({ ...n, deleted: true, updatedAt: now() })); emit()
  if (n.kind === 'ink') for (const id of n.pages ?? []) { const p = state.ink.get(id); if (p) absorb(await putFresh({ ...p, deleted: true, updatedAt: now() })) }
  // A colourless highlight only existed to hold this note; remove it too.
  for (const id of n.anchors ?? []) {
    const m = state.marks.get(id)
    if (m && !m.color && !m.links.length && !state.notes.some(o => o._id !== n._id && o.anchors?.includes(id))) await deleteMark(m)
  }
}

// ---- handwritten notes: scanned pages as attachments ---------------------------------------
/** Save a handwritten note. `pages` lists existing page names (kept) and new JPEGs (added), in order. */
export async function saveScanNote(o: { id?: string; title: string; category: string | null; refs: NoteRef[]; pages: (string | Blob)[] }): Promise<Note> {
  const id = o.id ?? newId('note')
  let cur: (Note & { _rev?: string }) | null = null
  try { cur = (await db.get(id)) as Note } catch { /* new */ }
  const att: Record<string, unknown> = {}
  const names: string[] = []
  o.pages.forEach((p, i) => {
    if (typeof p === 'string') {
      const old = cur?._attachments?.[p]
      if (old) { att[p] = old; names.push(p) }
    } else {
      const name = `page-${Date.now().toString(36)}-${i}.jpg`
      att[name] = { content_type: p.type || 'image/jpeg', data: p }
      names.push(name)
    }
  })
  const doc = {
    ...(cur ?? { type: 'note', kind: 'handwritten', body: '', anchors: [], tags: [], createdAt: now() }),
    _id: id, ...(cur?._rev ? { _rev: cur._rev } : {}),
    kind: 'handwritten', title: o.title, category: o.category, refs: o.refs, pages: names,
    _attachments: att, updatedAt: now(),
  }
  await db.put(doc as unknown as Doc)
  const saved = (await db.get(id)) as Note   // attachments come back as small stubs
  absorb(saved); emit()
  return saved
}
// ---- lessons -------------------------------------------------------------------------------
export async function saveLesson(l: Lesson): Promise<Lesson> {
  const saved = await putFresh({ ...l, updatedAt: now() })
  absorb(saved); emit()
  return saved
}
export async function deleteLesson(l: Lesson) { absorb(await putFresh({ ...l, deleted: true, updatedAt: now() })); emit() }
export const newLessonId = () => newId('lesson')

// ---- ink notes: vector handwriting ---------------------------------------------------------
export const inkPagesOf = (n: Note): InkPageDoc[] => (n.pages ?? []).map(id => state.ink.get(id)).filter((p): p is InkPageDoc => !!p)
type NewInkPage = Pick<InkPageDoc, 'w' | 'h' | 'paper' | 'trace' | 'strokes'>
/** A new ink note with its pages. */
export async function createInkNote(o: { title: string; category: string | null; refs: NoteRef[]; pages: NewInkPage[] }): Promise<Note> {
  const noteId = newId('note')
  const ids: string[] = []
  for (const pg of o.pages) {
    const doc = { ...pg, _id: newId('inkpage'), type: 'inkpage', note: noteId, createdAt: now(), updatedAt: now() } as InkPageDoc
    absorb(await putFresh(doc)); ids.push(doc._id)
  }
  const note = await putFresh({
    _id: noteId, type: 'note', kind: 'ink', title: o.title, body: '', anchors: [], tags: [], category: o.category, refs: o.refs,
    pages: ids, createdAt: now(), updatedAt: now(),
  } as Note)
  absorb(note); emit()
  return note
}
/** Add pages to an ink note (at the end, or after page `after`). */
export async function addInkPages(n: Note, pages: NewInkPage[], after?: number): Promise<string[]> {
  const ids: string[] = []
  for (const pg of pages) {
    const doc = { ...pg, _id: newId('inkpage'), type: 'inkpage', note: n._id, createdAt: now(), updatedAt: now() } as InkPageDoc
    absorb(await putFresh(doc)); ids.push(doc._id)
  }
  const cur = state.notes.find(x => x._id === n._id) ?? n
  const list = [...(cur.pages ?? [])]
  list.splice(after === undefined ? list.length : after + 1, 0, ...ids)
  absorb(await putFresh({ ...cur, pages: list, updatedAt: now() })); emit()
  return ids
}
export async function saveInkPage(p: InkPageDoc) {
  const saved = await putFresh({ ...p, updatedAt: now() })
  absorb(saved); emit()
  return saved
}
export async function removeInkPage(n: Note, pageId: string) {
  const p = state.ink.get(pageId)
  if (p) absorb(await putFresh({ ...p, deleted: true, updatedAt: now() }))
  const cur = state.notes.find(x => x._id === n._id) ?? n
  absorb(await putFresh({ ...cur, pages: (cur.pages ?? []).filter(id => id !== pageId), updatedAt: now() })); emit()
}
export async function saveNoteDetails(n: Note, d: { title: string; category: string | null; refs: NoteRef[] }) {
  const cur = state.notes.find(x => x._id === n._id) ?? n
  absorb(await putFresh({ ...cur, ...d, updatedAt: now() })); emit()
}

const pageUrls = new Map<string, Promise<string>>()
/** A local address for one scanned page, for <img src>. */
export function scanPageUrl(n: Note, page: string): Promise<string> {
  const key = `${n._id}/${page}/${n._attachments?.[page]?.digest ?? ''}`
  if (!pageUrls.has(key)) {
    pageUrls.set(key, db.getAttachment(n._id, page).then(b => URL.createObjectURL(b as Blob)))
    pageUrls.get(key)!.catch(() => pageUrls.delete(key))
  }
  return pageUrls.get(key)!
}
export async function scanPageBlob(n: Note, page: string): Promise<Blob> {
  return (await db.getAttachment(n._id, page)) as Blob
}

// ---- categories ---------------------------------------------------------------------------
async function saveCategories(items: Category[]) {
  const saved = await putFresh({ _id: 'categories', type: 'categories', items } as Categories)
  absorb(saved); emit()
}
export async function addCategory(name: string, parent: string | null = null) {
  const id = Math.random().toString(36).slice(2, 10)
  await saveCategories([...state.categories, { id, name: name.trim(), parent }])
  return id
}
export async function renameCategory(id: string, name: string) {
  await saveCategories(state.categories.map(c => (c.id === id ? { ...c, name: name.trim() } : c)))
}
export async function deleteCategory(id: string) {
  const ids = new Set([id, ...state.categories.filter(c => c.parent === id).map(c => c.id)])
  await saveCategories(state.categories.filter(c => !ids.has(c.id)))
  for (const n of state.notes.filter(n => n.category && ids.has(n.category))) await saveNote({ ...n, category: null })
}
export function categoryPath(id?: string | null): string {
  const c = state.categories.find(x => x.id === id)
  if (!c) return ''
  const p = c.parent ? state.categories.find(x => x.id === c.parent) : null
  return p ? `${p.name} / ${c.name}` : c.name
}

// ---- last place ---------------------------------------------------------------------------
export async function savePlace(p: Omit<Place, '_id' | 'type' | 'updatedAt' | '_rev'>) {
  let rev: string | undefined
  try { rev = (await db.get('session:last'))._rev } catch { /* first time */ }
  try { await db.put({ ...p, _id: 'session:last', _rev: rev, type: 'session', updatedAt: now() }) } catch { /* conflict: ignore */ }
}
export async function loadPlace(): Promise<Place | null> {
  try { return (await db.get('session:last')) as Place } catch { return null }
}

// ---- sync with CouchDB on your PC ---------------------------------------------------------
export type SyncSettings = { url: string; user: string; password: string; enabled: boolean }
export type SyncStatus = 'off' | 'connecting' | 'synced' | 'syncing' | 'offline' | 'error'
const SYNC_KEY = 'margin.sync'

export function loadSyncSettings(): SyncSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY) ?? 'null')
    if (s) return s
  } catch { /* ignore */ }
  return { url: `${location.origin}/db/margin`, user: '', password: '', enabled: false }
}
export function saveSyncSettings(s: SyncSettings) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

let syncHandle: PouchDB.Replication.Sync<Doc> | null = null
let syncStatus: SyncStatus = 'off'
let syncError = ''
let lastSynced: string | null = null
const syncListeners = new Set<() => void>()
export const subscribeSync = (fn: () => void) => (syncListeners.add(fn), () => { syncListeners.delete(fn) })
export const getSync = () => ({ status: syncStatus, error: syncError, lastSynced })
function setSync(s: SyncStatus, err = '') {
  syncStatus = s; syncError = err
  if (s === 'synced') lastSynced = now()
  syncListeners.forEach(f => f())
}

export function startSync(s = loadSyncSettings()) {
  syncHandle?.cancel(); syncHandle = null
  if (!s.enabled || !s.url) return setSync('off')
  setSync('connecting')
  const remote = new PouchDB<Doc>(s.url, {
    skip_setup: true,
    fetch: (url, opts) => {
      const headers = new Headers(opts?.headers)
      if (s.user) headers.set('Authorization', 'Basic ' + btoa(`${s.user}:${s.password}`))
      return PouchDB.fetch(url, { ...opts, headers })
    },
  })
  syncHandle = db.sync(remote, { live: true, retry: true })
    .on('active', () => setSync('syncing'))
    .on('paused', err => (err ? setSync('offline', String((err as Error).message ?? err)) : setSync('synced')))
    .on('denied', err => setSync('error', `The server refused a change: ${String((err as Error).message ?? err)}`))
    .on('error', err => {
      const e = err as { status?: number; message?: string }
      setSync('error', e.status === 401 ? 'Wrong username or password.' : e.message ?? 'Sync failed.')
    })
}

/** Check the server is reachable and the login works, without starting sync. */
export async function testSync(s: SyncSettings): Promise<string | null> {
  try {
    const r = await fetch(s.url, {
      headers: s.user ? { Authorization: 'Basic ' + btoa(`${s.user}:${s.password}`) } : {},
    })
    if (r.status === 401) return 'Wrong username or password.'
    if (r.status === 404) return 'The server answered, but the "margin" database doesn\'t exist yet. Run the setup script on your PC.'
    if (!r.ok) return `The server answered with an error (${r.status}).`
    return null
  } catch {
    return 'Can\'t reach your PC. Check that it\'s on and Tailscale is connected on this device.'
  }
}

// ---- export everything (a manual backup from any device) ----------------------------------
export async function exportAll(): Promise<Blob> {
  const all = await db.allDocs({ include_docs: true, attachments: true })   // scanned pages included (base64)
  const docs = all.rows.map(r => r.doc)
  return new Blob([JSON.stringify({ exportedAt: now(), docs }, null, 2)], { type: 'application/json' })
}
