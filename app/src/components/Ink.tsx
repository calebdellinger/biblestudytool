// Vector handwriting on an endless canvas, with shapes, arrows that stay attached, text boxes, verse cards and a lasso.
// A note's pages (inkpage: docs) are stacked edge to edge into one continuous sheet that goes on forever downwards
// and sideways. Each stroke or item is stored on the band (page doc) where it starts, so a change only re-syncs that
// band. Scanned paper notes are bands with a fixed traced layer you can write around and on top of.
// Two fingers pan and pinch-zoom; one finger draws until an Apple Pencil is used, then fingers move the canvas.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatRef, splitVid, verseText, type Translation } from '../lib/bible'
import {
  addInkPages, categoryPath, deleteNote, getState, inkPagesOf, removeInkPage, saveInkPage, saveNoteDetails,
  type InkPageDoc, type Note, type NoteRef,
} from '../lib/db'
import { INK_COLORS, PAGE_W, strokeHit, strokePath, type InkStroke } from '../lib/ink'
import { verseIds } from '../lib/memory'
import { findRefs, parseQuery, type Range } from '../lib/refs'
import { go, usePrefs, useStore } from '../lib/hooks'
import { closeSheet } from '../lib/ui'
import { CategoryPicker } from './Notes'
import { PaperScanFlow } from './Scan'
import { InkWheel, toolLabel, type WheelTool } from './InkWheel'
import { IconClose, IconTrash } from './Icons'
import {
  canAnchor, handlesOf, hitItem, insideItem, isLineLike, itemBox, ItemShape, normalise, pointInPolygon, resizeItem,
  resolveLine, VERSE, VerseDefs, xfItem, xfPoint, type Handle, type InkItem, type ShapeKind, type Xf,
} from './InkItems'

export const PAGE_H = 1294   // height of a new blank band (US Letter proportions)
const MIN_S = 0.12, MAX_S = 8
const MAX_CARD_VERSES = 12

/* ---------- shared drawing pieces ---------- */
const pathCache = new WeakMap<object, string>()
const pathOf = (s: InkStroke) => { let d = pathCache.get(s); if (d === undefined) { d = strokePath(s); pathCache.set(s, d) } return d }
const boxCache = new WeakMap<object, [number, number, number, number]>()
function strokeBox(s: InkStroke): [number, number, number, number] {
  let b = boxCache.get(s)
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < s.p.length; i += 3) { x0 = Math.min(x0, s.p[i]); x1 = Math.max(x1, s.p[i]); y0 = Math.min(y0, s.p[i + 1]); y1 = Math.max(y1, s.p[i + 1]) }
    b = [x0, y0, x1, y1]; boxCache.set(s, b)
  }
  return b
}
const isScan = (p: Pick<InkPageDoc, 'trace'>) => p.trace.length > 0
type Content = { strokes: InkStroke[]; items: InkItem[] }
const contentOfDoc = (p: InkPageDoc): Content => ({ strokes: p.strokes, items: p.items ?? [] })

function Strokes({ strokes, hide }: { strokes: InkStroke[]; hide?: Set<InkStroke> }) {
  const list = hide?.size ? strokes.filter(s => !hide.has(s)) : strokes
  return (
    <>
      {list.filter(s => s.hl).map((s, i) => <path key={`h${i}`} className="ink-hl" d={pathOf(s)} fill={INK_COLORS[s.c]} />)}
      {list.filter(s => !s.hl).map((s, i) => <path key={`s${i}`} d={pathOf(s)} fill={INK_COLORS[s.c]} />)}
    </>
  )
}
function Items({ items, hide }: { items: InkItem[]; hide?: Set<string> }) {
  // verse cards sit underneath ink and shapes, so arrows and handwriting show on top of them
  const list = items.filter(it => !hide?.has(it.id))
  return <>{[...list.filter(it => it.t === 'verse'), ...list.filter(it => it.t !== 'verse')].map(it => <ItemShape key={it.id} it={it} />)}</>
}
function Trace({ page }: { page: Pick<InkPageDoc, 'trace'> }) {
  return <g fillRule="nonzero">{page.trace.map((l, i) => <path key={i} d={l.d} fill={INK_COLORS[l.k]} />)}</g>
}

/** One page on its own (scan preview while scanning). */
export function InkPageSvg({ page, strokes, className }: { page: Pick<InkPageDoc, 'w' | 'h' | 'paper' | 'trace'>; strokes: InkStroke[]; className?: string }) {
  return (
    <svg className={`ink-page ${className ?? ''}`} viewBox={`0 0 ${page.w} ${page.h}`} preserveAspectRatio="xMidYMin meet">
      <rect className="ink-sheet" x={0} y={0} width={page.w} height={page.h} />
      <Trace page={page} />
      <Strokes strokes={strokes} />
    </svg>
  )
}

/** Where everything on the canvas is: each band's top, the total height, and the extent of the writing. */
function layout(pages: InkPageDoc[], work?: Record<string, Content>) {
  const tops: number[] = []
  let y = 0, x0 = 0, x1 = PAGE_W, y1 = 0
  for (const p of pages) {
    tops.push(y)
    const c = work?.[p._id] ?? contentOfDoc(p)
    for (const s of c.strokes) { const b = strokeBox(s); x0 = Math.min(x0, b[0] - 20); x1 = Math.max(x1, b[2] + 20); y1 = Math.max(y1, y + b[3] + 20) }
    for (const it of c.items) { const b = itemBox(it); x0 = Math.min(x0, b[0] - 20); x1 = Math.max(x1, b[2] + 20); y1 = Math.max(y1, y + b[3] + 40) }
    if (isScan(p)) y1 = Math.max(y1, y + p.h)
    y += p.h
  }
  return { tops, height: y, x0, x1, inkBottom: y1 }
}
/** Every item by id with its band top, and each band's items with attached arrows pointed at their targets. */
function resolveAll(pages: InkPageDoc[], tops: number[], contentOf: (p: InkPageDoc) => Content) {
  const byId = new Map<string, { it: InkItem; top: number; page: string }>()
  pages.forEach((p, i) => { for (const it of contentOf(p).items) byId.set(it.id, { it, top: tops[i], page: p._id }) })
  const find = (id: string) => byId.get(id)
  const items = new Map<string, InkItem[]>()
  pages.forEach((p, i) => items.set(p._id, contentOf(p).items.map(it => resolveLine(it, tops[i], find))))
  return { byId, find, items }
}

/** The whole note as one picture (sheet view, thumbnails). Crops empty space at the bottom. */
export function InkCanvasPreview({ note, maxHeight, className }: { note: Note; maxHeight?: number; className?: string }) {
  useStore()
  const pages = inkPagesOf(note)
  const L = layout(pages)
  const R = resolveAll(pages, L.tops, contentOfDoc)
  const bottom = Math.max(400, Math.min(L.height, L.inkBottom + 60))
  const h = maxHeight ? Math.min(bottom, maxHeight) : bottom
  const w = L.x1 - L.x0
  return (
    <svg className={`ink-page ${className ?? ''}`} viewBox={`${L.x0} 0 ${w} ${h}`} preserveAspectRatio="xMidYMin meet">
      <VerseDefs />
      <rect className="ink-sheet" x={L.x0} y={0} width={w} height={h} />
      {pages.map((p, i) => (
        <g key={p._id} transform={`translate(0 ${L.tops[i]})`}>
          {isScan(p) && <ScanBack page={p} />}
          <Trace page={p} />
          <Items items={R.items.get(p._id) ?? []} />
          <Strokes strokes={p.strokes} />
        </g>
      ))}
    </svg>
  )
}
export function InkThumb({ note }: { note: Note }) {
  return <span className="ink-thumb"><InkCanvasPreview note={note} maxHeight={1100} /></span>
}
/** A scanned page sits on the sheet like a card, so its edges are visible. */
function ScanBack({ page }: { page: InkPageDoc }) {
  return <rect className="ink-scanback" x={0} y={0} width={page.w} height={page.h} rx={6} />
}

/* ---------- the canvas editor ---------- */
type Tool = 'pen' | 'hl' | 'eraser' | 'select' | 'lasso' | 'text' | ShapeKind
type Color = InkStroke['c']
type Change = { page: string; before: Content; after: Content }[]
type View = { s: number; tx: number; ty: number }
type Sel = { page: string; id: string }
type Lasso = { members: { page: string; strokes: Set<InkStroke>; items: Set<string> }[]; box: [number, number, number, number] }
const FINGER_KEY = 'margin.ink.finger', PEN_KEY = 'margin.ink.penSeen'
const lsGet = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const newItemId = () => Math.random().toString(36).slice(2, 10)
const SHAPES: ShapeKind[] = ['rect', 'ellipse', 'tri', 'line', 'arrow']
const isShape = (t: Tool): t is ShapeKind => (SHAPES as string[]).includes(t)
const COLORS: Color[] = ['ink', 'blue', 'red', 'green']

const Band = memo(function Band({ page, top, strokes, items, hideItems, hideStrokes }: {
  page: InkPageDoc; top: number; strokes: InkStroke[]; items: InkItem[]; hideItems?: Set<string>; hideStrokes?: Set<InkStroke>
}) {
  return (
    <g transform={`translate(0 ${top})`}>
      {isScan(page) && <ScanBack page={page} />}
      <Trace page={page} />
      <Items items={items} hide={hideItems} />
      <Strokes strokes={strokes} hide={hideStrokes} />
    </g>
  )
})

export function InkCanvas({ note, onClose, readOnly = false }: { note: Note; onClose: () => void; readOnly?: boolean }) {
  const store = useStore()
  const prefs = usePrefs()
  const live = store.notes.find(n => n._id === note._id) ?? note
  const pages = inkPagesOf(live)
  const [tool, setToolRaw] = useState<Tool>('pen')
  const [color, setColor] = useState<Color>('ink')
  const [width, setWidth] = useState(2)
  const [verseOpen, setVerseOpen] = useState(false)
  const [writing, setWriting] = useState(!readOnly)
  const [finger, setFingerRaw] = useState<'auto' | 'draw' | 'scroll'>(() => (lsGet(FINGER_KEY) as 'auto' | 'draw' | 'scroll') || 'auto')
  const [penSeen, setPenSeen] = useState(() => lsGet(PEN_KEY) === '1')
  const fingerDraws = writing && (finger === 'draw' || (finger === 'auto' && !penSeen))
  const setFinger = (f: typeof finger) => { setFingerRaw(f); lsSet(FINGER_KEY, f) }
  const [work, setWork] = useState<Record<string, Content>>({})
  const workRef = useRef(work); workRef.current = work
  const contentOf = (p: InkPageDoc): Content => work[p._id] ?? contentOfDoc(p)
  const [undo, setUndo] = useState<Change[]>([])
  const [redo, setRedo] = useState<Change[]>([])
  const timers = useRef<Record<string, number>>({})
  const [scanning, setScanning] = useState(false)
  const [sel, setSel] = useState<Sel | null>(null)
  const [editing, setEditing] = useState<Sel | null>(null)   // a text box being typed into
  const [lasso, setLasso] = useState<Lasso | null>(null)
  const L = layout(pages, work)
  const R = resolveAll(pages, L.tops, contentOf)
  const RRef = useRef(R); RRef.current = R
  const [hint, setHint] = useState<string | null>(null)
  const hintTimer = useRef(0)
  const say = (m: string) => { setHint(m); clearTimeout(hintTimer.current); hintTimer.current = window.setTimeout(() => setHint(null), 2600) }
  const HINTS: Partial<Record<Tool, string>> = {
    eraser: 'Eraser: rubs out pen strokes. Shapes, text and cards: Select, then the bin.',
    lasso: 'Lasso: draw a loop around writing or shapes.', text: 'Text: tap where it should go.',
    arrow: 'Arrow: start and end on shapes, text or cards to connect them.', line: 'Line: start and end on shapes to connect them.',
    rect: 'Drag to draw, or tap to drop one.', ellipse: 'Drag to draw, or tap to drop one.', tri: 'Drag to draw, or tap to drop one.',
  }
  const setTool = (t: Tool) => { setToolRaw(t); setSel(null); setLasso(null); setVerseOpen(false); if (HINTS[t]) say(HINTS[t]!) }
  const [menu, setMenu] = useState(false)

  /* view: s = screen px per canvas unit; tx/ty = where canvas (0,0) sits on screen */
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setViewRaw] = useState<View>({ s: 0.4, tx: 0, ty: 16 })
  const viewRef = useRef(view); viewRef.current = view
  const layoutRef = useRef(L); layoutRef.current = L
  const fitted = useRef(false)
  const clampView = useCallback((v: View): View => {
    const s = Math.min(MAX_S, Math.max(MIN_S, v.s))
    const w = box.current?.clientWidth ?? 0, h = box.current?.clientHeight ?? 0
    const Lc = layoutRef.current
    const minX = Lc.x0 - 2000, maxX = Lc.x1 + 2000, minY = -300, maxY = Math.max(Lc.height, Lc.inkBottom) + 3000
    const tx = Math.min(-minX * s + w * 0.5, Math.max(w * 0.5 - maxX * s, v.tx))
    const ty = Math.min(-minY * s, Math.max(h * 0.6 - maxY * s, v.ty))
    return { s, tx, ty }
  }, [])
  const setView = useCallback((v: View) => setViewRaw(clampView(v)), [clampView])
  const fit = useCallback(() => {
    const w = box.current?.clientWidth ?? 800
    const s = Math.min(1.2, (w - 24) / PAGE_W)
    setViewRaw({ s, tx: (w - PAGE_W * s) / 2, ty: 16 })
  }, [])
  useEffect(() => {
    const el = box.current; if (!el) return
    const ro = new ResizeObserver(() => { setSize({ w: el.clientWidth, h: el.clientHeight }); if (!fitted.current) { fitted.current = true; fit() } })
    ro.observe(el)
    const stop = (e: Event) => e.preventDefault()
    el.addEventListener('gesturestart', stop); el.addEventListener('gesturechange', stop)
    const wheelStop = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', wheelStop, { passive: false })
    return () => { ro.disconnect(); el.removeEventListener('gesturestart', stop); el.removeEventListener('gesturechange', stop); el.removeEventListener('wheel', wheelStop) }
  }, [fit])

  /* saving and undo */
  const persist = useCallback((pageId: string, c: Content) => {
    clearTimeout(timers.current[pageId])
    timers.current[pageId] = window.setTimeout(() => {
      delete timers.current[pageId]
      const p = getState().ink.get(pageId)
      if (p) saveInkPage({ ...p, strokes: c.strokes, items: c.items })
    }, 700)
  }, [])
  const apply = (changes: Change, dir: 'after' | 'before', record = true) => {
    setWork(w => { const n = { ...w }; for (const c of changes) n[c.page] = c[dir]; return n })
    workRef.current = { ...workRef.current, ...Object.fromEntries(changes.map(c => [c.page, c[dir]])) }
    for (const c of changes) persist(c.page, c[dir])
    if (record) { setUndo(u => [...u.slice(-99), changes]); setRedo([]) }
  }
  const current = (pageId: string): Content => workRef.current[pageId] ?? (() => { const p = getState().ink.get(pageId); return p ? contentOfDoc(p) : { strokes: [], items: [] } })()
  const change = (pageId: string, f: (c: Content) => Content) => { const before = current(pageId); apply([{ page: pageId, before, after: f(before) }], 'after') }
  /** Several bands at once, as one undo step. */
  const changeMany = (f: (pageId: string, c: Content) => Content | null) => {
    const out: Change = []
    for (const p of pages) { const before = current(p._id), after = f(p._id, before); if (after && after !== before) out.push({ page: p._id, before, after }) }
    if (out.length) apply(out, 'after')
  }
  function doUndo() { const c = undo[undo.length - 1]; if (!c) return; setSel(null); setLasso(null); setUndo(u => u.slice(0, -1)); setRedo(r => [...r, c]); apply(c, 'before', false) }
  function doRedo() { const c = redo[redo.length - 1]; if (!c) return; setSel(null); setLasso(null); setRedo(r => r.slice(0, -1)); setUndo(u => [...u, c]); apply(c, 'after', false) }
  function close() {
    for (const [id, t] of Object.entries(timers.current)) {
      clearTimeout(t)
      const p = getState().ink.get(id), c = workRef.current[id]
      if (p && c) saveInkPage({ ...p, strokes: c.strokes, items: c.items })
    }
    onClose()
  }

  /* where things are */
  const topOf = (pageId: string) => { const i = pages.findIndex(p => p._id === pageId); return i >= 0 ? layoutRef.current.tops[i] : 0 }
  const rawItem = (s: Sel | null) => (s ? current(s.page).items.find(it => it.id === s.id) ?? null : null)
  /** The item as drawn (attached arrows pointed at their targets). */
  const shownItem = (s: Sel | null) => (s ? RRef.current.items.get(s.page)?.find(it => it.id === s.id) ?? rawItem(s) : null)
  async function bandAt(y: number): Promise<{ page: InkPageDoc; top: number }> {
    const Lc = layoutRef.current
    let list = inkPagesOf(getState().notes.find(n => n._id === live._id) ?? live)
    if (y >= Lc.height) {
      const n = Math.floor((y - Lc.height) / PAGE_H) + 1
      await addInkPages(live, Array.from({ length: n }, () => ({ w: PAGE_W, h: PAGE_H, paper: 'plain' as const, trace: [], strokes: [] })))
      list = inkPagesOf(getState().notes.find(n2 => n2._id === live._id)!)
    }
    let top = 0
    for (let i = 0; i < list.length; i++) { if (y < top + list[i].h || i === list.length - 1) return { page: list[i], top: y < 0 && i === 0 ? 0 : top }; top += list[i].h }
    return { page: list[0], top: 0 }
  }
  /** Topmost item under a world point (cards are underneath everything else). */
  function itemAt(x: number, y: number): Sel | null {
    const tol = 10 / viewRef.current.s
    let card: Sel | null = null
    for (let i = pages.length - 1; i >= 0; i--) {
      const top = layoutRef.current.tops[i], items = RRef.current.items.get(pages[i]._id) ?? []
      for (let k = items.length - 1; k >= 0; k--) {
        if (!hitItem(items[k], x, y - top, tol)) continue
        if (items[k].t === 'verse') { card ??= { page: pages[i]._id, id: items[k].id }; continue }
        return { page: pages[i]._id, id: items[k].id }
      }
    }
    return card
  }
  /** Something an arrow end dropped at (x, y) should attach to. */
  function anchorAt(x: number, y: number, not?: string): string | undefined {
    let found: string | undefined
    for (const { it, top } of RRef.current.byId.values()) if (it.id !== not && canAnchor(it) && insideItem(it, x, y - top, 6 / viewRef.current.s)) found = it.id
    return found
  }

  /* input */
  type Pt = { x: number; y: number; type: string }
  const pts = useRef(new Map<number, Pt>())
  const gesture = useRef<{ mode: 'pan' | 'pinch'; d0: number; m0: [number, number]; v0: View; p0: [number, number]; tap?: [number, number] } | null>(null)
  type Op =
    | { kind: 'stroke'; id: number; stroke: InkStroke }
    | { kind: 'erase'; id: number; map: Map<string, { before: Content; now: Content }> }
    | { kind: 'shape'; id: number; item: InkItem }
    | { kind: 'move'; id: number; sel: Sel; orig: InkItem; start: [number, number]; item: InkItem; moved: boolean }
    | { kind: 'resize'; id: number; sel: Sel; orig: InkItem; handle: Handle; item: InkItem }
    | { kind: 'loop'; id: number; pts: number[] }
    | { kind: 'tap'; id: number; x: number; y: number; cx: number; cy: number }   // Text tool: decided when the finger lifts
    | { kind: 'lmove'; id: number; start: [number, number]; xf: Xf }
    | { kind: 'lscale'; id: number; xf: Xf }
  const op = useRef<Op | null>(null)
  const [draft, setDraft] = useState<{ stroke?: InkStroke; item?: InkItem; itemPage?: string; erase?: Record<string, Content>; loop?: number[]; xf?: Xf } | null>(null)
  const raf = useRef(0)
  const toWorld = (cx: number, cy: number, pressure = 0.5, type = 'mouse'): [number, number, number] => {
    const r = box.current!.getBoundingClientRect(), v = viewRef.current
    return [Math.round(((cx - r.left - v.tx) / v.s) * 10) / 10, Math.round(((cy - r.top - v.ty) / v.s) * 10) / 10, type === 'pen' ? Math.round((pressure || 0.5) * 100) : 50]
  }
  const local = (r: DOMRect, x: number, y: number): [number, number] => [x - r.left, y - r.top]
  function startPinch() {
    const [a, b] = [...pts.current.values()]
    const r = box.current!.getBoundingClientRect()
    const m: [number, number] = local(r, (a.x + b.x) / 2, (a.y + b.y) / 2)
    gesture.current = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: m, v0: viewRef.current, p0: m }
  }
  function startPan(e: { clientX: number; clientY: number }) {
    const r = box.current!.getBoundingClientRect()
    const p = local(r, e.clientX, e.clientY)
    gesture.current = { mode: 'pan', d0: 1, m0: p, v0: viewRef.current, p0: p, tap: [e.clientX, e.clientY] }
  }
  function cancelOp() { op.current = null; setDraft(null) }

  function eraseAt(o: Extract<Op, { kind: 'erase' }>, x: number, y: number) {
    let changed = false
    pages.forEach((p, i) => {
      const top = layoutRef.current.tops[i]
      if (y < top - 300 || y > top + p.h + 300) return
      const cur = o.map.get(p._id) ?? { before: contentOf(p), now: contentOf(p) }
      const keep = cur.now.strokes.filter(s => !strokeHit(s, x, y - top, 12 / Math.max(0.5, viewRef.current.s)))
      if (keep.length !== cur.now.strokes.length) { cur.now = { ...cur.now, strokes: keep }; o.map.set(p._id, cur); changed = true }
    })
    if (changed) setDraft({ erase: Object.fromEntries([...o.map.entries()].map(([k, v]) => [k, v.now])) })
  }

  /* lasso */
  function lassoSelect(poly: number[]): Lasso | null {
    const members: Lasso['members'] = []
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    pages.forEach((p, i) => {
      const top = layoutRef.current.tops[i], c = contentOf(p)
      const strokes = new Set<InkStroke>(), items = new Set<string>()
      for (const s of c.strokes) {
        let inside = 0
        for (let k = 0; k < s.p.length; k += 3) if (pointInPolygon(s.p[k], s.p[k + 1] + top, poly)) inside++
        if (inside >= (s.p.length / 3) * 0.6) { strokes.add(s); const b = strokeBox(s); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1] + top); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3] + top) }
      }
      for (const it of RRef.current.items.get(p._id) ?? []) {
        const b = itemBox(it)
        if (pointInPolygon((b[0] + b[2]) / 2, (b[1] + b[3]) / 2 + top, poly)) { items.add(it.id); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1] + top); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3] + top) }
      }
      if (strokes.size || items.size) members.push({ page: p._id, strokes, items })
    })
    return members.length ? { members, box: [x0 - 8, y0 - 8, x1 + 8, y1 + 8] } : null
  }
  /** Move/scale everything in the lasso; strokes and items stay on their own bands. */
  function commitLasso(t: Xf) {
    if (!lasso) return
    const next: Lasso['members'] = []
    changeMany((pageId, c) => {
      const m = lasso.members.find(x => x.page === pageId)
      if (!m) return null
      const top = topOf(pageId)
      const strokes = new Set<InkStroke>()
      const sOut = c.strokes.map(s => {
        if (!m.strokes.has(s)) return s
        const p = s.p.slice()
        for (let k = 0; k < p.length; k += 3) { const [x, y] = xfPoint(t, p[k], p[k + 1] + top); p[k] = Math.round(x * 10) / 10; p[k + 1] = Math.round((y - top) * 10) / 10 }
        const ns = { ...s, p }; strokes.add(ns); return ns
      })
      const iOut = c.items.map(it => (m.items.has(it.id) ? xfItem(it, t, top) : it))
      next.push({ page: pageId, strokes, items: m.items })
      return { strokes: sOut, items: iOut }
    })
    const [a0, b0] = xfPoint(t, lasso.box[0], lasso.box[1]), [a1, b1] = xfPoint(t, lasso.box[2], lasso.box[3])
    setLasso({ members: next, box: [a0, b0, a1, b1] })
  }
  function lassoColour(c: Color) {
    if (!lasso) return
    const next: Lasso['members'] = []
    changeMany((pageId, cur) => {
      const m = lasso.members.find(x => x.page === pageId); if (!m) return null
      const strokes = new Set<InkStroke>()
      const sOut = cur.strokes.map(s => { if (!m.strokes.has(s) || s.hl) return s; const ns = { ...s, c }; strokes.add(ns); return ns })
      next.push({ page: pageId, strokes, items: m.items })
      return { strokes: sOut, items: cur.items.map(it => (m.items.has(it.id) ? { ...it, c } : it)) }
    })
    setLasso(l => (l ? { ...l, members: next } : l))
  }
  /** Remove items (and strokes); arrows attached to removed items keep their last position. */
  function removeAll(strokesByPage: Map<string, Set<InkStroke>>, ids: Set<string>) {
    const find = RRef.current.find
    changeMany((pageId, c) => {
      const drop = strokesByPage.get(pageId)
      const touched = (drop?.size ?? 0) > 0 || c.items.some(it => ids.has(it.id) || (it.from && ids.has(it.from)) || (it.to && ids.has(it.to)))
      if (!touched) return null
      const top = topOf(pageId)
      return {
        strokes: drop ? c.strokes.filter(s => !drop.has(s)) : c.strokes,
        items: c.items.filter(it => !ids.has(it.id)).map(it => {
          if (!(it.from && ids.has(it.from)) && !(it.to && ids.has(it.to))) return it
          const r = resolveLine(it, top, find)
          return { ...r, from: it.from && ids.has(it.from) ? undefined : it.from, to: it.to && ids.has(it.to) ? undefined : it.to }
        }),
      }
    })
  }
  function lassoDelete() {
    if (!lasso) return
    removeAll(new Map(lasso.members.map(m => [m.page, m.strokes])), new Set(lasso.members.flatMap(m => [...m.items])))
    setLasso(null)
  }

  function down(e: React.PointerEvent) {
    box.current!.setPointerCapture(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    if (editing) {
      // while typing, the page can still be moved and zoomed; a tap elsewhere ends the typing (the box loses focus)
      if (pts.current.size >= 2) startPinch(); else startPan(e)
      return
    }
    if (e.pointerType === 'pen' && !penSeen) { setPenSeen(true); lsSet(PEN_KEY, '1') }
    const touches = [...pts.current.values()].filter(p => p.type === 'touch')
    if (e.pointerType === 'touch' && touches.length >= 2) {
      if (op.current && pts.current.get(op.current.id)?.type === 'touch') cancelOp()
      startPinch(); return
    }
    const acts = writing && (e.pointerType === 'pen' || (e.pointerType === 'mouse' && e.button === 0) || (e.pointerType === 'touch' && (fingerDraws || tool === 'select' || tool === 'lasso')))
    if (!acts) { startPan(e); return }
    e.preventDefault()
    const [x, y, pr] = toWorld(e.clientX, e.clientY, e.pressure, e.pointerType)

    if (tool === 'lasso') {
      if (lasso) {
        const [x0, y0, x1, y1] = lasso.box, r = 16 / viewRef.current.s
        if (Math.hypot(x - x1, y - y1) <= r) { op.current = { kind: 'lscale', id: e.pointerId, xf: { dx: 0, dy: 0, k: 1, ax: x0, ay: y0 } }; return }
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { op.current = { kind: 'lmove', id: e.pointerId, start: [x, y], xf: { dx: 0, dy: 0, k: 1, ax: 0, ay: 0 } }; return }
        setLasso(null)
      }
      op.current = { kind: 'loop', id: e.pointerId, pts: [x, y] }
      setDraft({ loop: [x, y] })
      return
    }
    if (tool === 'select' || tool === 'text') {
      const s = shownItem(sel)
      if (s && sel) {
        const top = topOf(sel.page), r = 14 / viewRef.current.s
        const h = handlesOf(s).find(([, hx, hy]) => Math.hypot(hx - x, hy + top - y) <= r)
        if (h) { op.current = { kind: 'resize', id: e.pointerId, sel, orig: s, handle: h[0], item: s }; return }
      }
      const hit = itemAt(x, y)
      if (hit) {
        const it = shownItem(hit)!
        setSel(hit)
        if (tool === 'text' && it.t === 'text') { op.current = { kind: 'move', id: e.pointerId, sel: hit, orig: it, start: [x, y], item: it, moved: false }; return }
        setSel(hit)
        op.current = { kind: 'move', id: e.pointerId, sel: hit, orig: it, start: [x, y], item: it, moved: false }
        return
      }
      setSel(null)
      if (tool === 'text') { op.current = { kind: 'tap', id: e.pointerId, x, y, cx: e.clientX, cy: e.clientY }; return }
      startPan(e); return
    }
    if (tool === 'eraser') { const o: Op = { kind: 'erase', id: e.pointerId, map: new Map() }; op.current = o; eraseAt(o, x, y); return }
    if (isShape(tool)) {
      const item: InkItem = { id: newItemId(), t: tool, x, y, w: 0, h: 0, c: color, sw: width }
      op.current = { kind: 'shape', id: e.pointerId, item }
      setDraft({ item })
      return
    }
    const stroke: InkStroke = { c: tool === 'hl' ? 'yellow' : color, w: width, ...(tool === 'hl' ? { hl: true } : {}), p: [x, y, pr] }
    op.current = { kind: 'stroke', id: e.pointerId, stroke }
    setDraft({ stroke: { ...stroke } })
  }
  function move(e: React.PointerEvent) {
    if (!pts.current.has(e.pointerId)) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    const g = gesture.current
    if (g?.mode === 'pinch' && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()]
      const r = box.current!.getBoundingClientRect()
      const m = local(r, (a.x + b.x) / 2, (a.y + b.y) / 2)
      const s = Math.min(MAX_S, Math.max(MIN_S, g.v0.s * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0)))
      const wx = (g.m0[0] - g.v0.tx) / g.v0.s, wy = (g.m0[1] - g.v0.ty) / g.v0.s
      setView({ s, tx: m[0] - wx * s, ty: m[1] - wy * s })
      return
    }
    if (g?.mode === 'pan') {
      const r = box.current!.getBoundingClientRect()
      const [x, y] = local(r, e.clientX, e.clientY)
      setView({ s: g.v0.s, tx: g.v0.tx + x - g.p0[0], ty: g.v0.ty + y - g.p0[1] })
      return
    }
    const o = op.current
    if (!o || o.id !== e.pointerId) return
    if (o.kind === 'tap') {
      if (Math.hypot(e.clientX - o.cx, e.clientY - o.cy) > 8) { op.current = null; startPan({ clientX: o.cx, clientY: o.cy }); move(e) }
      return
    }
    if (o.kind === 'stroke' || o.kind === 'erase' || o.kind === 'loop') {
      const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent]
      for (const ev of events) {
        const [x, y, pr] = toWorld(ev.clientX, ev.clientY, ev.pressure, e.pointerType)
        if (o.kind === 'erase') eraseAt(o, x, y)
        else if (o.kind === 'loop') o.pts.push(x, y)
        else {
          const n = o.stroke.p.length
          if (n >= 3 && Math.abs(o.stroke.p[n - 3] - x) + Math.abs(o.stroke.p[n - 2] - y) < 0.6 / Math.max(0.3, viewRef.current.s)) continue
          o.stroke.p.push(x, y, pr)
        }
      }
      if (o.kind !== 'erase' && !raf.current) raf.current = requestAnimationFrame(() => {
        raf.current = 0
        const c = op.current
        if (c?.kind === 'stroke') setDraft({ stroke: { ...c.stroke, p: [...c.stroke.p] } })
        if (c?.kind === 'loop') setDraft({ loop: [...c.pts] })
      })
      return
    }
    const [x, y] = toWorld(e.clientX, e.clientY)
    if (o.kind === 'shape') { o.item = { ...o.item, w: x - o.item.x, h: y - o.item.y }; setDraft({ item: o.item }); return }
    if (o.kind === 'move') {
      const dx = x - o.start[0], dy = y - o.start[1]
      if (!o.moved && Math.hypot(dx, dy) * viewRef.current.s < 4) return
      o.moved = true
      // dragging an attached arrow by its middle frees it
      o.item = { ...o.orig, x: o.orig.x + dx, y: o.orig.y + dy, ...(isLineLike(o.orig) ? { from: undefined, to: undefined } : {}) }
      setDraft({ item: o.item, itemPage: o.sel.page })
      return
    }
    if (o.kind === 'resize') { o.item = resizeItem(o.orig, o.handle, x, y - topOf(o.sel.page)); setDraft({ item: o.item, itemPage: o.sel.page }); return }
    if (o.kind === 'lmove') { o.xf = { dx: x - o.start[0], dy: y - o.start[1], k: 1, ax: 0, ay: 0 }; setDraft({ xf: o.xf }); return }
    if (o.kind === 'lscale' && lasso) {
      const [x0, y0, x1, y1] = lasso.box
      const k = Math.max(0.1, Math.min(10, Math.max((x - x0) / Math.max(1, x1 - x0), (y - y0) / Math.max(1, y1 - y0))))
      o.xf = { dx: 0, dy: 0, k, ax: x0, ay: y0 }; setDraft({ xf: o.xf })
    }
  }
  async function up(e: React.PointerEvent) {
    pts.current.delete(e.pointerId)
    if (gesture.current) {
      const g = gesture.current
      if (g.mode === 'pinch' && pts.current.size === 1) { const [p] = [...pts.current.values()]; startPan({ clientX: p.x, clientY: p.y }) }
      else if (pts.current.size === 0) {
        gesture.current = null
        // a tap (not a drag) on a verse card opens the passage
        if (g.mode === 'pan' && g.tap && Math.hypot(e.clientX - g.tap[0], e.clientY - g.tap[1]) < 6) {
          const [x, y] = toWorld(e.clientX, e.clientY)
          const hit = itemAt(x, y), it = shownItem(hit)
          if (it?.t === 'verse' && (!writing || tool !== 'select')) openPassage(it)
        }
      }
      return
    }
    const o = op.current
    if (!o || o.id !== e.pointerId) return
    op.current = null
    cancelAnimationFrame(raf.current); raf.current = 0
    if (o.kind === 'erase') {
      const changes: Change = [...o.map.entries()].filter(([, v]) => v.now !== v.before).map(([page, v]) => ({ page, before: v.before, after: v.now }))
      setDraft(null)
      if (changes.length) apply(changes, 'after')
      return
    }
    if (o.kind === 'tap') { void addText(o.x, o.y); return }
    if (o.kind === 'loop') { setDraft(null); if (o.pts.length >= 6) setLasso(lassoSelect(o.pts)); return }
    if (o.kind === 'lmove' || o.kind === 'lscale') { setDraft(null); if (o.xf.dx || o.xf.dy || o.xf.k !== 1) commitLasso(o.xf); return }
    if (o.kind === 'stroke') {
      setDraft(null)
      const s = o.stroke
      if (s.p.length === 3) s.p.push(s.p[0] + 0.5, s.p[1] + 0.5, s.p[2])   // a dot
      const { page, top } = await bandAt(s.p[1])
      const ls: InkStroke = { ...s, p: s.p.map((v, i) => (i % 3 === 1 ? Math.round((v - top) * 10) / 10 : v)) }
      change(page._id, c => ({ ...c, strokes: [...c.strokes, ls] }))
      return
    }
    if (o.kind === 'shape') {
      setDraft(null)
      let it = o.item
      const tapped = Math.hypot(it.w, it.h) * viewRef.current.s < 8
      if (tapped) {
        const d = 160
        it = isLineLike(it) ? { ...it, w: d, h: 0 } : { ...it, x: it.x - d / 2, y: it.y - (it.t === 'ellipse' ? d / 2 : d * 0.4), w: d, h: it.t === 'rect' ? d * 0.65 : d }
      }
      if (isLineLike(it) && !tapped) {
        // ends dropped on shapes, text or verse cards attach to them
        const from = anchorAt(it.x, it.y), to = anchorAt(it.x + it.w, it.y + it.h, from)
        it = { ...it, from, to: to && to !== from ? to : undefined }
      }
      const { page, top } = await bandAt(it.y)
      const placed = normalise({ ...it, y: it.y - top })
      change(page._id, c => ({ ...c, items: [...c.items, placed] }))
      setToolRaw('select'); setSel({ page: page._id, id: placed.id })
      return
    }
    if (o.kind === 'move' || o.kind === 'resize') {
      setDraft(null)
      if (o.kind === 'move' && !o.moved) {
        if (o.orig.t === 'text' && (tool === 'text' || (sel && sel.id === o.sel.id && tool === 'select'))) setEditing(o.sel)
        return
      }
      let next = o.kind === 'resize' ? normalise(o.item) : o.item
      if (o.kind === 'resize' && isLineLike(next)) {
        // re-attach (or free) the end that was dragged
        const top = topOf(o.sel.page)
        if (o.handle === 'a') next = { ...next, from: anchorAt(next.x, next.y + top, next.to) }
        if (o.handle === 'b') next = { ...next, to: anchorAt(next.x + next.w, next.y + next.h + top, next.from) }
      }
      change(o.sel.page, c => ({ ...c, items: c.items.map(it => (it.id === o.sel.id ? next : it)) }))
    }
  }
  function openPassage(it: InkItem) {
    if (!it.s) return
    const { b, c, v } = splitVid(it.s)
    close()
    closeSheet()
    go({ page: 'read', book: b, chapter: c, verse: v, scope: 'chapter' })
  }
  async function addText(x: number, y: number) {
    const { page, top } = await bandAt(y)
    const it: InkItem = { id: newItemId(), t: 'text', x, y: y - top - 14, w: 0, h: 0, c: color, sw: width, text: '', size: 28 }
    change(page._id, c => ({ ...c, items: [...c.items, it] }))
    const s = { page: page._id, id: it.id }
    setSel(s); setEditing(s)
  }
  async function addVerse(q: string): Promise<string | null> {
    const r = parseQuery(q.trim())
    if (!r) return 'Type a reference like John 3:16 or Ps 23:1-4'
    const ids = verseIds(r.s, r.e)
    if (ids.length > MAX_CARD_VERSES) return `That's ${ids.length} verses. A card holds up to ${MAX_CARD_VERSES}; try a shorter passage.`
    const tr = prefs.translation as Translation
    const parts: string[] = []
    for (const id of ids) {
      const t = await verseText(tr, id)
      if (t) parts.push(ids.length > 1 ? `${splitVid(id).v} ${t}` : t)
    }
    if (!parts.length) return "Couldn't find that passage."
    const v = viewRef.current
    const cx = (size.w / 2 - v.tx) / v.s, cy = (size.h / 2 - v.ty) / v.s
    const w = Math.min(VERSE.defW + Math.min(200, parts.join(' ').length / 3), 900)
    // in the middle of the view, nudged down below anything it would land on
    const draftCard: InkItem = { id: newItemId(), t: 'verse', x: Math.round(cx - w / 2), y: Math.round(cy - 120), w, h: 0, c: color, sw: 2, s: ids[0], e: ids[ids.length - 1], tr, ref: formatRef(r.s, r.e), text: parts.join(' ') }
    for (let guard = 0; guard < 30; guard++) {
      const [a0, b0, a1, b1] = itemBox(draftCard)
      const clash = [...RRef.current.byId.values()].map(o => { const b = itemBox(o.it); return [b[0], b[1] + o.top, b[2], b[3] + o.top] })
        .find(b => b[0] < a1 && b[2] > a0 && b[1] < b1 && b[3] > b0)
      if (!clash) break
      draftCard.y = Math.round(clash[3] + 48)
    }
    const { page, top } = await bandAt(draftCard.y)
    const it: InkItem = { ...draftCard, y: draftCard.y - top }
    change(page._id, c => ({ ...c, items: [...c.items, it] }))
    setToolRaw('select'); setSel({ page: page._id, id: it.id }); setVerseOpen(false)
    return null
  }
  function finishText(text: string) {
    const s = editing; setEditing(null)
    if (!s) return
    const it = rawItem(s)
    if (!it) return
    if (!text.trim()) { removeAll(new Map(), new Set([s.id])); setSel(null); return }
    if (text !== it.text) change(s.page, c => ({ ...c, items: c.items.map(x => (x.id === s.id ? { ...x, text } : x)) }))
  }
  const updateSel = (f: (it: InkItem) => InkItem) => { if (sel) change(sel.page, c => ({ ...c, items: c.items.map(it => (it.id === sel.id ? f(it) : it)) })) }
  const deleteSel = () => { if (sel) { removeAll(new Map(), new Set([sel.id])); setSel(null) } }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement)?.tagName === 'INPUT') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && (sel || lasso)) { e.preventDefault(); if (lasso) lassoDelete(); else deleteSel() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo() }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  function wheel(e: React.WheelEvent) {
    const v = viewRef.current
    if (e.ctrlKey || e.metaKey) {
      const r = box.current!.getBoundingClientRect(), [mx, my] = local(r, e.clientX, e.clientY)
      const s = Math.min(MAX_S, Math.max(MIN_S, v.s * Math.exp(-e.deltaY * 0.01)))
      const wx = (mx - v.tx) / v.s, wy = (my - v.ty) / v.s
      setView({ s, tx: mx - wx * s, ty: my - wy * s })
    } else setView({ ...v, tx: v.tx - (e.shiftKey ? e.deltaY : e.deltaX), ty: v.ty - (e.shiftKey ? 0 : e.deltaY) })
  }
  function zoomBy(k: number) {
    const v = viewRef.current, w = size.w / 2, h = size.h / 2
    const s = Math.min(MAX_S, Math.max(MIN_S, v.s * k))
    setView({ s, tx: w - ((w - v.tx) / v.s) * s, ty: h - ((h - v.ty) / v.s) * s })
  }

  const fitS = Math.min(1.2, ((size.w || 800) - 24) / PAGE_W)
  const selItem = draft?.itemPage && sel && draft.item?.id === sel.id ? draft.item : shownItem(sel)
  const selTop = sel ? topOf(sel.page) : 0
  const editItem = rawItem(editing)
  // while dragging, an item (and arrows attached to it) is drawn from the draft instead
  const draftFind = draft?.itemPage && draft.item ? ((id: string) => (id === draft.item!.id ? { it: draft.item!, top: topOf(draft.itemPage!) } : R.find(id))) : null
  const hideItems = new Set<string>()
  if (draft?.itemPage && draft.item) hideItems.add(draft.item.id)
  if (editing) hideItems.add(editing.id)
  const lassoXf = draft?.xf
  const hideStrokes = new Set<InkStroke>()
  if (lasso && lassoXf) for (const m of lasso.members) { m.strokes.forEach(s => hideStrokes.add(s)); m.items.forEach(id => hideItems.add(id)) }
  const followers = draftFind ? [...R.byId.values()].filter(o => isLineLike(o.it) && (o.it.from === draft!.item!.id || o.it.to === draft!.item!.id)) : []
  followers.forEach(o => hideItems.add(o.it.id))
  const edBox = editItem && editing ? (() => {
    const t = topOf(editing.page), [x0, y0] = itemBox(editItem)
    return { left: view.tx + x0 * view.s, top: view.ty + (y0 + t) * view.s, size: (editItem.size ?? 28) * view.s }
  })() : null
  const lb = lasso ? (lassoXf ? [...xfPoint(lassoXf, lasso.box[0], lasso.box[1]), ...xfPoint(lassoXf, lasso.box[2], lasso.box[3])] : lasso.box) : null

  return createPortal(
    <div className="ink-editor" role="dialog" aria-label={live.title || 'Handwritten note'}>
      <header className="ink-top">
        <button className="text-btn" onClick={close}>Done</button>
        <span className="ink-title">{live.title || 'Handwritten note'}</span>
        <span className="ink-history">
          {writing && <><button className="text-btn small" disabled={!undo.length} onClick={doUndo}>Undo</button>
            <button className="text-btn small" disabled={!redo.length} onClick={doRedo}>Redo</button></>}
          {!writing && <button className="primary-btn small" onClick={() => setWriting(true)}>Write</button>}
          {writing && <button className="icon-btn small ink-more" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>}
        </span>
        {menu && (
          <div className="ink-menu" role="menu" onPointerDown={e => e.stopPropagation()}>
            <button role="menuitem" onClick={() => { setFinger(fingerDraws ? 'scroll' : 'draw'); setMenu(false) }}>{fingerDraws ? 'One finger moves the page instead of drawing' : 'Let one finger draw'}</button>
            <button role="menuitem" onClick={() => { setScanning(true); setMenu(false) }}>Scan a paper page in</button>
            <button role="menuitem" onClick={() => { fit(); setMenu(false) }}>Fit to width</button>
          </div>
        )}
      </header>
      <div ref={box} className="ink-view" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}
        style={{ cursor: !writing ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair' }}>
        <svg width={size.w} height={size.h} className="ink-svg">
          <VerseDefs />
          <rect className="ink-sheet" x={0} y={0} width={size.w} height={size.h} />
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
            {pages.map((p, i) => {
              const c = draft?.erase?.[p._id] ?? contentOf(p)
              return <Band key={p._id} page={p} top={L.tops[i]} strokes={c.strokes} items={R.items.get(p._id) ?? []} hideItems={hideItems} hideStrokes={hideStrokes} />
            })}
            {/* things being dragged, drawn or transformed */}
            {draft?.item && draft.itemPage && <g transform={`translate(0 ${topOf(draft.itemPage)})`}><ItemShape it={draft.item} /></g>}
            {draftFind && followers.map(o => <g key={o.it.id} transform={`translate(0 ${o.top})`}><ItemShape it={resolveLine(o.it, o.top, draftFind)} /></g>)}
            {draft?.stroke && <path className={draft.stroke.hl ? 'ink-hl' : ''} d={strokePath(draft.stroke)} fill={INK_COLORS[draft.stroke.c]} />}
            {draft?.item && !draft.itemPage && <ItemShape it={normalise(draft.item)} />}
            {draft?.loop && <path className="ink-lasso" d={`M${draft.loop.join(' ')}`} />}
            {lasso && lassoXf && lasso.members.map(m => {
              const top = topOf(m.page), c = current(m.page)
              const moved = c.strokes.filter(s => m.strokes.has(s)).map(s => {
                const p = s.p.slice()
                for (let k = 0; k < p.length; k += 3) { const [x, y] = xfPoint(lassoXf, p[k], p[k + 1] + top); p[k] = x; p[k + 1] = y - top }
                return { ...s, p }
              })
              const items = (R.items.get(m.page) ?? []).filter(it => m.items.has(it.id)).map(it => xfItem(it, lassoXf, top))
              return <g key={m.page} transform={`translate(0 ${top})`}><Items items={items} /><Strokes strokes={moved} /></g>
            })}
            {lb && (
              <g className="ink-sel">
                <rect x={lb[0]} y={lb[1]} width={lb[2] - lb[0]} height={lb[3] - lb[1]} />
                <circle className="ink-handle" cx={lb[2]} cy={lb[3]} r={8 / view.s} />
              </g>
            )}
            {selItem && sel && !editing && (
              <g transform={`translate(0 ${selTop})`} className="ink-sel">
                {!isLineLike(selItem) && (() => { const [x0, y0, x1, y1] = itemBox(selItem); const m = 8 / view.s; return <rect x={x0 - m} y={y0 - m} width={x1 - x0 + 2 * m} height={y1 - y0 + 2 * m} /> })()}
                {handlesOf(selItem).map(([h, hx, hy]) => <circle key={h} className={`ink-handle ${(h === 'a' && selItem.from) || (h === 'b' && selItem.to) ? 'is-attached' : ''}`} cx={hx} cy={hy} r={7 / view.s} />)}
              </g>
            )}
          </g>
        </svg>
        {edBox && editItem && (
          <TextEditor key={editing!.id} initial={editItem.text ?? ''} style={{ left: edBox.left, top: edBox.top, fontSize: edBox.size, color: INK_COLORS[editItem.c] }} onDone={finishText} />
        )}
        <div className="ink-zoom" onPointerDown={e => e.stopPropagation()}>
          <button className="icon-btn small" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>−</button>
          <button className="text-btn small" onClick={fit} title="Fit the width">{Math.round((view.s / fitS) * 100)}%</button>
          <button className="icon-btn small" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>+</button>
        </div>
        {sel && selItem && !editing && writing && (
          <div className="ink-selbar" onPointerDown={e => e.stopPropagation()}>
            {COLORS.map(c => (
              <button key={c} className={`ink-swatch sw-${c} ${selItem.c === c ? 'is-on' : ''}`} aria-label={`Make it ${c === 'ink' ? 'black' : c}`} onClick={() => updateSel(it => ({ ...it, c }))} />
            ))}
            {selItem.t === 'verse' ? (
              <button className="text-btn small" onClick={() => openPassage(selItem)}>Open {selItem.ref}</button>
            ) : selItem.t === 'text' ? (
              <>
                <button className="text-btn small" onClick={() => setEditing(sel)}>Edit text</button>
                <button className="icon-btn small" aria-label="Smaller text" onClick={() => updateSel(it => ({ ...it, size: Math.max(10, Math.round((it.size ?? 28) / 1.2)) }))}>A−</button>
                <button className="icon-btn small" aria-label="Larger text" onClick={() => updateSel(it => ({ ...it, size: Math.min(200, Math.round((it.size ?? 28) * 1.2)) }))}>A+</button>
              </>
            ) : (
              <>
                {[1, 2, 3].map(w => <button key={w} className={`ink-width ${selItem.sw === w ? 'is-on' : ''}`} aria-label={['Thin', 'Medium', 'Thick'][w - 1]} onClick={() => updateSel(it => ({ ...it, sw: w }))}><span style={{ width: 3 + w * 3, height: 3 + w * 3 }} /></button>)}
                {!isLineLike(selItem) && <button className={`text-btn small ${selItem.fill ? 'is-on' : ''}`} onClick={() => updateSel(it => ({ ...it, fill: !it.fill }))}>{selItem.fill ? 'Filled' : 'Fill'}</button>}
                {isLineLike(selItem) && (selItem.from || selItem.to) && <span className="muted small-note">Attached</span>}
              </>
            )}
            <button className="icon-btn small danger" aria-label="Delete" onClick={deleteSel}><IconTrash size={16} /></button>
          </div>
        )}
        {lasso && !lassoXf && writing && (
          <div className="ink-selbar" onPointerDown={e => e.stopPropagation()}>
            <span className="muted small-note">{lasso.members.reduce((t, m) => t + m.strokes.size + m.items.size, 0)} selected</span>
            {COLORS.map(c => <button key={c} className={`ink-swatch sw-${c}`} aria-label={`Make them ${c === 'ink' ? 'black' : c}`} onClick={() => lassoColour(c)} />)}
            <span className="muted small-note">Drag to move · corner to resize</span>
            <button className="icon-btn small danger" aria-label="Delete selection" onClick={lassoDelete}><IconTrash size={16} /></button>
          </div>
        )}
        {verseOpen && <VersePrompt onAdd={addVerse} onClose={() => setVerseOpen(false)} />}
      </div>
      {writing ? (
        <InkWheel tool={(verseOpen ? 'verse' : tool) as WheelTool} color={color === 'yellow' ? 'ink' : color} width={width}
          onTool={t => { if (t === 'verse') { setSel(null); setLasso(null); setVerseOpen(true) } else { setTool(t); if (!HINTS[t]) say(toolLabel(t)) } }}
          onColor={c => { setColor(c); if (tool === 'hl' || tool === 'eraser' || tool === 'select' || tool === 'lasso') setToolRaw('pen') }}
          onWidth={w => { setWidth(w); if (tool === 'eraser' || tool === 'select' || tool === 'lasso') setToolRaw('pen') }} />
      ) : (
        <div className="ink-readhint">Pinch to zoom, drag to move around. Tap a verse card to open it.</div>
      )}
      {hint && writing && <div className="ink-hint" role="status">{hint}</div>}
      {scanning && <PaperScanFlow addTo={live} onClose={() => setScanning(false)} />}
    </div>,
    document.body,
  )
}

/** Typing a reference to drop a verse card in the middle of the view. */
function VersePrompt({ onAdd, onClose }: { onAdd: (q: string) => Promise<string | null>; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <form className="ink-verse-prompt" onPointerDown={e => e.stopPropagation()} onSubmit={async e => {
      e.preventDefault(); if (!q.trim()) return
      setBusy(true); const m = await onAdd(q); setBusy(false); if (m) setErr(m)
    }}>
      <input ref={ref} className="field" value={q} onChange={e => { setQ(e.target.value); setErr('') }} placeholder="e.g. John 15:5 or Ps 23:1-4" aria-label="Verse reference" enterKeyHint="done" autoComplete="off" spellCheck={false} />
      <button className="primary-btn small" type="submit" disabled={!q.trim() || busy}>Add card</button>
      <button className="icon-btn small" type="button" aria-label="Close" onClick={onClose}><IconClose size={16} /></button>
      {err && <p className="sel-error">{err}</p>}
    </form>
  )
}

/** Typing into a text box: a plain textarea laid exactly over where the text sits on the canvas. */
function TextEditor({ initial, style, onDone }: { initial: string; style: React.CSSProperties; onDone: (text: string) => void }) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const finish = () => { if (!done.current) { done.current = true; onDone(text) } }
  useEffect(() => { const t = ref.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length) } }, [])
  const lines = text.split('\n')
  return (
    <textarea ref={ref} className="ink-textedit" value={text} onChange={e => setText(e.target.value)} onBlur={finish}
      onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finish() } }}
      onPointerDown={e => e.stopPropagation()} placeholder="Type here"
      rows={Math.max(1, lines.length)} cols={Math.max(8, ...lines.map(l => l.length + 1))} style={style} spellCheck />
  )
}

/* ---------- the note sheet for an ink note ---------- */
let openEditorFor: string | null = null
/** Open this ink note straight into the canvas, ready to write, the next time its sheet shows. */
export const editOnOpen = (id: string) => { openEditorFor = id }

const refsFrom = (text: string): NoteRef[] => {
  let r: Range[] = findRefs(text)
  if (!r.length) r = text.split(/[;,]/).map(t => parseQuery(t.trim())).filter((x): x is Range => !!x)
  return r.map(x => ({ ...x, confirmed: true }))
}

export function InkNoteBody({ noteId }: { noteId: string }) {
  const store = useStore()
  const note = store.notes.find(n => n._id === noteId)
  const [canvas, setCanvas] = useState<null | 'view' | 'write'>(() => { const e = openEditorFor === noteId; openEditorFor = null; return e ? 'write' : null })
  const [details, setDetails] = useState(false)
  if (!note) return <p className="empty"><span>This note was deleted.</span></p>
  async function remove() {
    if (!confirm('Delete this handwritten note and everything on it?')) return
    const n = getState().notes.find(x => x._id === noteId)
    closeSheet()
    if (n) await deleteNote(n)
  }
  return (
    <div className="scan-note">
      <header className="sheet-head scan-note-head">
        <div>
          <h2>{note.title || 'Handwritten note'}</h2>
          <p className="muted small-note">
            {note.category ? categoryPath(note.category) : 'No category'}
            {note.refs.length ? ` · ${note.refs.map(r => formatRef(r.s, r.e, true)).join(', ')}` : ''}
            {` · ${new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
          </p>
        </div>
        <button className="icon-btn" onClick={closeSheet} aria-label="Close"><IconClose /></button>
      </header>
      <div className="button-row">
        <button className="primary-btn" onClick={() => setCanvas('write')}>Write</button>
        <button className="text-btn" onClick={() => setCanvas('view')}>Open and zoom</button>
        <button className="text-btn" onClick={() => setDetails(!details)}>{details ? 'Close details' : 'Details'}</button>
      </div>
      {details && <InkDetails note={note} onDone={() => setDetails(false)} />}
      <button className="ink-page-btn" onClick={() => setCanvas('view')} aria-label="Open the note"><InkCanvasPreview note={note} /></button>
      <div className="button-row">
        <button className="text-btn danger" onClick={remove}><IconTrash size={15} /> Delete note</button>
      </div>
      {canvas && <InkCanvas note={note} readOnly={canvas === 'view'} onClose={() => setCanvas(null)} />}
    </div>
  )
}

export function InkDetails({ note, onDone }: { note: Note; onDone: () => void }) {
  useStore()
  const [title, setTitle] = useState(note.title)
  const [cat, setCat] = useState<string | null>(note.category ?? null)
  const [verses, setVerses] = useState(note.refs.map(r => formatRef(r.s, r.e)).join('; '))
  const parsed = useMemo(() => refsFrom(verses), [verses])
  const scans = inkPagesOf(note).map((p, i) => ({ p, i })).filter(x => isScan(x.p))
  return (
    <div className="scan-form ink-details">
      <label className="scan-field"><span>Title</span><input className="field" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sermon notes, Isaiah 55" /></label>
      <div className="scan-field"><span>Category</span><CategoryPicker value={cat} onChange={setCat} /></div>
      <label className="scan-field"><span>Verses it's about <small className="muted">(optional; shows beside the text)</small></span>
        <input className="field" value={verses} onChange={e => setVerses(e.target.value)} placeholder="e.g. Isaiah 55; John 15:1-11" /></label>
      {verses.trim() && <p className="hint small">{parsed.length ? parsed.map(r => formatRef(r.s, r.e)).join(' · ') : 'No references recognised yet.'}</p>}
      {scans.length > 0 && (
        <div className="scan-field"><span>Scanned pages</span>
          <ul className="ink-scan-list">
            {scans.map(({ p }, k) => (
              <li key={p._id}>
                <span className="ink-scan-mini"><InkPageSvg page={p} strokes={[]} /></span>
                <span>Scan {k + 1}{p.strokes.length ? ' (with your writing on it)' : ''}</span>
                <button className="text-btn small danger" onClick={async () => {
                  if (confirm(`Remove scan ${k + 1}${p.strokes.length ? ' and what you wrote on it' : ''}?`)) await removeInkPage(note, p._id)
                }}>Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="button-row">
        <button className="primary-btn small" onClick={async () => { await saveNoteDetails(note, { title: title.trim(), category: cat, refs: parsed }); onDone() }}>Save</button>
      </div>
    </div>
  )
}
export { refsFrom }
