// The overview at the top of a book: who wrote it, when, why, and how it fits in the Bible.
import { useState } from 'react'
import { bookById, splitVid } from '../lib/bible'
import { useAsync } from '../lib/hooks'
import { introFor } from '../lib/intro'
import { IconDown } from './Icons'

export function BookIntro({ book }: { book: number }) {
  const d = useAsync(() => introFor(book), [book])
  const [open, setOpen] = useState(false)
  if (!d) return <div className="intro intro-loading" aria-hidden="true"><span /><span /><span /></div>
  const { book: b, section: s } = d
  const verseHref = (id: number) => { const { b, c, v } = splitVid(id); return `#/read/${b}/${c}/${v}` }
  return (
    <section className="intro" aria-label="About this book">
      <dl className="intro-facts">
        <div><dt>Written by</dt><dd>{b.author}</dd></div>
        <div><dt>When</dt><dd>{b.date}</dd></div>
        <div><dt>Written to</dt><dd>{b.to}</dd></div>
        <div><dt>Kind of writing</dt><dd>{b.kind}</dd></div>
      </dl>
      <p className="intro-summary">{b.summary}</p>

      {open && (
        <div className="intro-more">
          <div className="intro-block">
            <h3>Themes</h3>
            <ul className="intro-themes">{b.themes.map(t => <li key={t}>{t}</li>)}</ul>
          </div>
          <div className="intro-block">
            <h3>Key verses</h3>
            <p className="intro-keys">{b.key.map(([label, s]) => <a key={label} className="chip chip-link" href={verseHref(s)}>{label}</a>)}</p>
          </div>
          <div className="intro-block">
            <h3>Outline</h3>
            <ol className="intro-outline">
              {b.outline.map(([label, c1, v1, c2, v2], i) => {
                const whole = v1 === 1 && v2 >= (bookById(book)?.verses[c2 - 1] ?? 0)
                const range = c1 !== c2 ? `${c1}–${c2}` : whole ? `${c1}` : `${c1}:${v1}–${v2}`
                return (
                  <li key={i}>
                    <a href={`#/read/${book}/${c1}${v1 > 1 ? `/${v1}` : ''}`}>
                      <span className="io-range">{range}</span><span className="io-label">{label}</span>
                    </a>
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="intro-block">
            <h3>About the name{b.authorMeans ? 's' : ''}</h3>
            <p>{b.means}</p>
            {b.authorMeans && <p>{b.authorMeans}</p>}
            {b.authorNote && <p className="intro-note">{b.authorNote}</p>}
          </div>
          {b.covers && <div className="intro-block"><h3>Time covered</h3><p>{b.covers}</p></div>}
          <div className="intro-block">
            <h3>Where it fits</h3>
            <p>{b.fits}</p>
          </div>
          <div className="intro-block intro-section">
            <h3>{s.name} <span className="muted">· {s.also}</span></h3>
            <p>{s.summary}</p>
            <p className="intro-note">{s.reading}</p>
          </div>
        </div>
      )}
      <button className="intro-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Show less' : 'Themes, outline, key verses and more'}<IconDown size={16} />
      </button>
    </section>
  )
}
