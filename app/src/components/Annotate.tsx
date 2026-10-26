// Select any text to highlight it, attach a note, or link it to a verse.
// One toolbar serves Scripture, sermons, the Treasury of David and Morning and Evening.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  HIGHLIGHT_COLORS, deleteMark, notesForMark, saveMark, useMarkVersion, type BibleSrc, type HighlightColor, type Mark, type TextSrc,
} from '../lib/db'
import { getState } from '../lib/db'
import { formatRef } from '../lib/bible'
import { findRefs } from '../lib/refs'
import { openNote, pickNoteFor, scrollToMarkLater, takePendingMark } from '../lib/ui'
import { IconClose } from './Icons'
import { addMem, memFor } from '../lib/memory'

/* ---------- toolbar state ---------- */
type Pending =
  | { kind: 'new'; src: BibleSrc | TextSrc; quote: string; rect: DOMRect; suggest?: number | null }
  | { kind: 'edit'; markId: string; rect: DOMRect; suggest?: number | null }
let pending: Pending | null = null
let toolbarBusy = false // true while the pointer or focus is inside the toolbar
const subs = new Set<() => void>()
const setPending = (p: Pending | null) => { pending = p; if (!p) toolbarBusy = false; subs.forEach(f => f()) }
const usePending = () => useSyncExternalStore(fn => (subs.add(fn), () => { subs.delete(fn) }), () => pending)

/** Character offset of (node, offset) inside container, counting only text. */
function textOffset(container: Node, node: Node, offset: number) {
  const r = document.createRange()
  r.selectNodeContents(container)
  r.setEnd(node, offset)
  return r.toString().length
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Watch for text selections inside `root` and turn them into a pending highlight.
 * `toSrc` maps the selection's start/end (element + offset) to a highlight source.
 */
export function useSelectionCapture(
  root: React.RefObject<HTMLElement | null>,
  toSrc: (start: { el: Element; offset: number }, end: { el: Element; offset: number }) => BibleSrc | TextSrc | null,
  blockSelector: string,
  suggest?: number | null,
) {
  useEffect(() => {
    let t: number | undefined
    const check = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        if (toolbarBusy) return
        const sel = window.getSelection()
        const el = root.current
        if (!sel || !el || sel.rangeCount === 0) return
        if (sel.isCollapsed) { if (pending?.kind === 'new') setPending(null); return }
        const range = sel.getRangeAt(0)
        if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return
        const startBlock = (range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement)?.closest(blockSelector)
        const endBlock = (range.endContainer.nodeType === 1 ? range.endContainer as Element : range.endContainer.parentElement)?.closest(blockSelector)
        if (!startBlock || !endBlock) return
        const src = toSrc(
          { el: startBlock, offset: textOffset(startBlock, range.startContainer, range.startOffset) },
          { el: endBlock, offset: textOffset(endBlock, range.endContainer, range.endOffset) },
        )
        const frag = range.cloneContents()
        frag.querySelectorAll('sup, .vnum, .note-dot').forEach(n => n.remove())
        const quote = clean(frag.textContent ?? '')
        if (!src || !quote) return
        setPending({ kind: 'new', src, quote: quote.slice(0, 600), rect: range.getBoundingClientRect(), suggest })
      }, 180)
    }
    document.addEventListener('selectionchange', check)
    return () => { document.removeEventListener('selectionchange', check); window.clearTimeout(t) }
  }, [root, toSrc, blockSelector, suggest])
}
export const editMark = (markId: string, rect: DOMRect, suggest?: number | null) => setPending({ kind: 'edit', markId, rect, suggest })
export const clearToolbar = () => setPending(null)

/* ---------- the toolbar ---------- */
export function SelectionToolbar() {
  const p = usePending()
  useMarkVersion()
  const [linking, setLinking] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  useEffect(() => { setLinking(false); setLinkText(''); setError('') }, [p?.kind === 'edit' ? p.markId : p?.quote])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPending(null) }
    const onDown = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return
      if (pending?.kind === 'edit') setPending(null)
    }
    addEventListener('keydown', onKey); addEventListener('pointerdown', onDown)
    return () => { removeEventListener('keydown', onKey); removeEventListener('pointerdown', onDown) }
  }, [])
  const onScroll = useRef(() => setPending(null))
  useEffect(() => {
    const f = onScroll.current
    if (p?.kind === 'edit') addEventListener('scroll', f, { passive: true, once: true })
    return () => removeEventListener('scroll', f)
  }, [p])
  if (!p) return null

  const mark: Mark | undefined = p.kind === 'edit' ? getState().marks.get(p.markId) : undefined
  if (p.kind === 'edit' && !mark) return null
  const isText = (p.kind === 'new' ? p.src.kind : mark!.src.kind) === 'text'
  const notes = mark ? notesForMark(mark._id) : []

  async function ensureMark(color?: HighlightColor | null): Promise<Mark> {
    if (mark) return color === undefined ? mark : saveMark({ ...mark, color })
    const pp = p as Extract<Pending, { kind: 'new' }>
    const m = await saveMark({ src: pp.src, quote: pp.quote, color: color ?? null })
    window.getSelection()?.removeAllRanges()
    setPending({ kind: 'edit', markId: m._id, rect: pp.rect, suggest: pp.suggest })
    return m
  }
  async function onColor(c: HighlightColor) {
    if (mark && mark.color === c) {
      if (!notesForMark(mark._id).length && !mark.links.length) { await deleteMark(mark); setPending(null); return }
      await saveMark({ ...mark, color: null }); return
    }
    await ensureMark(c)
  }
  async function onNote() {
    const m = await ensureMark()
    setPending(null)
    openNote(notes[0]?._id ?? null, notes[0] ? [] : [m._id])
  }
  async function onAddToNote() { const m = await ensureMark(); setPending(null); pickNoteFor(m._id) }
  async function onLink(text = linkText) {
    const r = findRefs(text)
    if (!r.length) { setError('Type a reference like Rom 8:28'); return }
    const m = await ensureMark()
    const links = [...m.links]
    for (const x of r) if (!links.some(l => l.s === x.s && l.e === x.e)) links.push({ s: x.s, e: x.e })
    await saveMark({ ...m, links })
    setLinking(false); setLinkText(''); setError('')
  }
  async function unlink(i: number) { if (mark) await saveMark({ ...mark, links: mark.links.filter((_, j) => j !== i) }) }
  const bsrc = !isText ? (p.kind === 'new' ? p.src : mark!.src) as BibleSrc : null
  const canMemorize = !!bsrc && bsrc.e - bsrc.s < 4 && Math.floor(bsrc.s / 1000) === Math.floor(bsrc.e / 1000)
  const memorizing = bsrc ? memFor(bsrc.s) : undefined
  const memDone = !!memorizing && memorizing.s === bsrc?.s && memorizing.e === bsrc?.e
  async function onMemorize() {
    if (!bsrc) return
    await addMem(bsrc.s, bsrc.e, bsrc.tr)
    window.getSelection()?.removeAllRanges(); setPending(null)
  }
  async function onRemove() { if (mark) { await deleteMark(mark); setPending(null) } }

  // Above the selection with a mouse; below it on touch screens, where the phone's own menu sits above.
  // Measure the highlight where it now sits (the page may have moved since it was selected).
  const live = p.kind === 'edit' ? [...document.querySelectorAll(`[data-mark="${p.markId}"]`)] : []
  const r = live.length ? (() => {
    const a = live[0].getBoundingClientRect(), z = live[live.length - 1].getBoundingClientRect()
    return new DOMRect(Math.min(a.left, z.left), a.top, Math.max(a.right, z.right) - Math.min(a.left, z.left), z.bottom - a.top)
  })() : p.rect
  const w = Math.min(isText ? (mark ? 470 : 440) : (mark ? 360 : 330) + (canMemorize ? 92 : 0), window.innerWidth - 16)
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))
  const below = coarse || r.top < 120
  const clampTop = (t: number) => Math.max(70, Math.min(t, window.innerHeight - 170))
  const style: React.CSSProperties = below ? { left, top: clampTop(r.bottom + 12), width: w } : { left, top: Math.max(130, Math.min(r.top - 12, window.innerHeight - 20)), width: w, transform: 'translateY(-100%)' }
  const suggestion = p.suggest && !(mark?.links ?? []).some(l => l.s === p.suggest) ? p.suggest : null

  return (
    <div ref={box} className="sel-toolbar" style={style} role="toolbar" aria-label="Highlight"
      onPointerEnter={() => { toolbarBusy = true }} onPointerLeave={() => { toolbarBusy = false }}
      onFocus={() => { toolbarBusy = true }} onBlur={() => { toolbarBusy = false }}
      onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
      <div className="sel-row">
        {HIGHLIGHT_COLORS.map(c => (
          <button key={c} className={`swatch small swatch-${c}`} aria-pressed={mark?.color === c} aria-label={`Highlight ${c}`} onClick={() => onColor(c)} />
        ))}
        <span className="sel-sep" />
        <button className="sel-btn" onClick={onNote}>{notes.length ? 'Open note' : 'Note'}</button>
        <button className="sel-btn" onClick={onAddToNote}>Add to note</button>
        {isText && <button className={`sel-btn ${linking ? 'is-on' : ''}`} onClick={() => setLinking(!linking)}>Link verse</button>}
        {canMemorize && (memDone ? <a className="sel-btn is-on" href="#/memory">Memorizing</a> : <button className="sel-btn" onClick={onMemorize}>Memorize</button>)}
        {mark && <button className="sel-btn quiet" onClick={onRemove} aria-label="Remove highlight" title="Remove highlight"><IconClose size={16} /></button>}
      </div>
      {isText && (mark?.links.length || linking) ? (
        <div className="sel-links">
          {mark?.links.map((l, i) => (
            <span key={i} className="chip">{formatRef(l.s, l.e, true)}<button aria-label="Unlink" onClick={() => unlink(i)}>×</button></span>
          ))}
          {linking && (
            <form className="sel-link-form" onSubmit={e => { e.preventDefault(); onLink() }}>
              <input autoFocus value={linkText} onChange={e => { setLinkText(e.target.value); setError('') }} placeholder="Verse, e.g. Rom 8:28" aria-label="Verse to link" />
              <button className="sel-btn" type="submit">Link</button>
              {suggestion && <button type="button" className="chip chip-link" onClick={() => onLink(formatRef(suggestion))}>{formatRef(suggestion, suggestion, true)}</button>}
            </form>
          )}
          {error && <p className="sel-error">{error}</p>}
        </div>
      ) : null}
    </div>
  )
}

/* ---------- Scripture: one verse's text with its highlights ---------- */
type Seg = { a: number; b: number; color: HighlightColor | null; ids: string[]; wj?: boolean; voice?: [number, number, number, number] }
export function VerseText({ id, text, tr, marks, red, voices }: { id: number; text: string; tr: string; marks: Mark[]; red?: [number, number][]; voices?: [number, number, number, number][] }) {
  const L = text.length
  const spans: { a: number; b: number; m: Mark; endsHere: boolean }[] = []
  for (const m of marks) {
    if (m.src.kind !== 'bible' || m.src.s > id || m.src.e < id) continue
    const same = m.src.tr === tr
    const a = same && id === m.src.s ? Math.min(m.src.so, L) : 0
    const b = same && id === m.src.e && m.src.eo >= 0 ? Math.min(m.src.eo, L) : L
    if (b > a) spans.push({ a, b, m, endsHere: id === m.src.e })
  }
  const reds = (red ?? []).map(([a, b]) => [Math.min(a, L), Math.min(b, L)] as const).filter(([a, b]) => b > a)
  const vs = (voices ?? []).filter(([a, b]) => b > a && a < L)
  if (!spans.length && !reds.length && !vs.length) return <span className="vt" data-id={id}>{text}</span>
  const cuts = [...new Set([0, L, ...spans.flatMap(s => [s.a, s.b]), ...reds.flat(), ...vs.flatMap(([a, b]) => [a, Math.min(b, L)])])].sort((x, y) => x - y)
  const segs: Seg[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1]
    const on = spans.filter(s => s.a <= a && s.b >= b)
    const colored = on.filter(s => s.m.color).sort((x, y) => x.m.createdAt.localeCompare(y.m.createdAt))
    segs.push({ a, b, color: colored.length ? colored[colored.length - 1].m.color : null, ids: on.map(s => s.m._id), wj: reds.some(([x, y]) => x <= a && y >= b), voice: vs.find(([x, y, , k]) => x <= a && y >= b && k === 1) ?? vs.find(([x, y]) => x <= a && y >= b) })
  }
  const dotsAt = new Map<number, string[]>()
  for (const s of spans) if (s.endsHere && notesForMark(s.m._id).length) dotsAt.set(s.b, [...(dotsAt.get(s.b) ?? []), s.m._id])
  return (
    <span className="vt" data-id={id}>
      {segs.map(s => (
        <span key={s.a} className={[s.wj ? 'wj' : '', s.voice ? `vo vo-${s.voice[2] % 8}${s.voice[3] === 1 ? ' vo-name' : ''}` : ''].join(' ').trim() || undefined}
          data-who={s.voice ? s.voice[2] : undefined}>
          {s.color ? <mark className={`mk hl-${s.color}`}>{text.slice(s.a, s.b)}</mark> : text.slice(s.a, s.b)}
          {dotsAt.get(s.b)?.map(mid => (
            <button key={mid} className="note-dot" aria-label="Open note" title="Open note"
              onClick={e => { e.stopPropagation(); openNote(notesForMark(mid)[0]._id) }} />
          ))}
        </span>
      ))}
    </span>
  )
}
/** Turn a selection inside verse text into a Scripture highlight. */
export function bibleSrcFrom(tr: string) {
  return (start: { el: Element; offset: number }, end: { el: Element; offset: number }): BibleSrc | null => {
    const s = Number((start.el as HTMLElement).dataset.id), e = Number((end.el as HTMLElement).dataset.id)
    if (!s || !e) return null
    const endLen = end.el.textContent?.length ?? 0
    return { kind: 'bible', tr, s, e, so: start.offset, eo: end.offset >= endLen ? -1 : end.offset }
  }
}

/* ---------- other texts: rendered HTML with highlights woven in ---------- */
const BLOCKS = 'p, li, h2, h3, h4'
export function AnnotatedHtml({ html, doc, label, href, className, suggest }: {
  html: string; doc: string; label: string; href: string; className?: string; suggest?: number | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const version = useMarkVersion()
  const toSrc = useRef((start: { el: Element; offset: number }, end: { el: Element; offset: number }): TextSrc | null => {
    const b1 = Number((start.el as HTMLElement).dataset.b), b2 = Number((end.el as HTMLElement).dataset.b)
    if (Number.isNaN(b1) || Number.isNaN(b2)) return null
    return { kind: 'text', doc, label, href, b1, o1: start.offset, b2, o2: end.offset }
  })
  toSrc.current = (start, end) => {
    const b1 = Number((start.el as HTMLElement).dataset.b), b2 = Number((end.el as HTMLElement).dataset.b)
    if (Number.isNaN(b1) || Number.isNaN(b2)) return null
    return { kind: 'text', doc, label, href, b1, o1: start.offset, b2, o2: end.offset }
  }
  const stableToSrc = useRef((s: { el: Element; offset: number }, e: { el: Element; offset: number }) => toSrc.current(s, e)).current
  useSelectionCapture(ref, stableToSrc, '[data-b]', suggest)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = html
    const blocks = [...el.querySelectorAll(BLOCKS)].filter(b => !b.querySelector(BLOCKS))
    blocks.forEach((b, i) => { (b as HTMLElement).dataset.b = String(i) })
    const marks = [...getState().marks.values()].filter(m => m.src.kind === 'text' && m.src.doc === doc)
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
    for (const m of marks) {
      const s = m.src as TextSrc
      let last: Element | null = null
      for (let bi = s.b1; bi <= s.b2; bi++) {
        const block = blocks[bi]
        if (!block) continue
        const len = block.textContent?.length ?? 0
        const a = bi === s.b1 ? s.o1 : 0, b = bi === s.b2 ? s.o2 : len
        last = wrapRange(block, a, b, m) ?? last
      }
      if (last && notesForMark(m._id).length) {
        const dot = document.createElement('button')
        dot.className = 'note-dot'; dot.dataset.note = m._id; dot.setAttribute('aria-label', 'Open note')
        last.after(dot)
      }
    }
    const want = takePendingMark()
    if (want) el.querySelector(`[data-mark="${want}"]`)?.scrollIntoView({ block: 'center' })
  }, [html, doc, version])

  return (
    <div ref={ref} className={className} onClick={e => {
      const t = e.target as HTMLElement
      const dot = t.closest('[data-note]') as HTMLElement | null
      if (dot) { openNote(notesForMark(dot.dataset.note!)[0]?._id ?? null); return }
      const mk = t.closest('[data-mark]') as HTMLElement | null
      if (mk && window.getSelection()?.isCollapsed !== false) editMark(mk.dataset.mark!, mk.getBoundingClientRect(), suggest)
      if (t.closest('a.ref-link')) clearToolbar()
    }} />
  )
}

/** Wrap characters [a, b) of a block's text in highlight elements. Returns the last element created. */
function wrapRange(block: Element, a: number, b: number, m: Mark): Element | null {
  if (b <= a) return null
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  let pos = 0, last: Element | null = null
  for (const node of nodes) {
    const len = node.data.length
    const s = Math.max(a, pos), e = Math.min(b, pos + len)
    if (s < e) {
      let target = node
      if (s > pos) target = target.splitText(s - pos)
      if (e < pos + len) target.splitText(e - s)
      const w = document.createElement('mark')
      w.className = `mk ${m.color ? `hl-${m.color}` : 'mk-plain'}`
      w.dataset.mark = m._id
      target.replaceWith(w)
      w.append(target)
      last = w
    }
    pos += len
  }
  return last
}

/** Follow a highlight back to where it was made. */
export function goToMark(m: Mark) {
  if (m.src.kind === 'text') { scrollToMarkLater(m._id); location.hash = m.src.href.replace(/^#/, '') }
  else {
    const s = m.src.s, b = Math.floor(s / 1_000_000), c = Math.floor((s % 1_000_000) / 1000), v = s % 1000
    location.hash = `/read/${b}/${c}/${v}`
  }
}
