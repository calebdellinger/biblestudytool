// Andrew Murray, E. M. Bounds and D. L. Moody: their books, a chapter reader, and the verse-panel tab.
import { useEffect, useMemo, useState } from 'react'
import { formatRef } from '../lib/bible'
import { go, useAsync } from '../lib/hooks'
import { renderSpurgeon } from '../lib/spurgeon'
import { chapterText, findWork, loadLibrary, readingMinutes, theoRefsFor, type Author, type TheoRef } from '../lib/theologians'
import { AnnotatedHtml } from './Annotate'
import { IconCheck, IconLeft, IconRight } from './Icons'
import { MarkRead } from './MarkRead'
import { useReadingTime, useReadMarks } from '../lib/reading'

const PLACE_KEY = 'margin.theo.place'
const places = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(PLACE_KEY) ?? '{}') } catch { return {} } }
const savePlace = (work: string, n: number) => { try { localStorage.setItem(PLACE_KEY, JSON.stringify({ ...places(), [work]: n })) } catch { /* private mode */ } }
const time = (words: number) => { const m = readingMinutes(words); return m < 60 ? `${m} min` : `${Math.round(m / 6) / 10} hr` }
const plain = (s: string) => s.replace(/\*/g, '')

/* ---------- one author's shelf, on the library home ---------- */
export function AuthorShelf({ author }: { author: Author }) {
  const place = places()
  return (
    <section className="sp-section theo-shelf">
      <p className="theo-about">{author.about}</p>
      <ol className="theo-works">
        {author.works.map(w => {
          const words = w.chapters.reduce((t, c) => t + c[2], 0)
          const at = place[w.id]
          return (
            <li key={w.id}>
              <a className="theo-work" href={`#/spurgeon/work/${w.id}${at ? `/${at}` : ''}`}>
                <span className="theo-work-title">{w.title}</span>
                <span className="theo-work-meta">{w.chapters.length} chapters · {time(words)}{at ? ` · continue at ${at}` : ''}</span>
              </a>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
export const useLibrary = () => useAsync(loadLibrary, [])

/* ---------- a book's contents, or one chapter ---------- */
export function WorkPage({ id }: { id: string }) {
  const [wid, nStr] = id.split('/')
  const n = nStr ? Number(nStr) : null
  const found = useAsync(() => findWork(wid), [wid])
  useEffect(() => { window.scrollTo(0, 0); if (n) savePlace(wid, n) }, [wid, n])
  if (found === undefined) return <main className="page sermon-page"><div className="loading-lines"><span /><span /><span /></div></main>
  if (!found) return <main className="page"><a className="back-link" href="#/spurgeon"><IconLeft size={16} />Theologians</a><p className="empty"><span>This book isn't in the library.</span></p></main>
  const { author, work } = found
  if (n) return <ChapterPage author={author} work={work} n={n} />
  const words = work.chapters.reduce((t, c) => t + c[2], 0)
  return <Contents author={author} work={work} words={words} />
}
function Contents({ author, work, words }: { author: Author; work: Author['works'][number]; words: number }) {
  const read = useReadMarks()
  const done = work.chapters.filter(c => read.has(`w:${work.id}/${c[0]}`)).length
  return (
    <main className="page sermon-page">
      <a className="back-link" href={`#/spurgeon/${author.id}`}><IconLeft size={16} />{author.name}</a>
      <header className="sermon-head">
        <p className="sermon-num">{author.name}</p>
        <h1>{work.title}</h1>
        <p className="muted">{work.chapters.length} chapters · about {time(words)} to read{done ? ` · ${done} marked read` : ''}</p>
      </header>
      <ol className="theo-toc">
        {work.chapters.map(([c, title, w]) => (
          <li key={c}>
            <a href={`#/spurgeon/work/${work.id}/${c}`}>
              <span className="theo-toc-n">{c}</span>
              <span className="theo-toc-title">{plain(title)}</span>
              <span className="theo-toc-time">{read.has(`w:${work.id}/${c}`) ? <IconCheck size={14} /> : time(w)}</span>
            </a>
          </li>
        ))}
      </ol>
      <footer className="credits"><p>Public-domain text from Project Gutenberg (ebook #{work.gutenberg}).</p></footer>
    </main>
  )
}

function ChapterPage({ author, work, n }: { author: Author; work: Author['works'][number]; n: number }) {
  const text = useAsync(() => chapterText(work.id, n).catch(() => null), [work.id, n])
  const ch = work.chapters.find(c => c[0] === n)
  const body = useMemo(() => (text ? renderSpurgeon(text.replace(/^## .*\n+/, '')) : ''), [text])
  const prev = work.chapters.find(c => c[0] === n - 1), next = work.chapters.find(c => c[0] === n + 1)
  const label = `${author.name}, ${work.title}${ch ? `: ${plain(ch[1])}` : ''}`
  useReadingTime(`w:${work.id}/${n}`)
  return (
    <main className="page sermon-page">
      <a className="back-link" href={`#/spurgeon/work/${work.id}`}><IconLeft size={16} />{work.title}</a>
      <header className="sermon-head">
        <p className="sermon-num">{author.name} · {n} of {work.chapters.length}</p>
        <h1>{ch ? plain(ch[1]) : `Chapter ${n}`}</h1>
      </header>
      {text === undefined ? <div className="loading-lines"><span /><span /><span /><span /></div>
        : text === null ? <p className="empty"><span>This chapter couldn't be loaded. If you're offline, open it once while connected.</span></p>
          : <AnnotatedHtml className="sp-prose sermon-body theo-body" html={body} doc={`theo:${work.id}:${n}`} label={label} href={`#/spurgeon/work/${work.id}/${n}`} />}
      {text && <MarkRead k={`w:${work.id}/${n}`} what="this chapter" />}
      <nav className="chapter-nav">
        {prev ? <a className="chapter-nav-link" href={`#/spurgeon/work/${work.id}/${n - 1}`}><IconLeft size={18} />{plain(prev[1])}</a> : <span />}
        {next ? <a className="chapter-nav-link" href={`#/spurgeon/work/${work.id}/${n + 1}`}>{plain(next[1])}<IconRight size={18} /></a> : <span />}
      </nav>
    </main>
  )
}

/* ---------- verse panel ---------- */
export function useTheoCount(verse: number) {
  return useAsync(async () => (await theoRefsFor(verse)).exact.length, [verse])
}

export function TheologiansTab({ verse }: { verse: number }) {
  const data = useAsync(() => theoRefsFor(verse), [verse])
  const [more, setMore] = useState(false)
  useEffect(() => setMore(false), [verse])
  if (!data) return <p className="muted">Loading…</p>
  const { exact, wider } = data
  return (
    <div className="spurgeon-tab">
      {exact.length > 0
        ? <section className="sp-block">{exact.map((r, i) => <TheoCard key={i} r={r} />)}</section>
        : <p className="empty"><span>Murray, Bounds and Moody don't quote this verse in the books here.</span></p>}
      {wider.length > 0 && (
        <section className="sp-block">
          <button className="text-btn" onClick={() => setMore(!more)}>{more ? 'Hide' : 'Show'} {wider.length} on the passage around it</button>
          {more && wider.map((r, i) => <TheoCard key={i} r={r} showRef />)}
        </section>
      )}
    </div>
  )
}

function TheoCard({ r, showRef }: { r: TheoRef; showRef?: boolean }) {
  return (
    <article className="theo-card">
      <p className="theo-card-meta">{r.author.name} · <em>{r.work.title}</em>{showRef ? ` · ${formatRef(r.s, r.e, true)}` : ''}</p>
      <p className="theo-card-snippet">{plain(r.snippet)}</p>
      <button className="text-btn" onClick={() => go({ page: 'spurgeon', view: 'work', id: `${r.work.id}/${r.n}` })}>Read “{plain(r.chapter)}”</button>
    </article>
  )
}
