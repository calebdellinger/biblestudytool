// The sermon notes editor: one long page you type into like a document, separate from the handwriting canvas.
// Quick Scripture: tap Verse (or Ctrl/Cmd+K), type "rom 8:28-30" or just "29", Enter. References you type link themselves.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { formatRef, loadChapter, localTr, splitVid } from '../lib/bible'
import bcv from '../lib/bcv'
import { noteRanges, type Note, type SermonMeta } from '../lib/db'
import { addMem } from '../lib/memory'
import { findRefs, parseQuery, type Range } from '../lib/refs'
import {
  blocksOf, dropIfEmpty, idsBetween, MAX_QUOTE, plainText, quoteOf, resolveRef, saveSermon, sermonValues, TAG_TITLES, TAGS,
  toMarkdown, wordCount, type Tag,
} from '../lib/sermon'
import { go, useAsync, useMedia, usePrefs, useStore } from '../lib/hooks'
import { CategoryPicker } from './Notes'

/* ---------- editor pieces ---------- */

/** A quoted passage, kept as its own block: the words are saved in the note so it reads the same later. */
const VerseQuote = Node.create({
  name: 'verseQuote', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() {
    const num = (k: string) => ({ default: 0, parseHTML: (el: HTMLElement) => Number(el.getAttribute(`data-${k}`)) || 0, renderHTML: (a: Record<string, unknown>) => ({ [`data-${k}`]: a[k] }) })
    const str = (k: string, d = '') => ({ default: d, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? d, renderHTML: (a: Record<string, unknown>) => ({ [`data-${k}`]: a[k] }) })
    return { s: num('s'), e: num('e'), tr: str('tr', 'BSB'), text: str('text'), label: str('label') }
  },
  parseHTML() { return [{ tag: 'figure.sm-verse' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { class: 'sm-verse' }), ['blockquote', {}, String(node.attrs.text)], ['figcaption', {}, `${node.attrs.label} · ${node.attrs.tr}`]]
  },
})

/** A line you mean to come back to: an application, a question or something to follow up. */
const Tagged = Node.create({
  name: 'tagged', group: 'block', content: 'inline*',
  addAttributes() {
    return { tag: { default: 'application', parseHTML: (el: HTMLElement) => el.getAttribute('data-tag') ?? 'application', renderHTML: (a: Record<string, unknown>) => ({ 'data-tag': a.tag }) } }
  },
  parseHTML() { return [{ tag: 'p[data-tag]' }] },
  renderHTML({ HTMLAttributes }) { return ['p', mergeAttributes(HTMLAttributes, { class: 'sm-tag' }), 0] },
  addKeyboardShortcuts() {
    return {
      // Enter on an empty tagged line goes back to a normal paragraph.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (empty && $from.parent.type.name === 'tagged' && $from.parent.content.size === 0) return editor.commands.setNode('paragraph')
        return false
      },
    }
  },
})

/** Underlines Scripture references as you type them; tapping one opens a quick look. */
const spanCache = new Map<string, [number, number][]>()
function spansOf(text: string): [number, number][] {
  let r = spanCache.get(text)
  if (!r) {
    r = text.length < 3 ? [] : bcv.indices(text).map(x => [x.indices[0], x.indices[1]] as [number, number])
    if (spanCache.size > 800) spanCache.clear()
    spanCache.set(text, r)
  }
  return r
}
const refsKey = new PluginKey<DecorationSet>('scriptureRefs')
const ScriptureRefs = Extension.create({
  name: 'scriptureRefs',
  addProseMirrorPlugins() {
    const build = (doc: import('@tiptap/pm/model').Node) => {
      const decos: Decoration[] = []
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return true
        const text = node.textBetween(0, node.content.size, '\n', ' ')
        for (const [a, b] of spansOf(text)) decos.push(Decoration.inline(pos + 1 + a, pos + 1 + b, { class: 'sm-ref' }))
        return false
      })
      return DecorationSet.create(doc, decos)
    }
    return [new Plugin({
      key: refsKey,
      state: { init: (_, { doc }) => build(doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
      props: { decorations: state => refsKey.getState(state) },
    })]
  },
})

type Ed = NonNullable<ReturnType<typeof useEditor>>

function toggleTag(ed: Ed, tag: Tag) {
  const { $from } = ed.state.selection
  if ($from.parent.type.name === 'tagged' && $from.parent.attrs.tag === tag) ed.chain().focus().setNode('paragraph').run()
  else ed.chain().focus().setNode('tagged', { tag }).run()
}

function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const set = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`)
    set(); vv.addEventListener('resize', set); vv.addEventListener('scroll', set)
    return () => { vv.removeEventListener('resize', set); vv.removeEventListener('scroll', set); document.documentElement.style.removeProperty('--kb') }
  }, [])
}

function Toolbar({ ed, onVerse, verseOpen }: { ed: Ed; onVerse: () => void; verseOpen: boolean }) {
  const st = useEditorState({
    editor: ed,
    selector: ({ editor }) => {
      const p = editor.state.selection.$from.parent
      return {
        h: editor.isActive('heading', { level: 2 }), b: editor.isActive('bold'), i: editor.isActive('italic'),
        ul: editor.isActive('bulletList'), ol: editor.isActive('orderedList'),
        tag: p.type.name === 'tagged' ? (p.attrs.tag as Tag) : null,
        undo: editor.can().undo(), redo: editor.can().redo(),
      }
    },
  })
  // Keep the cursor in the text when a button is pressed.
  const keep = (e: React.SyntheticEvent) => e.preventDefault()
  const B = (p: { on?: boolean; label: string; title: string; run: () => void; off?: boolean; cls?: string }) => (
    <button type="button" className={`sm-btn ${p.cls ?? ''} ${p.on ? 'is-on' : ''}`} title={p.title} aria-label={p.title} aria-pressed={p.on} disabled={p.off}
      onMouseDown={keep} onTouchStart={keep} onClick={p.run}>{p.label}</button>
  )
  return (
    <div className="sm-bar" role="toolbar" aria-label="Formatting">
      <button type="button" className={`sm-btn sm-verse-btn ${verseOpen ? 'is-on' : ''}`} onClick={onVerse} title="Add a verse or passage (Ctrl/Cmd+K)">Verse</button>
      <span className="sm-sep" />
      {B({ label: 'Point', title: 'Main point heading', on: st.h, run: () => ed.chain().focus().toggleHeading({ level: 2 }).run() })}
      {B({ label: 'B', title: 'Bold', on: st.b, cls: 'sm-b', run: () => ed.chain().focus().toggleBold().run() })}
      {B({ label: 'I', title: 'Italic', on: st.i, cls: 'sm-i', run: () => ed.chain().focus().toggleItalic().run() })}
      {B({ label: '•', title: 'Bullet list', on: st.ul, run: () => ed.chain().focus().toggleBulletList().run() })}
      {B({ label: '1.', title: 'Numbered list', on: st.ol, run: () => ed.chain().focus().toggleOrderedList().run() })}
      <span className="sm-sep" />
      {(Object.keys(TAGS) as Tag[]).map(t => <span key={t}>{B({ label: TAGS[t], title: `Mark this line: ${TAGS[t]}`, on: st.tag === t, cls: `sm-t-${t}`, run: () => toggleTag(ed, t) })}</span>)}
      <span className="sm-sep" />
      {B({ label: '↶', title: 'Undo', off: !st.undo, run: () => ed.chain().focus().undo().run() })}
      {B({ label: '↷', title: 'Redo', off: !st.redo, run: () => ed.chain().focus().redo().run() })}
    </div>
  )
}

/* ---------- the quick verse box ---------- */
function VerseAsk({ ctx, onQuote, onLink, onClose }: { ctx: Range | null; onQuote: (r: Range) => void; onLink: (r: Range) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const r = useMemo(() => resolveRef(text, ctx), [text, ctx])
  const n = r ? idsBetween(r.s, r.e).length : 0
  const tooLong = n > MAX_QUOTE
  const prefs = usePrefs()
  const preview = useAsync(async () => (r && !tooLong ? (await quoteOf(r, prefs.translation)).text : ''), [r?.s, r?.e, prefs.translation])
  const online = localTr(prefs.translation) !== prefs.translation
  return (
    <div className="sm-ask" role="dialog" aria-label="Add a verse">
      <div className="sm-ask-row">
        <input autoFocus className="field" value={text} onChange={e => setText(e.target.value)} enterKeyHint="done" autoComplete="off" autoCapitalize="off" spellCheck={false}
          placeholder={ctx ? `Rom 8:28-30, or just 29 for ${formatRef(ctx.s, ctx.s).replace(/:\d+$/, '')}` : 'Rom 8:28-30'}
          aria-label="Verse or passage"
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            if (e.key === 'Enter' && r && !tooLong) { e.preventDefault(); if (e.shiftKey) onLink(r); else onQuote(r) }
          }} />
        <button className="icon-btn small" onClick={onClose} aria-label="Close" style={{ marginLeft: 0 }}>×</button>
      </div>
      {r && !tooLong && (
        <div className="sm-ask-prev">
          <strong>{formatRef(r.s, r.e)}</strong>
          <span>{preview ? (preview.length > 260 ? `${preview.slice(0, 260)}…` : preview) : 'Loading…'}</span>
        </div>
      )}
      {r && tooLong && <p className="sm-ask-hint">That is {n} verses; a quote holds up to {MAX_QUOTE}. Use a shorter range, or link it instead.</p>}
      {text.trim() && !r && <p className="sm-ask-hint">Not a reference yet. Try “Rom 8:28” or “Ps 23”.</p>}
      <div className="sm-ask-actions">
        <button className="primary-btn small" disabled={!r || tooLong} onClick={() => r && onQuote(r)}>Quote it  ↵</button>
        <button className="text-btn small" disabled={!r} onClick={() => r && onLink(r)}>Just the reference  ⇧↵</button>
        {online && <span className="muted small">Quotes use the BSB: {prefs.translation} can't be kept in notes.</span>}
      </div>
    </div>
  )
}

/* ---------- quick look at a tapped reference ---------- */
function Peek({ range, onQuote, onClose }: { range: Range; onQuote: () => void; onClose: () => void }) {
  const prefs = usePrefs()
  const tooLong = idsBetween(range.s, range.e).length > MAX_QUOTE
  const text = useAsync(async () => (tooLong ? '' : (await quoteOf(range, prefs.translation)).text), [range.s, range.e, prefs.translation])
  const s = splitVid(range.s)
  return (
    <div className="sm-peek" role="dialog" aria-label={formatRef(range.s, range.e)}>
      <div className="sm-peek-head"><strong>{formatRef(range.s, range.e)}</strong><button className="icon-btn small" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto' }}>×</button></div>
      <p className="sm-peek-text">{tooLong ? 'A long passage: open it in the reader.' : text === undefined ? 'Loading…' : text}</p>
      <div className="sm-ask-actions">
        {!tooLong && <button className="primary-btn small" onClick={onQuote}>Quote under this line</button>}
        <button className="text-btn small" onClick={() => go({ page: 'read', book: s.b, chapter: s.c, verse: s.v, scope: 'chapter' })}>Open in reader</button>
      </div>
    </div>
  )
}

/* ---------- the preacher's passage, a verse at a time ---------- */
function PassagePanel({ passage, onQuote, open }: { passage: Range; onQuote: (r: Range) => void; open: boolean }) {
  const prefs = usePrefs()
  const verses = useAsync(async () => {
    const ids = idsBetween(passage.s, passage.e).slice(0, 120)
    const out: { id: number; v: number; t: string }[] = []
    const seen = new Map<string, string[]>()
    for (const id of ids) {
      const { b, c, v } = splitVid(id), k = `${b}:${c}`
      if (!seen.has(k)) seen.set(k, await loadChapter(prefs.translation, b, c))
      out.push({ id, v, t: seen.get(k)![v - 1] ?? '' })
    }
    return out
  }, [passage.s, passage.e, prefs.translation])
  const body = (
    <div className="sm-pass">
      {!verses && <p className="muted">Loading…</p>}
      {verses?.map(x => <button key={x.id} className="sm-pv" onClick={() => onQuote({ s: x.id, e: x.id })} title="Quote this verse in your notes"><sup>{x.v}</sup>{x.t} </button>)}
      <p className="muted small">Tap a verse to quote it in your notes.</p>
    </div>
  )
  const label = formatRef(passage.s, passage.e)
  return open
    ? <aside className="sm-side"><h2>{label}</h2>{body}</aside>
    : <details className="sm-details"><summary>The preacher's text · {label}</summary>{body}</details>
}

/* ---------- after the sermon ---------- */
function Review({ note, doc, onWrite }: { note: Note; doc: unknown; onWrite: () => void }) {
  const prefs = usePrefs()
  const [copied, setCopied] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const tagged = blocksOf(doc).filter(b => b.kind === 'tag' && b.text.trim())
  const passage = note.sermon?.passage ?? null
  const refs = useMemo(() => noteRanges([], [...findRefs(`${note.title}\n${plainText(doc)}`), ...(passage ? [passage] : [])]), [doc, note.title, passage])
  async function copy() {
    try { await navigator.clipboard.writeText(toMarkdown({ ...note, sermon: { ...(note.sermon as SermonMeta), doc } })); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* no clipboard */ }
  }
  return (
    <div className="sm-review">
      <div className="sm-actions">
        <button className="primary-btn small" onClick={copy}>{copied ? 'Copied' : 'Copy notes'}</button>
        <button className="text-btn small" onClick={() => window.print()}>Print or save as PDF</button>
        <button className="text-btn small" onClick={onWrite}>Back to writing</button>
      </div>
      {(Object.keys(TAGS) as Tag[]).map(t => {
        const items = tagged.filter(b => b.tag === t)
        return items.length ? (
          <section key={t} className="sm-rsec"><h2>{TAG_TITLES[t]}</h2><ul>{items.map((b, i) => <li key={i}>{b.text}</li>)}</ul></section>
        ) : null
      })}
      {!tagged.length && <p className="muted">Mark lines as Apply, Question or Follow up while you write, and they collect here.</p>}
      <section className="sm-rsec">
        <h2>Scripture in these notes</h2>
        {refs.length ? (
          <ul className="sm-rrefs">
            {refs.map(r => {
              const k = `${r.s}-${r.e}`, n = idsBetween(r.s, r.e).length, s = splitVid(r.s)
              return (
                <li key={k}>
                  <button className="text-btn" onClick={() => go({ page: 'read', book: s.b, chapter: s.c, verse: s.v, scope: 'chapter' })}>{formatRef(r.s, r.e)}</button>
                  {n <= 3
                    ? <button className="text-btn small" disabled={added[k]} onClick={async () => { await addMem(r.s, r.e, localTr(prefs.translation)); setAdded({ ...added, [k]: true }) }}>{added[k] ? 'In Memory' : 'Memorize'}</button>
                    : <span className="muted small">{n} verses</span>}
                </li>
              )
            })}
          </ul>
        ) : <p className="muted">No references yet.</p>}
      </section>
      <p className="muted small">{wordCount(doc)} words</p>
    </div>
  )
}

/* ---------- the page ---------- */
export function SermonNotesPage({ id }: { id: string }) {
  const store = useStore()
  const note = store.notes.find(n => n._id === id && n.kind === 'sermon') ?? null
  if (!note) return (
    <main className="page"><p className="muted">This sermon note isn't on this device (yet).</p><a className="text-btn" href="#/notes">Back to the Notebook</a></main>
  )
  return <SermonEditor key={id} note={note} />
}

function SermonEditor({ note }: { note: Note }) {
  const id = note._id
  const prefs = usePrefs()
  const wide = useMedia('(min-width: 1100px)')
  useKeyboardInset()
  const [title, setTitle] = useState(note.title)
  const [meta, setMeta] = useState<Omit<SermonMeta, 'doc'>>({ speaker: note.sermon?.speaker ?? '', date: note.sermon?.date ?? '', series: note.sermon?.series ?? '', passage: note.sermon?.passage ?? null })
  const [passageText, setPassageText] = useState(note.sermon?.passage ? formatRef(note.sermon.passage.s, note.sermon.passage.e) : '')
  const [category, setCategory] = useState<string | null>(note.category ?? null)
  const [view, setView] = useState<'write' | 'review'>('write')
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [ask, setAsk] = useState(false)
  const [peek, setPeek] = useState<{ range: Range; pos: number } | null>(null)
  const [ctx, setCtx] = useState<Range | null>(note.sermon?.passage ?? null)
  const [reviewDoc, setReviewDoc] = useState<unknown>(note.sermon?.doc ?? null)
  const [notice, setNotice] = useState('')
  const [metaOpen, setMetaOpen] = useState(!note.body.trim() && !note.title.trim())

  const docRef = useRef<unknown>(note.sermon?.doc ?? null)
  const form = useRef({ title, meta, category })
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const onRef = useRef<(r: Range, pos: number) => void>(() => {})
  const openAsk = useRef<() => void>(() => {})
  useEffect(() => {
    form.current = { title, meta, category }
    onRef.current = (range, pos) => { setAsk(false); setPeek({ range, pos }) }
    openAsk.current = () => { setPeek(null); setAsk(a => !a) }
  })

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    setStatus('saving')
    const f = form.current
    await saveSermon(id, { title: f.title, category: f.category, meta: { ...f.meta, doc: docRef.current } })
    if (!dirty.current) setStatus('saved')
  }, [id])
  const touch = useCallback(() => {
    dirty.current = true; setStatus('unsaved')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void flush() }, 700)
  }, [flush])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false, link: false, horizontalRule: false, strike: false }),
      Placeholder.configure({ placeholder: ({ editor: ed, node }) => (node.type.name === 'heading' ? 'Main point' : ed.isEmpty ? 'Type the sermon notes here. Verse adds a passage.' : '') }),
      VerseQuote, Tagged, ScriptureRefs,
    ],
    content: (note.sermon?.doc as object | null) ?? undefined,
    editorProps: {
      // Keep the line you're typing clear of the tool bar (and the keyboard) when the page scrolls to follow it.
      scrollMargin: { top: 90, bottom: 150, left: 0, right: 0 }, scrollThreshold: { top: 90, bottom: 150, left: 0, right: 0 },
      attributes: { class: 'sm-doc', 'aria-label': 'Sermon notes', spellcheck: 'true', autocapitalize: 'sentences' },
      handleClick: (_view, pos, event) => {
        const el = event.target as HTMLElement
        const ref = el.closest('.sm-ref')
        if (ref) { const r = findRefs(ref.textContent ?? '')[0]; if (r) onRef.current(r, pos) }
        const cap = el.closest('figure.sm-verse figcaption')
        if (cap) {
          const fig = cap.closest('figure') as HTMLElement
          const s = splitVid(Number(fig.dataset.s))
          go({ page: 'read', book: s.b, chapter: s.c, verse: s.v, scope: 'chapter' })
          return true
        }
        return false
      },
      handleKeyDown: (_view, e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openAsk.current(); return true }
        return false
      },
    },
    onUpdate: ({ editor: ed }) => { docRef.current = ed.getJSON(); touch() },
  })

  // Save on the way out, and when the app goes to the background.
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') void flush() }
    document.addEventListener('visibilitychange', hide); addEventListener('pagehide', flush as () => void)
    return () => {
      document.removeEventListener('visibilitychange', hide); removeEventListener('pagehide', flush as () => void)
      void flush().then(() => setTimeout(() => dropIfEmpty(id), 400))
    }
  }, [flush, id])

  async function insertQuote(r: Range, at?: number) {
    if (!editor) return
    let q: { text: string; tr: string }
    try { q = await quoteOf(r, prefs.translation) } catch { q = { text: '', tr: '' } }
    if (!q.text) { setNotice("Couldn't load that passage. Check your connection, or use Just the reference."); setTimeout(() => setNotice(''), 5000); return }
    const node = { type: 'verseQuote', attrs: { s: r.s, e: r.e, tr: q.tr, text: q.text, label: formatRef(r.s, r.e) } }
    const doc = editor.state.doc
    let target: number | { from: number; to: number }
    if (at != null) {
      const $p = doc.resolve(Math.min(at, doc.content.size))
      target = $p.depth ? $p.after(1) : $p.pos
    } else {
      const { $to } = editor.state.selection
      const top = $to.depth ? $to.node(1) : null
      target = top && top.type.name === 'paragraph' && top.content.size === 0 ? { from: $to.before(1), to: $to.after(1) } : $to.depth ? $to.after(1) : $to.pos
    }
    editor.chain().insertContentAt(target, [node, { type: 'paragraph' }]).focus().run()
    setCtx(r); setAsk(false); setPeek(null)
  }
  function insertLink(r: Range) {
    if (!editor) return
    editor.chain().focus().insertContent(`${formatRef(r.s, r.e)} `).run()
    setCtx(r); setAsk(false)
  }

  function commitPassage() {
    const t = passageText.trim()
    const p = t ? parseQuery(t) : null
    setMeta(m => ({ ...m, passage: p })); setPassageText(p ? formatRef(p.s, p.e) : t)
    if (p) setCtx(p)
    touch()
  }
  const setField = (k: 'speaker' | 'date' | 'series', v: string) => { setMeta(m => ({ ...m, [k]: v })); touch() }

  function switchView(v: 'write' | 'review') {
    if (v === 'review') { setReviewDoc(docRef.current); setAsk(false); setPeek(null); void flush() }
    setView(v)
  }
  const liveNote: Note = useMemo(() => ({ ...note, title, sermon: { ...(note.sermon as SermonMeta), ...meta, doc: reviewDoc } }), [note, title, meta, reviewDoc])
  const speakers = sermonValues('speaker'), series = sermonValues('series')
  const passage = meta.passage

  return (
    <main className={`page sermon-page ${wide && passage && view === 'write' ? 'has-side' : ''}`}>
      <div className="sm-top">
        <div className="seg small" role="tablist" aria-label="Sermon notes view">
          <button role="tab" aria-selected={view === 'write'} className={view === 'write' ? 'is-on' : ''} onClick={() => switchView('write')}>Write</button>
          <button role="tab" aria-selected={view === 'review'} className={view === 'review' ? 'is-on' : ''} onClick={() => switchView('review')}>Review</button>
        </div>
        <span className="sm-status muted small" aria-live="polite">{notice || (status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Editing…')}</span>
      </div>

      <input className="sm-title" value={title} onChange={e => { setTitle(e.target.value); touch() }} placeholder="Sermon title" aria-label="Sermon title" autoFocus={!note.title && !note.body} />
      {!wide && (
        <button className="sm-metabtn" onClick={() => setMetaOpen(o => !o)} aria-expanded={metaOpen}>
          <span>{[meta.speaker, meta.date && new Date(`${meta.date}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), passage ? formatRef(passage.s, passage.e, true) : '', meta.series].filter(Boolean).join(' · ') || 'Speaker, date, passage'}</span>
          <span aria-hidden="true">{metaOpen ? '▴' : '▾'}</span>
        </button>
      )}
      <div className="sm-meta" hidden={!wide && !metaOpen}>
        <label>Speaker<input className="field" list="sm-speakers" value={meta.speaker} onChange={e => setField('speaker', e.target.value)} placeholder="Who is preaching" /></label>
        <label>Date<input className="field" type="date" value={meta.date} onChange={e => setField('date', e.target.value)} /></label>
        <label>Passage<input className="field" value={passageText} onChange={e => setPassageText(e.target.value)} onBlur={commitPassage} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="e.g. Romans 8:28-39" /></label>
        <label>Series<input className="field" list="sm-series" value={meta.series} onChange={e => setField('series', e.target.value)} placeholder="Optional" /></label>
        <div className="sm-cat"><CategoryPicker value={category} onChange={v => { setCategory(v); touch() }} /></div>
        <datalist id="sm-speakers">{speakers.map(s => <option key={s} value={s} />)}</datalist>
        <datalist id="sm-series">{series.map(s => <option key={s} value={s} />)}</datalist>
      </div>

      {view === 'write' ? (
        <div className="sm-cols">
          <div className="sm-main">
            {passage && !wide && <PassagePanel passage={passage} open={false} onQuote={r => insertQuote(r)} />}
            <EditorContent editor={editor} />
          </div>
          {passage && wide && <PassagePanel passage={passage} open onQuote={r => insertQuote(r)} />}
        </div>
      ) : <Review note={liveNote} doc={reviewDoc} onWrite={() => switchView('write')} />}

      {view === 'write' && editor && (
        <>
          {peek && <Peek range={peek.range} onClose={() => setPeek(null)} onQuote={() => insertQuote(peek.range, peek.pos)} />}
          {ask && <VerseAsk ctx={ctx} onClose={() => { setAsk(false); editor.commands.focus() }} onQuote={r => insertQuote(r)} onLink={insertLink} />}
          <Toolbar ed={editor} verseOpen={ask} onVerse={() => openAsk.current()} />
        </>
      )}
    </main>
  )
}


