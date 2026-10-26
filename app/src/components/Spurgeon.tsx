import { useEffect, useMemo, useRef, useState } from 'react'
import { books, formatRef, splitVid } from '../lib/bible'
import {
  dateLabel, loadSermons, loadTod, readingsFor, renderSpurgeon, searchSpurgeon, sermonById,
  sermonsFor, sermonsInChapter, sermonText, todFor, type Reading, type Sermon,
} from '../lib/spurgeon'
import { go, useAsync } from '../lib/hooks'
import { openNote } from '../lib/ui'
import { AnnotatedHtml } from './Annotate'
import { IconLeft, IconRight, IconSearch } from './Icons'
import { AuthorShelf, useLibrary } from './Theologians'
import { MarkRead } from './MarkRead'
import { useReadingTime } from '../lib/reading'


/* ---------------- verse panel tab ---------------- */

export function useSpurgeonCount(verse: number) {
  return useAsync(async () => {
    const [s, r, t] = await Promise.all([sermonsFor(verse), readingsFor(verse), todFor(verse)])
    return s.length + r.length + (t?.exposition.length ? 1 : 0)
  }, [verse])
}

export function SpurgeonTab({ verse }: { verse: number }) {
  const data = useAsync(async () => {
    const [sermons, nearby, readings, tod] = await Promise.all([sermonsFor(verse), sermonsInChapter(verse), readingsFor(verse), todFor(verse)])
    return { sermons, nearby, readings, tod }
  }, [verse])
  const [openNotes, setOpenNotes] = useState(false)
  useEffect(() => setOpenNotes(false), [verse])
  if (!data) return <p className="muted">Loading…</p>
  const { sermons, nearby, readings, tod } = data
  const nothing = !sermons.length && !readings.length && !tod?.exposition.length

  return (
    <div className="spurgeon-tab">
      {tod && tod.exposition.length > 0 && (
        <section className="sp-block">
          <h3 className="sp-h">Treasury of David</h3>
          {tod.exposition.map(x => <AnnotatedHtml key={x.i} className="sp-prose" html={renderSpurgeon(x.md)} doc={`tod:${tod.psalm}:exposition:${x.i}`}
            suggest={verse} label={`Treasury of David, Psalm ${tod.psalm}:${x.s}`} href={`#/spurgeon/psalm/${tod.psalm}`} />)}
          {(tod.notes.length > 0 || tod.hints.length > 0) && (
            <button className="text-btn" onClick={() => setOpenNotes(!openNotes)}>
              {openNotes ? 'Hide' : 'Show'} quaint sayings{tod.hints.length ? ' and hints to preachers' : ''} ({tod.notes.length + tod.hints.length})
            </button>
          )}
          {openNotes && (
            <div className="sp-notes">
              {tod.notes.map(x => <AnnotatedHtml key={`n${x.i}`} className="sp-prose small" html={renderSpurgeon(x.md)} doc={`tod:${tod.psalm}:notes:${x.i}`}
                suggest={verse} label={`Treasury of David, Psalm ${tod.psalm}:${x.s}`} href={`#/spurgeon/psalm/${tod.psalm}`} />)}
              {tod.hints.length > 0 && <h4 className="sp-sub">Hints to preachers</h4>}
              {tod.hints.map(x => <AnnotatedHtml key={`h${x.i}`} className="sp-prose small" html={renderSpurgeon(x.md)} doc={`tod:${tod.psalm}:hints:${x.i}`}
                suggest={verse} label={`Treasury of David, Psalm ${tod.psalm}:${x.s}`} href={`#/spurgeon/psalm/${tod.psalm}`} />)}
            </div>
          )}
          <a className="text-btn" href={`#/spurgeon/psalm/${tod.psalm}`}>Read all of Psalm {tod.psalm}</a>
        </section>
      )}

      {sermons.length > 0 && (
        <section className="sp-block">
          <h3 className="sp-h">{sermons.length === 1 ? 'Sermon on this verse' : `${sermons.length} sermons on this verse`}</h3>
          <SermonList list={sermons} />
        </section>
      )}

      {readings.length > 0 && (
        <section className="sp-block">
          <h3 className="sp-h">Morning and Evening</h3>
          {readings.map(r => <ReadingCard key={r.date + r.period} r={r} collapsed />)}
        </section>
      )}

      {nothing && <p className="empty"><span>Spurgeon has no sermon or reading on this exact verse.</span></p>}

      {nearby.length > 0 && (
        <section className="sp-block">
          <h3 className="sp-h">Elsewhere in this chapter</h3>
          <SermonList list={nearby.slice(0, 8)} showRef />
          {nearby.length > 8 && <p className="muted small-note">And {nearby.length - 8} more in the Spurgeon library.</p>}
        </section>
      )}
    </div>
  )
}

function SermonList({ list, showRef = false }: { list: Sermon[]; showRef?: boolean }) {
  return (
    <ol className="sermon-list">
      {list.map(s => (
        <li key={s.id}>
          <a className="sermon-item" href={`#/spurgeon/sermon/${encodeURIComponent(s.id)}`}>
            <span className="sermon-title">{s.title}</span>
            <span className="sermon-meta">{showRef && s.s ? `${formatRef(s.s, s.e, true)}, ` : ''}Sermon {s.num}</span>
          </a>
        </li>
      ))}
    </ol>
  )
}

export function ReadingCard({ r, collapsed = false }: { r: Reading; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed)
  const html = useMemo(() => renderSpurgeon(r.text), [r.text])
  return (
    <article className="reading">
      <p className="reading-meta">{r.period === 'morning' ? 'Morning' : 'Evening'}, {dateLabel(r.date)}</p>
      <blockquote className="reading-verse">
        {r.verse} <a className="ref-link" href={r.s ? hashFor(r.s) : undefined}>{r.scripture}</a>
      </blockquote>
      {open ? <AnnotatedHtml className="sp-prose" html={html} doc={`reading:${r.date}:${r.period}`} suggest={r.s || null}
        label={`Morning and Evening, ${r.period === 'morning' ? 'Morning' : 'Evening'}, ${dateLabel(r.date)}`} href="#/today" /> : (
        <button className="text-btn" onClick={() => setOpen(true)}>Read it</button>
      )}
    </article>
  )
}
const hashFor = (id: number) => { const { b, c, v } = splitVid(id); return `#/read/${b}/${c}/${v}` }

/* ---------------- library home ---------------- */

const AUTHOR_KEY = 'margin.theo.author'
export function SpurgeonHome({ author }: { author?: string }) {
  const lib = useLibrary()
  let saved = 'spurgeon'
  try { saved = localStorage.getItem(AUTHOR_KEY) ?? 'spurgeon' } catch { /* private mode */ }
  const who = author ?? saved
  useEffect(() => { try { localStorage.setItem(AUTHOR_KEY, who) } catch { /* private mode */ } }, [who])
  const shelf = lib?.find(a => a.id === who)
  const sermons = useAsync(loadSermons, [])
  const [q, setQ] = useState('')
  const [openBook, setOpenBook] = useState<number | null>(null)
  const byBook = useMemo(() => {
    const m = new Map<number, Sermon[]>()
    for (const s of sermons ?? []) {
      const b = s.s ? Math.floor(s.s / 1_000_000) : 0
      m.set(b, [...(m.get(b) ?? []), s])
    }
    for (const l of m.values()) l.sort((a, b) => a.s - b.s)
    return m
  }, [sermons])

  return (
    <main className="page spurgeon-home">
      <header className="page-head">
        <h1>Theologians</h1>
        <p>Sermons and books, linked to the verses they quote.</p>
      </header>

      <form className="sp-search" role="search" onSubmit={e => { e.preventDefault(); if (q.trim()) go({ page: 'spurgeon', view: 'search', q: q.trim() }) }}>
        <IconSearch size={17} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search every sermon and book" aria-label="Search the theologians" />
      </form>

      <div className="theo-authors" role="tablist" aria-label="Author">
        {[{ id: 'spurgeon', name: 'Spurgeon' }, ...(lib ?? []).map(a => ({ id: a.id, name: a.name.split(' ').pop()! }))].map(a => (
          <button key={a.id} role="tab" aria-selected={who === a.id} className={who === a.id ? 'is-on' : ''}
            onClick={() => go({ page: 'spurgeon', view: 'home', author: a.id }, true)}>{a.name}</button>
        ))}
      </div>

      {shelf ? <><h2 className="theo-name">{shelf.name} <span>{shelf.years}</span></h2><AuthorShelf author={shelf} /></> : <>
      <h2 className="theo-name">Charles Haddon Spurgeon <span>1834–1892</span></h2>
      <p className="theo-about">{sermons ? `${sermons.length.toLocaleString()} sermons` : 'Sermons'} from the Metropolitan Tabernacle Pulpit and his commentary on the Psalms, the Treasury of David. Morning and Evening is on the Today page.</p>


      <section className="sp-section">
        <h2>The Treasury of David</h2>
        <div className="psalm-grid">
          {Array.from({ length: 150 }, (_, i) => (
            <a key={i} className="chapter-cell" href={`#/spurgeon/psalm/${i + 1}`}>{i + 1}</a>
          ))}
        </div>
      </section>

      <section className="sp-section">
        <h2>Sermons by book</h2>
        <ul className="sp-books">
          {books().filter(b => byBook.get(b.id)?.length).map(b => (
            <li key={b.id}>
              <button className="sp-book" aria-expanded={openBook === b.id} onClick={() => setOpenBook(openBook === b.id ? null : b.id)}>
                <span>{b.name}</span><span className="muted">{byBook.get(b.id)!.length}</span>
              </button>
              {openBook === b.id && <SermonList list={byBook.get(b.id)!} showRef />}
            </li>
          ))}
          {byBook.get(0)?.length ? (
            <li>
              <button className="sp-book" aria-expanded={openBook === 0} onClick={() => setOpenBook(openBook === 0 ? null : 0)}>
                <span>Without a single text</span><span className="muted">{byBook.get(0)!.length}</span>
              </button>
              {openBook === 0 && <SermonList list={byBook.get(0)!} />}
            </li>
          ) : null}
        </ul>
      </section>
      </>}
      <footer className="credits"><p>{shelf ? 'Public-domain texts from Project Gutenberg.' : 'Texts from the public-domain editions via lyteword/chspurgeon-sermons and lyteword/chspurgeon-tod (CC0) and CCEL.'}</p></footer>
    </main>
  )
}

/* ---------------- one sermon ---------------- */

export function SermonPage({ id }: { id: string }) {
  const meta = useAsync(() => sermonById(id), [id])
  const text = useAsync(() => sermonText(id), [id])
  const html = useMemo(() => (text ? renderSpurgeon(text) : ''), [text])
  const top = useRef<HTMLElement>(null)
  useEffect(() => { window.scrollTo(0, 0) }, [id])
  useReadingTime(`s:${id}`)
  return (
    <main className="page sermon-page" ref={top}>
      <a className="back-link" href="#/spurgeon/spurgeon"><IconLeft size={16} />Spurgeon</a>
      <header className="sermon-head">
        <p className="sermon-num">Sermon {meta?.num ?? id}{meta ? `, volume ${meta.vol}` : ''}</p>
        <h1>{meta?.title ?? ' '}</h1>
        {meta?.s ? <a className="sermon-text-ref" href={hashFor(meta.s)}>{formatRef(meta.s, meta.e)}</a> : null}
      </header>
      {text === undefined ? <div className="loading-lines"><span /><span /><span /><span /></div> : (
        <AnnotatedHtml className="sp-prose sermon-body" html={html} doc={`sermon:${id}`} suggest={meta?.s || null}
          label={meta ? `Spurgeon, Sermon ${meta.num}: ${meta.title}` : `Spurgeon, Sermon ${id}`} href={`#/spurgeon/sermon/${encodeURIComponent(id)}`} />
      )}
      {text !== undefined && <MarkRead k={`s:${id}`} what="this sermon" />}
      {meta?.s ? (
        <footer className="sermon-foot">
          <p className="hint">Select any words above to highlight them, note them, or link them to a verse.</p>
          <button className="text-btn" onClick={() => openNote(null, [], [{ s: meta.s, e: meta.e }])}>Write a note on {formatRef(meta.s, meta.e)}</button>
        </footer>
      ) : null}
    </main>
  )
}

/* ---------------- one psalm (Treasury of David) ---------------- */

export function PsalmPage({ n }: { n: number }) {
  const t = useAsync(() => loadTod(n), [n])
  const [tab, setTab] = useState<'exposition' | 'notes' | 'hints'>('exposition')
  useEffect(() => { window.scrollTo(0, 0); setTab('exposition') }, [n])
  useReadingTime(`p:${n}`)
  const list = t ? t[tab] : []
  return (
    <main className="page sermon-page">
      <a className="back-link" href="#/spurgeon/spurgeon"><IconLeft size={16} />Spurgeon</a>
      <header className="sermon-head">
        <p className="sermon-num">The Treasury of David</p>
        <h1>Psalm {n}</h1>
        <a className="sermon-text-ref" href={`#/read/19/${n}`}>Read Psalm {n}</a>
      </header>
      {!t ? <div className="loading-lines"><span /><span /><span /></div> : (
        <>
          {t.intro && <AnnotatedHtml className="sp-prose sp-intro" html={renderSpurgeon(t.intro)} doc={`tod:${n}:intro:0`}
            label={`Treasury of David, Psalm ${n}`} href={`#/spurgeon/psalm/${n}`} suggest={19_000_000 + n * 1000 + 1} />}
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'exposition'} className={tab === 'exposition' ? 'is-on' : ''} onClick={() => setTab('exposition')}>Exposition</button>
            <button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'is-on' : ''} onClick={() => setTab('notes')}>Quaint sayings<span className="tab-count">{t.notes.length}</span></button>
            {t.hints.length > 0 && <button role="tab" aria-selected={tab === 'hints'} className={tab === 'hints' ? 'is-on' : ''} onClick={() => setTab('hints')}>Hints to preachers<span className="tab-count">{t.hints.length}</span></button>}
          </div>
          {list.map((x, i) => (
            <section key={i} className="tod-entry">
              {tab === 'exposition' && x[0] > 0 && <a className="tod-verse" href={`#/read/19/${n}/${x[0]}`}>{x[0] === x[1] ? `Verse ${x[0]}` : `Verses ${x[0]}–${x[1]}`}</a>}
              <AnnotatedHtml className="sp-prose sermon-body" html={renderSpurgeon(x[2])} doc={`tod:${n}:${tab}:${i}`}
                suggest={x[0] > 0 ? 19_000_000 + n * 1000 + x[0] : null}
                label={`Treasury of David, Psalm ${n}${x[0] > 0 ? `:${x[0]}` : ''}`} href={`#/spurgeon/psalm/${n}`} />
            </section>
          ))}
          <MarkRead k={`p:${n}`} what={`Psalm ${n}`} />
          <nav className="chapter-nav">
            {n > 1 ? <a className="chapter-nav-link" href={`#/spurgeon/psalm/${n - 1}`}><IconLeft size={18} />Psalm {n - 1}</a> : <span />}
            {n < 150 ? <a className="chapter-nav-link" href={`#/spurgeon/psalm/${n + 1}`}>Psalm {n + 1}<IconRight size={18} /></a> : <span />}
          </nav>
        </>
      )}
    </main>
  )
}

/* ---------------- search ---------------- */

export function SpurgeonSearch({ q }: { q: string }) {
  const res = useAsync(() => searchSpurgeon(q), [q])
  const [text, setText] = useState(q)
  useEffect(() => setText(q), [q])
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const mark = (t: string) => {
    const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
    return t.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))
  }
  return (
    <main className="page">
      <a className="back-link" href="#/spurgeon"><IconLeft size={16} />Theologians</a>
      <form className="sp-search" role="search" onSubmit={e => { e.preventDefault(); if (text.trim()) go({ page: 'spurgeon', view: 'search', q: text.trim() }) }}>
        <IconSearch size={17} />
        <input value={text} onChange={e => setText(e.target.value)} aria-label="Search the theologians" />
      </form>
      {res === undefined && <p className="muted">Searching every sermon and book… (on this device this can take half a minute)</p>}
      {res === 'offline' && <p className="hint">Your PC can't be reached, and the library isn't saved on this device. To search without the PC, save Spurgeon in Settings › Offline library.</p>}
      {res && res !== 'offline' && (
        <>
          <p className="muted">{res.hits.length === 0 ? 'Nothing found. Try fewer or different words.' : `${res.hits.length}${res.hits.length === 60 ? '+' : ''} results`}{res.onDevice ? ' · searched on this device' : ''}</p>
          <ol className="search-results">
            {res.hits.map(h => (
              <li key={h.kind + h.id}>
                <a className="result" href={h.kind === 'sermon' ? `#/spurgeon/sermon/${encodeURIComponent(h.id)}` : h.kind === 'psalm' ? `#/spurgeon/psalm/${h.id}` : h.kind === 'work' ? `#/spurgeon/work/${h.id}` : '#/today'}>
                  <span className="result-ref">{h.kind === 'sermon' ? 'Sermon' : h.kind === 'psalm' ? 'Treasury' : h.kind === 'work' ? h.ref.split(' ').pop() : 'Reading'}</span>
                  <span className="result-text"><strong className="result-title">{h.title}</strong>{h.ref && h.kind !== 'work' ? <span className="muted"> {h.ref}</span> : null}<br />{mark(h.snippet)}</span>
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  )
}
