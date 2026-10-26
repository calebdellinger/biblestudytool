import { useEffect, useMemo, useState } from 'react'
import { bookById, crossRefs, formatRef, localTr, splitVid, TRANSLATIONS, verseText, type Translation } from '../lib/bible'
import { isOnlineTr, ONLINE } from '../lib/apiBible'
import { HIGHLIGHT_COLORS, deleteMark, marksForVerse, notesFor, notesForMark, saveMark, setRangeColor, wholeRangeMark, type HighlightColor, type Mark, type Note } from '../lib/db'
import { openNote } from '../lib/ui'
import { goToMark } from './Annotate'
import { go, useAsync, useStore, type Prefs } from '../lib/hooks'
import { IconCheck, IconClose, IconPlus } from './Icons'
import { NoteCard } from './Notes'
import { VerseWords, WordDetail } from './Interlinear'
import { SpurgeonTab, useSpurgeonCount } from './Spurgeon'
import { TheologiansTab, useTheoCount } from './Theologians'
import { CommentaryTab } from './Commentary'
import { ContextTab } from './Context'
import { MemorizeButton } from './Memory'

export type Tool = 'mine' | 'voices' | 'context' | 'words'
type Props = {
  verses: number[]; focus: number; onFocus: (v: number) => void; tool: Tool
  prefs: Prefs; onClose: () => void; asSheet: boolean; focusWord?: number | null
}
type Tab = 'spurgeon' | 'theo' | 'commentary' | 'orig' | 'xrefs' | 'compare'

const COLOR_NAMES: Record<HighlightColor, string> = { amber: 'Amber', sage: 'Sage', sky: 'Sky', rose: 'Rose', iris: 'Iris' }
export const TOOL_NAMES: Record<Tool, string> = { mine: 'Notes', voices: 'Commentary', context: 'Context', words: 'Words' }

/** Picked verses as runs of consecutive verses: [28, 29, 30, 34] → 28–30 and 34. */
export function runsOf(ids: number[]): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = []
  for (const id of [...ids].sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && id === last.e + 1) last.e = id; else out.push({ s: id, e: id })
  }
  return out
}
export const runsLabel = (ids: number[]) => {
  const runs = runsOf(ids)
  if (!runs.length) return ''
  const first = formatRef(runs[0].s, runs[0].e)
  return [first, ...runs.slice(1).map(r => (r.s === r.e ? `${r.s % 1000}` : `${r.s % 1000}–${r.e % 1000}`))].join(', ')
}

export function Panel({ verses, focus, onFocus, tool, prefs, onClose, asSheet, focusWord }: Props) {
  const verse = focus
  const [tab, setTab] = useState<Tab>(tool === 'words' ? 'orig' : 'spurgeon')
  const [word, setWord] = useState<number | null>(null)
  useEffect(() => { setTab(tool === 'words' ? 'orig' : 'spurgeon') }, [tool])
  useEffect(() => {
    if (focusWord != null) { setTab('orig'); setWord(focusWord) } else setWord(null)
  }, [verse, focusWord])
  const refs = useAsync(() => crossRefs(verse), [verse])
  const text = useAsync(() => verseText(prefs.translation, verse), [verse, prefs.translation])
  const spCount = useSpurgeonCount(verse)
  const theoCount = useTheoCount(verse)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.note-sheet, .sel-toolbar')) onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs: { id: Tab; label: string; count?: number }[] = tool === 'voices'
    ? [{ id: 'spurgeon', label: 'Spurgeon', count: spCount }, { id: 'theo', label: 'Theologians', count: theoCount }, { id: 'commentary', label: 'Commentaries' }]
    : tool === 'words'
      ? [{ id: 'orig', label: Math.floor(verse / 1_000_000) <= 39 ? 'Hebrew' : 'Greek' }, { id: 'xrefs', label: 'Cross-references', count: refs?.length }, { id: 'compare', label: 'Compare' }]
      : []
  const many = verses.length > 1

  return (
    <aside className={`panel tool-${tool} ${asSheet ? 'as-sheet' : ''}`} aria-label={`${TOOL_NAMES[tool]}: ${tool === 'mine' ? runsLabel(verses) : formatRef(verse)}`}>
      {asSheet && <div className="sheet-handle" aria-hidden="true" />}
      <header className="panel-head">
        <div>
          <p className="panel-kicker">{TOOL_NAMES[tool]}</p>
          <h2 className="panel-ref">{tool === 'mine' ? runsLabel(verses) : formatRef(verse)}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>
      {many && tool !== 'mine' && (
        <div className="focus-chips" role="group" aria-label="Which verse">
          {[...verses].sort((a, b) => a - b).map(v => (
            <button key={v} className={v === verse ? 'is-on' : ''} aria-pressed={v === verse} onClick={() => onFocus(v)}>{v % 1000}</button>
          ))}
        </div>
      )}
      {asSheet && !many && text && tool !== 'context' && <p className="panel-verse">{text}</p>}

      {tool === 'mine' && <MineActions verses={verses} prefs={prefs} />}

      {tabs.length > 0 && (
        <div className="tabs" role="tablist">
          {tabs.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
              {t.label}{t.count ? <span className="tab-count">{t.count}</span> : null}
            </button>
          ))}
        </div>
      )}

      <div className="panel-body">
        {tool === 'mine' && <MineTab verse={verse} verses={verses} />}
        {tool === 'context' && <ContextTab verse={verse} />}
        {tool === 'voices' && tab === 'spurgeon' && <SpurgeonTab verse={verse} />}
        {tool === 'voices' && tab === 'theo' && <TheologiansTab verse={verse} />}
        {tool === 'voices' && tab === 'commentary' && <CommentaryTab verse={verse} />}

        {tool === 'words' && tab === 'orig' && (
          <div className="orig-tab">
            <VerseWords verse={verse} selected={word} onPick={i => setWord(word === i ? null : i)} />
            {word == null
              ? <p className="hint orig-hint">Tap a word to see its meaning, grammar and where else it's used.</p>
              : <WordDetail verse={verse} index={word} tr={prefs.translation} onClose={() => setWord(null)} />}
          </div>
        )}

        {tool === 'words' && tab === 'xrefs' && (
          <ol className="xrefs">
            {refs === undefined && <li className="muted">Loading…</li>}
            {refs?.length === 0 && <li className="empty"><p>No cross-references for this verse.</p></li>}
            {refs?.map(([s, e]) => <XRefItem key={`${s}-${e}`} s={s} e={e} tr={prefs.translation} />)}
          </ol>
        )}

        {tool === 'words' && tab === 'compare' && (
          <div className="compare">
            {[prefs.translation, ...TRANSLATIONS.map(t => t.id).filter(t => t !== prefs.translation)].map(t => <CompareItem key={t} tr={t as Translation} verse={verse} current={t === prefs.translation} />)}
            {TRANSLATIONS.some(t => t.online) && <p className="tr-copyright">{Object.values(ONLINE).map(o => o.copyright).join(' ')}</p>}
          </div>
        )}
      </div>
    </aside>
  )
}

/** Highlight colour, note and memorize for everything picked. */
function MineActions({ verses, prefs }: { verses: number[]; prefs: Prefs }) {
  useStore()
  const runs = runsOf(verses)
  const colorOf = (r: { s: number; e: number }) => wholeRangeMark(r.s, r.e)?.color ?? null
  const shared = runs.every(r => colorOf(r) === colorOf(runs[0])) ? colorOf(runs[0]) : null
  const oneRun = runs.length === 1 && runs[0].e - runs[0].s < 4
  async function paint(c: HighlightColor) {
    const next = shared === c ? null : c
    for (const r of runs) await setRangeColor(r.s, r.e, next, prefs.translation)
  }
  function note() {
    const anchors = runs.map(r => wholeRangeMark(r.s, r.e)).filter(Boolean).map(m => m!._id)
    if (anchors.length === runs.length) openNote(null, anchors)
    else openNote(null, [], runs)
  }
  return (
    <div className="swatches" role="group" aria-label="Highlight">
      {HIGHLIGHT_COLORS.map(c => (
        <button key={c} className={`swatch swatch-${c}`} aria-pressed={shared === c}
          aria-label={shared === c ? `Remove ${COLOR_NAMES[c]} highlight` : `Highlight ${COLOR_NAMES[c]}`} onClick={() => paint(c)}>
          {shared === c && <IconCheck size={14} />}
        </button>
      ))}
      <button className="add-note-btn" onClick={note}><IconPlus size={16} />Note</button>
      {oneRun && <MemorizeButton s={runs[0].s} e={runs[0].e} tr={prefs.translation} />}
    </div>
  )
}

function CompareItem({ tr, verse, current }: { tr: Translation; verse: number; current: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let live = true
    setText(null); setErr(false)
    verseText(tr, verse).then(t => { if (live) setText(t) }).catch(() => { if (live) setErr(true) })
    return () => { live = false }
  }, [tr, verse])
  return (
    <figure className={current ? 'is-current' : ''}>
      <figcaption>{tr}{isOnlineTr(tr) ? <span className="muted"> · online</span> : null}</figcaption>
      <blockquote>{err ? <span className="muted">Not available right now (needs your PC, or an API.Bible key on this device).</span> : text ?? '…'}</blockquote>
    </figure>
  )
}

function XRefItem({ s, e, tr: chosen }: { s: number; e: number; tr: Translation }) {
  const tr = localTr(chosen)
  const text = useAsync(async () => {
    const first = await verseText(tr, s)
    return s === e ? first : `${first} …`
  }, [s, e, tr])
  const { b, c, v } = splitVid(s)
  return (
    <li>
      <button className="xref" onClick={() => go({ page: 'read', book: b, chapter: c, verse: v, scope: 'chapter' })}>
        <span className="xref-ref">{formatRef(s, e)}</span>
        <span className="xref-text">{text}</span>
      </button>
    </li>
  )
}

/** Your highlights and notes on the picked verses, from the narrowest (one verse) to the broadest (the chapter). */
function MineTab({ verse, verses }: { verse: number; verses: number[] }) {
  const store = useStore()
  const notes = useMemo(() => {
    const seen = new Map<string, Note>()
    for (const v of verses) for (const n of notesFor(v)) seen.set(n._id, n)
    return [...seen.values()]
  }, [verses, store.notes]) // eslint-disable-line react-hooks/exhaustive-deps
  const marks = useMemo(() => {
    const seen = new Map<string, Mark>()
    for (const v of verses) for (const m of marksForVerse(v)) seen.set(m._id, m)
    return [...seen.values()]
  }, [verses, store.marks]) // eslint-disable-line react-hooks/exhaustive-deps
  const narrowest = (n: Note) => n.refs.filter(r => verses.some(v => r.s <= v && v <= r.e)).sort((a, b) => (a.e - a.s) - (b.e - b.s))[0]
  const kind = (n: Note) => {
    const r = narrowest(n)
    if (!r || r.s === r.e) return 'verse'
    const sameChapter = Math.floor(r.s / 1000) === Math.floor(r.e / 1000)
    const last = bookById(Math.floor(r.s / 1_000_000))?.verses[Math.floor((r.s % 1_000_000) / 1000) - 1] ?? 0
    return sameChapter && !(r.s % 1000 === 1 && r.e % 1000 >= last) ? 'passage' : 'broad'
  }
  const groups = [
    { title: verses.length > 1 ? 'On single verses' : 'On this verse', list: notes.filter(n => kind(n) === 'verse') },
    { title: 'On this passage', list: notes.filter(n => kind(n) === 'passage') },
    { title: 'On the chapter and wider', list: notes.filter(n => kind(n) === 'broad') },
  ].filter(g => g.list.length)
  // Highlights without notes: partial highlights here, and Spurgeon highlights you linked to this verse.
  const loose = marks.filter(m => !notesForMark(m._id).length && (m.src.kind === 'text' || m.src.so !== 0 || m.src.eo !== -1))
  void verse
  return (
    <div className="notes-tab">
      {groups.map(g => (
        <section key={g.title} className="mine-group">
          <h3 className="mine-h">{g.title}</h3>
          {g.list.map(n => <NoteCard key={n._id} note={n} />)}
        </section>
      ))}
      {loose.length > 0 && (
        <section className="mine-group">
          <h3 className="mine-h">Highlights</h3>
          {loose.map(m => <LooseMark key={m._id} m={m} />)}
        </section>
      )}
      {!notes.length && !loose.length && (
        <div className="empty">
          <p>Nothing of yours here yet. Pick a colour above to highlight, or press and drag over a few words to mark just those.</p>
          <button className="text-btn" onClick={() => openNote(null, [], runsOf(verses))}>Write a note on {verses.length > 1 ? 'these verses' : 'this verse'}</button>
        </div>
      )}
    </div>
  )
}

function LooseMark({ m }: { m: Mark }) {
  const label = m.src.kind === 'bible' ? formatRef(m.src.s, m.src.e) : m.src.label
  return (
    <figure className={`anchor ${m.color ? `anchor-${m.color}` : ''}`}>
      {m.quote && <blockquote>{m.quote.length > 220 ? `${m.quote.slice(0, 220)}…` : m.quote}</blockquote>}
      <figcaption>
        <button className="anchor-src" onClick={() => goToMark(m)}>{label}</button>
        <span className="anchor-actions">
          <button className="text-btn small" onClick={() => openNote(null, [m._id])}>Add note</button>
          {m.src.kind === 'text' && m.links.length > 0
            ? <button className="text-btn small muted-btn" onClick={() => saveMark({ ...m, links: [] })}>Unlink</button>
            : <button className="text-btn small muted-btn" onClick={() => deleteMark(m)}>Remove</button>}
        </span>
      </figcaption>
    </figure>
  )
}
