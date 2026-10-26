import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkRead } from './MarkRead'
import { useReadingTime } from '../lib/reading'
import { bookById, chapterName, formatRef, loadBook, loadBooks, loadChapter, vid, type Translation } from '../lib/bible'
import { isOnlineTr, ONLINE, onlineChapter, reportView } from '../lib/apiBible'
import { useAsync, useStore, go, setPrefs, type Prefs } from '../lib/hooks'
import { VerseWords } from './Interlinear'
import { marksInChapter, notesInRange, type Scope } from '../lib/db'
import { bibleSrcFrom, useSelectionCapture, VerseText } from './Annotate'
import { NoteCard } from './Notes'
import { openNote } from '../lib/ui'
import { IconLeft, IconRight } from './Icons'
import { BookIntro } from './BookIntro'
import { sectionOf } from '../lib/intro'
import { useRedLetters } from '../lib/redletter'
import { useChapterVoices, type ChapterVoices } from '../lib/speakers'

type Props = {
  book: number; chapter: number; verse: number | null; scope: Scope
  prefs: Prefs; selected: number | null; onSelect: (id: number | null) => void
  picked: number[]; onToggle: (id: number) => void
  onWord?: (verse: number, index: number) => void
}

export function Reader(p: Props) {
  const voices = useChapterVoices(p.prefs.translation, p.book, p.chapter)
  return (
    <div className="reader" style={{ '--text-size': `${p.prefs.textSize}px` } as React.CSSProperties}>
      <div className="reader-tools">
        <ScopeSwitch {...p} />
        {p.scope !== 'book' && voices && (
          <button className={`toggle-chip ${p.prefs.speakers !== false ? 'is-on' : ''}`} aria-pressed={p.prefs.speakers !== false}
            onClick={() => setPrefs({ speakers: p.prefs.speakers === false })} title="Colour each speaker's words">
            Speakers
          </button>
        )}
        {p.scope === 'chapter' && (
          <button className={`toggle-chip ${p.prefs.interlinear ? 'is-on' : ''}`} aria-pressed={p.prefs.interlinear}
            onClick={() => setPrefs({ interlinear: !p.prefs.interlinear })}>
            {p.book <= 39 ? 'Hebrew' : 'Greek'}
          </button>
        )}
      </div>
      {p.scope === 'book' ? <BookView {...p} /> : p.scope === 'verse' ? <VerseView {...p} /> : <ChapterView {...p} />}
    </div>
  )
}

// The last verse you tapped, so "Verse" opens it even after you've closed the study panel.
let lastPicked: number | null = null
function ScopeSwitch({ book, chapter, verse, scope, selected }: Props) {
  if (selected) lastPicked = selected
  const here = lastPicked && Math.floor(lastPicked / 1000) === book * 1000 + chapter ? lastPicked % 1000 : null
  const v = selected ? selected % 1000 : verse ?? here
  const opts: { id: Scope; label: string }[] = [
    { id: 'verse', label: 'Verse' }, { id: 'chapter', label: 'Chapter' }, { id: 'book', label: 'Book' },
  ]
  return (
    <div className="scope" role="tablist" aria-label="How much to show">
      {opts.map(o => (
        <button key={o.id} role="tab" aria-selected={scope === o.id} className={scope === o.id ? 'is-on' : ''}
          onClick={() => go({ page: 'read', book, chapter, verse: o.id === 'book' ? null : (v ?? (o.id === 'verse' ? 1 : null)), scope: o.id })}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function useChapterNav(book: number, chapter: number) {
  const b = bookById(book)
  const prev = chapter > 1 ? { book, chapter: chapter - 1 }
    : book > 1 ? { book: book - 1, chapter: bookById(book - 1)!.verses.length } : null
  const next = b && chapter < b.verses.length ? { book, chapter: chapter + 1 }
    : book < 66 ? { book: book + 1, chapter: 1 } : null
  return { prev, next }
}

/** A chapter's verses in the chosen translation, plus red letters for the online ones (which come with the text). */
function useChapterText(tr: Translation, book: number, chapter: number, redOn: boolean) {
  const [st, setSt] = useState<{ verses?: string[]; red?: Record<number, [number, number][]>; error?: string }>({})
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setSt({})
    const fail = (e: unknown) => { if (live) setSt({ error: e instanceof Error ? e.message : String(e) }) }
    if (isOnlineTr(tr)) {
      loadBooks().then(() => onlineChapter(tr, book, chapter, bookById(book)?.verses[chapter - 1] ?? 0))
        .then(ch => { if (live) { setSt({ verses: ch.verses, red: ch.red }); reportView(ch.fums) } }).catch(fail)
    } else loadChapter(tr, book, chapter).then(v => { if (live) setSt({ verses: v }) }).catch(fail)
    return () => { live = false }
  }, [tr, book, chapter, retry])
  const local = useRedLetters(tr, redOn && !isOnlineTr(tr))
  return { verses: st.verses, error: st.error, retry: () => setRetry(r => r + 1), rl: isOnlineTr(tr) ? (redOn ? st.red ?? null : null) : local }
}
function ChapterError({ msg, retry }: { msg: string; retry: () => void }) {
  return <div className="empty chapter-error"><span>{msg}</span><button className="text-btn" onClick={retry}>Try again</button></div>
}
export function TrCopyright({ tr }: { tr: string }) {
  return isOnlineTr(tr) ? <p className="tr-copyright">{ONLINE[tr].copyright}</p> : null
}

function ChapterView({ book, chapter, verse, prefs, picked, onToggle, onWord }: Props) {
  const store = useStore()
  const b = bookById(book)
  const { prev, next } = useChapterNav(book, chapter)
  const { verses, error, retry, rl } = useChapterText(prefs.translation as Translation, book, chapter, prefs.redLetter !== false && book >= 40)
  const marks = useMemo(() => marksInChapter(book, chapter), [book, chapter, store.marks]) // eslint-disable-line react-hooks/exhaustive-deps
  const cv = useChapterVoices(prefs.translation, book, chapter)
  const voices = prefs.speakers !== false ? cv : null
  const first = vid(book, chapter, 1), last = vid(book, chapter, verses?.length ?? 1)
  // Notes whose passage covers the whole chapter (or more) are shown up top instead of at the last verse.
  const chapterNotes = useMemo(() => notesInRange(first, last).filter(n => n.refs.some(r => r.s <= first && r.e >= last)), [store.notes, first, last]) // eslint-disable-line react-hooks/exhaustive-deps
  const legacyNoted = useMemo(() => {
    const set = new Set<number>()
    for (const n of notesInRange(first, last)) if (!n.anchors?.length) for (const r of n.refs) set.add(r.e)
    return set
  }, [store.notes, first, last]) // eslint-disable-line react-hooks/exhaustive-deps
  const [showChapterNotes, setShowChapterNotes] = useState(false)
  const [focus, setFocus] = useState<number | null>(null)
  useEffect(() => setFocus(null), [book, chapter])
  const root = useRef<HTMLDivElement>(null)
  const toSrc = useMemo(() => bibleSrcFrom(prefs.translation), [prefs.translation])
  useSelectionCapture(root, toSrc, '.vt')
  useReadingTime(`b:${book}.${chapter}`)

  // Scroll to the verse in the address, once the text is there.
  useEffect(() => {
    if (!verses) return
    if (verse) {
      const el = root.current?.querySelector(`[data-v="${verse}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    } else window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [verses, verse, book, chapter])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, dialog')) return
      if (e.key === 'ArrowLeft' && prev) go({ page: 'read', ...prev, verse: null, scope: 'chapter' })
      if (e.key === 'ArrowRight' && next) go({ page: 'read', ...next, verse: null, scope: 'chapter' })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [prev, next])

  if (!b) return null
  return (
    <article className={`chapter layout-${prefs.layout}`} ref={root} lang="en">
      <header className="chapter-head">
        <p className="chapter-book">{b.name}</p>
        <div className="chapter-actions">
          {chapterNotes.length > 0 && (
            <button className="chip chip-link" onClick={() => setShowChapterNotes(!showChapterNotes)} aria-expanded={showChapterNotes}>
              {chapterNotes.length} {chapterNotes.length === 1 ? 'chapter note' : 'chapter notes'}
            </button>
          )}
          <button className="quiet-action" onClick={() => openNote(null, [], [{ s: first, e: last }])}>Note on {chapterName(book)} {chapter}</button>
        </div>
      </header>
      {voices && <SpeakersKey cv={voices} focus={focus} onFocus={setFocus} />}
      {showChapterNotes && <div className="chapter-notes">{chapterNotes.map(n => <NoteCard key={n._id} note={n} />)}</div>}
      {error ? <ChapterError msg={error} retry={retry} /> : !verses ? <div className="loading-lines" aria-label="Loading"><span /><span /><span /><span /></div> : (
        prefs.interlinear ? (
          <div className="scripture interlinear">
            <span className="drop-numeral" aria-label={`Chapter ${chapter}`}>{chapter}</span>
            {verses.map((text, i) => {
              const id = vid(book, chapter, i + 1)
              return (
                <section key={id} className={`il-verse ${picked.includes(id) ? 'is-selected' : ''}`} data-v={i + 1}>
                  <p className="il-english" onClick={() => { if (window.getSelection()?.isCollapsed !== false) onToggle(id) }}>
                    <sup className="vnum">{i + 1}</sup><VerseText id={id} text={text} tr={prefs.translation} marks={marks} red={rl?.[id]} voices={voices?.v[String(id % 1000)]} />
                  </p>
                  <VerseWords verse={id} compact onPick={w => onWord?.(id, w)} />
                </section>
              )
            })}
          </div>
        ) : (
        <div className="scripture" data-focus={voices && focus != null ? focus : undefined}>
          <span className="drop-numeral" aria-label={`Chapter ${chapter}`}>{chapter}</span>
          {verses.map((text, i) => {
            const id = vid(book, chapter, i + 1)
            const cls = ['verse', picked.includes(id) ? 'is-selected' : '', legacyNoted.has(id) ? 'has-note' : ''].join(' ')
            return (
              <span key={id} className={cls} data-v={i + 1} tabIndex={0} role="button"
                aria-label={`Verse ${i + 1}`} aria-pressed={picked.includes(id)}
                onClick={e => {
                  if (window.getSelection()?.isCollapsed === false) return
                  if ((e.target as HTMLElement).closest('.note-dot')) return
                  onToggle(id)
                }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(id) } }}>
                {i > 0 && <sup className="vnum">{i + 1}</sup>}
                <VerseText id={id} text={text} tr={prefs.translation} marks={marks} red={rl?.[id]} voices={voices?.v[String(id % 1000)]} />{' '}
              </span>
            )
          })}
        </div>
        )
      )}
      {verses && <TrCopyright tr={prefs.translation} />}
      {verses && <MarkRead k={`b:${book}.${chapter}`} what={`${chapterName(book)} ${chapter}`} />}
      <nav className="chapter-nav">
        {prev ? <a href={`#/read/${prev.book}/${prev.chapter}`} className="chapter-nav-link"><IconLeft size={18} />{chapterName(prev.book)} {prev.chapter}</a> : <span />}
        {next ? <a href={`#/read/${next.book}/${next.chapter}`} className="chapter-nav-link">{chapterName(next.book)} {next.chapter}<IconRight size={18} /></a> : <span />}
      </nav>
    </article>
  )
}

function VerseView({ book, chapter, verse, prefs, selected, onSelect, picked, onToggle }: Props) {
  const { verses, error, retry, rl } = useChapterText(prefs.translation as Translation, book, chapter, prefs.redLetter !== false && book >= 40)
  const store = useStore()
  const b = bookById(book)
  const v = verse ?? 1
  const marks = useMemo(() => marksInChapter(book, chapter), [book, chapter, store.marks]) // eslint-disable-line react-hooks/exhaustive-deps
  const cv = useChapterVoices(prefs.translation, book, chapter)
  const voices = prefs.speakers !== false ? cv : null
  const focusRoot = useRef<HTMLElement>(null)
  const toSrc = useMemo(() => bibleSrcFrom(prefs.translation), [prefs.translation])
  useSelectionCapture(focusRoot, toSrc, '.vt')
  useReadingTime(`b:${book}.${chapter}`)
  const id = vid(book, chapter, v)
  // Verse view starts clean. Tap the verse to open the study panel; stepping verses keeps it open if it was.
  useEffect(() => { if (selected && selected !== id) onSelect(id) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { if (window.getSelection()?.isCollapsed !== false) onToggle(id) }
  if (error) return <ChapterError msg={error} retry={retry} />
  if (!b || !verses) return <div className="loading-lines"><span /><span /></div>
  const count = verses.length
  const to = (nv: number) => {
    if (nv < 1) {
      if (chapter > 1) go({ page: 'read', book, chapter: chapter - 1, verse: b.verses[chapter - 2], scope: 'verse' }, true)
    } else if (nv > count) {
      if (chapter < b.verses.length) go({ page: 'read', book, chapter: chapter + 1, verse: 1, scope: 'verse' }, true)
    } else go({ page: 'read', book, chapter, verse: nv, scope: 'verse' }, true)
  }
  return (
    <article className="verse-focus" ref={focusRoot}>
      <p className="verse-focus-ref">{formatRef(id)}</p>
      {voices && voices.v[String(v)] && <SpeakersKey cv={{ ...voices, people: voices.people }} focus={null} onFocus={() => {}} />}
      {v > 1 && <p className="verse-context">{verses[v - 2]}</p>}
      <p className={`verse-focus-text ${picked.includes(id) ? 'is-picked' : ''}`} role="button" tabIndex={0} aria-pressed={picked.includes(id)}
        aria-label={picked.includes(id) ? 'Unmark this verse' : 'Mark this verse for study'} onClick={toggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}><VerseText id={id} text={verses[v - 1]} tr={prefs.translation} marks={marks} red={rl?.[id]} voices={voices?.v[String(id % 1000)]} /></p>
      {v < count && <p className="verse-context">{verses[v]}</p>}
      <nav className="verse-steps">
        <button className="ghost-btn" onClick={() => to(v - 1)} disabled={v === 1 && chapter === 1}><IconLeft size={18} />Previous verse</button>
        <button className="ghost-btn" onClick={() => to(v + 1)} disabled={v === count && chapter === b.verses.length}>Next verse<IconRight size={18} /></button>
      </nav>
      <TrCopyright tr={prefs.translation} />
    </article>
  )
}

function BookView({ book, prefs }: Props) {
  const chapters = useAsync(() => loadBook(prefs.translation as Translation, book), [book, prefs.translation])
  const store = useStore()
  const b = bookById(book)
  const counts = useMemo(() => {
    const m = new Map<number, number>()
    for (const n of notesInRange(vid(book, 1, 1), vid(book, 999, 999)))
      for (const r of n.refs) {
        const c = Math.floor((r.s % 1_000_000) / 1000)
        if (Math.floor(r.s / 1_000_000) === book) m.set(c, (m.get(c) ?? 0) + 1)
      }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, store.notes])
  if (!b) return null
  const total = b.verses.reduce((a, n) => a + n, 0)
  const noteTotal = [...counts.values()].reduce((a, n) => a + n, 0)
  return (
    <article className="book-view">
      <header className="book-view-head">
        <p className="bv-section">{sectionOf(book).name}<span> · {b.testament === 'OT' ? 'Old' : 'New'} Testament</span></p>
        <h1>{b.name}</h1>
        <p>{b.verses.length} {b.verses.length === 1 ? 'chapter' : 'chapters'}, {total.toLocaleString()} verses{noteTotal ? `, ${noteTotal} of your notes` : ''}</p>
      </header>
      <BookIntro book={book} />
      <ol className="book-outline">
        {b.verses.map((_, i) => (
          <li key={i}>
            <a href={`#/read/${book}/${i + 1}`} className="outline-row">
              <span className="outline-num">{i + 1}</span>
              <span className="outline-text">{chapters?.[i]?.[0] ?? ''}</span>
              {counts.get(i + 1) ? <span className="outline-notes">{counts.get(i + 1)} {counts.get(i + 1) === 1 ? 'note' : 'notes'}</span> : null}
            </a>
          </li>
        ))}
      </ol>
    </article>
  )
}

/** The little key of who's speaking in this chapter. Tap a name to follow just that person. */
function SpeakersKey({ cv, focus, onFocus }: { cv: ChapterVoices; focus: number | null; onFocus: (k: number | null) => void }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('margin.speakersKey') !== 'closed' } catch { return true } })
  const toggle = () => {
    setOpen(o => { try { localStorage.setItem('margin.speakersKey', o ? 'closed' : 'open') } catch { /* ignore */ } return !o })
    if (open) onFocus(null)
  }
  if (!cv.people.length) return null
  return (
    <div className={`speakers-key ${open ? 'is-open' : ''}`}>
      <button className="sk-toggle" aria-expanded={open} onClick={toggle}>
        <span className="sk-dots" aria-hidden="true">{cv.people.slice(0, 8).map((_, k) => <span key={k} className={`sk-dot vo-${k % 8}`} />)}</span>
        {open ? 'Who\'s speaking' : `${cv.people.length} ${cv.people.length === 1 ? 'speaker' : 'speakers'}`}
      </button>
      {open && (
        <ul className="sk-list">
          {cv.people.map(([id, name], k) => (
            <li key={id}>
              <button className={`sk-person vo-${k % 8} ${focus === k ? 'is-on' : ''}`} aria-pressed={focus === k}
                onClick={() => onFocus(focus === k ? null : k)} title={focus === k ? 'Show everyone' : `Follow ${name}`}>
                <span className={`sk-dot vo-${k % 8}`} />{name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
