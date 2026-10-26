// Follow one Hebrew or Greek word through the whole Bible: where it's used, how the interlinear renders it,
// the forms it takes, and every verse, filterable by book, rendering or form.
import { useEffect, useMemo, useState } from 'react'
import { books, formatRef, localTr, splitVid, verseText, type Translation } from '../lib/bible'
import { concordance, displayStrong, lexEntry } from '../lib/original'
import { go, useAsync, usePrefs } from '../lib/hooks'
import { IconLeft } from './Icons'

const PAGE = 40
type Filter = { book?: number; gloss?: number; form?: number }

export function WordPage({ strong, from }: { strong: string; from?: number }) {
  const prefs = usePrefs()
  const tr = localTr(prefs.translation) as Translation
  const lex = useAsync(() => lexEntry(strong), [strong])
  const data = useAsync(() => concordance(strong), [strong])
  const [f, setF] = useState<Filter>({})
  const [n, setN] = useState(PAGE)
  useEffect(() => { setF({}); setN(PAGE) }, [strong])
  useEffect(() => setN(PAGE), [f])

  const heb = strong.startsWith('H')
  const occ = data?.c.occ ?? []
  const byBook = useMemo(() => {
    const m = new Map<number, number>()
    for (const [v] of occ) { const b = Math.floor(v / 1e6); m.set(b, (m.get(b) ?? 0) + 1) }
    return m
  }, [occ])
  const count = (i: 1 | 2) => { const m = new Map<number, number>(); for (const o of occ) m.set(o[i], (m.get(o[i]) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]) }
  const glosses = useMemo(() => count(2), [occ]) // eslint-disable-line react-hooks/exhaustive-deps
  const forms = useMemo(() => count(1), [occ]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => occ.filter(([v, fo, g]) =>
    (f.book === undefined || Math.floor(v / 1e6) === f.book) && (f.gloss === undefined || g === f.gloss) && (f.form === undefined || fo === f.form)), [occ, f])

  if (data === undefined) return <main className="page word-page"><div className="loading-lines"><span /><span /><span /></div></main>
  const bks = books()
  const max = Math.max(1, ...byBook.values())
  const top = [...byBook].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const back = from ? splitVid(from) : null
  const filtered = f.book !== undefined || f.gloss !== undefined || f.form !== undefined

  return (
    <main className="page word-page">
      {back && <a className="back-link" href={`#/read/${back.b}/${back.c}/${back.v}`}><IconLeft size={16} />{formatRef(from!)}</a>}
      <header className="wp-head">
        <p className={`wd-lemma ${heb ? 'hebrew' : 'greek'}`} lang={heb ? 'he' : 'grc'} dir={heb ? 'rtl' : 'ltr'}>{lex?.lemma ?? data?.c.forms[0] ?? strong}</p>
        <p className="wd-sub">
          <span className="wd-translit">{lex?.translit?.replace(/\./g, '')}</span>
          <span className="wd-strong">{displayStrong(strong)}</span>
        </p>
        {lex?.gloss && <p className="wd-gloss">{lex.gloss.replace(/^[:\s]+/, '')}</p>}
        <p className="muted">
          {occ.length.toLocaleString()} {occ.length === 1 ? 'place' : 'places'} in {byBook.size} {byBook.size === 1 ? 'book' : 'books'}
          {top.length > 1 ? `, most in ${top.map(([b, c]) => `${bks[b - 1]?.name} (${c})`).join(', ')}` : ''}
        </p>
      </header>

      {!data ? <p className="empty"><span>No concordance for this word yet.</span></p> : (
        <>
          <section className="wp-section">
            <h2>Where it's used</h2>
            <div className="wp-books">
              {bks.filter(b => byBook.has(b.id)).map(b => {
                const c = byBook.get(b.id)!
                return (
                  <button key={b.id} className={`wp-book ${f.book === b.id ? 'is-on' : ''}`} onClick={() => setF({ ...f, book: f.book === b.id ? undefined : b.id })}
                    aria-pressed={f.book === b.id} title={`${b.name}: ${c}`}>
                    <span className="wp-book-name">{b.abbr}</span>
                    <span className="wp-book-bar"><span style={{ width: `${(c / max) * 100}%` }} /></span>
                    <span className="wp-book-n">{c}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {glosses.length > 1 && (
            <section className="wp-section">
              <h2>Rendered as</h2>
              <p className="hint small">The interlinear's word-for-word English. Your translation may say it differently.</p>
              <div className="wp-chips">
                {glosses.map(([g, c]) => (
                  <button key={g} className={`chip ${f.gloss === g ? 'is-on' : ''}`} aria-pressed={f.gloss === g} onClick={() => setF({ ...f, gloss: f.gloss === g ? undefined : g })}>
                    {data.c.glosses[g]} <span className="chip-n">{c}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {forms.length > 1 && (
            <details className="wp-section wp-forms">
              <summary>{forms.length} forms</summary>
              <div className="wp-chips">
                {forms.map(([fo, c]) => (
                  <button key={fo} className={`chip ${f.form === fo ? 'is-on' : ''}`} aria-pressed={f.form === fo} onClick={() => setF({ ...f, form: f.form === fo ? undefined : fo })}>
                    <span lang={heb ? 'he' : 'grc'} className={heb ? 'hebrew' : 'greek'}>{data.c.forms[fo]}</span> <span className="chip-n">{c}</span>
                  </button>
                ))}
              </div>
            </details>
          )}

          <section className="wp-section">
            <div className="wp-list-head">
              <h2>{filtered ? `${list.length.toLocaleString()} of ${occ.length.toLocaleString()}` : 'Every verse'}</h2>
              {filtered && <button className="text-btn small" onClick={() => setF({})}>Show all</button>}
            </div>
            <ol className="wp-list">
              {list.slice(0, n).map(([v, fo, g], i) => {
                const newBook = i === 0 || Math.floor(list[i - 1][0] / 1e6) !== Math.floor(v / 1e6)
                return (
                  <li key={`${v}-${fo}-${g}`}>
                    {newBook && <h3 className="wp-book-head">{bks[Math.floor(v / 1e6) - 1]?.name}</h3>}
                    <Occ id={v} tr={tr} form={data.c.forms[fo]} gloss={data.c.glosses[g]} heb={heb} here={v === from} />
                  </li>
                )
              })}
            </ol>
            {list.length > n && <button className="text-btn" onClick={() => setN(n + PAGE * 2)}>Show more ({(list.length - n).toLocaleString()} left)</button>}
          </section>
        </>
      )}
      {lex?.def && (
        <details className="wd-def wp-section">
          <summary>Dictionary entry</summary>
          <div dangerouslySetInnerHTML={{ __html: lex.def }} />
        </details>
      )}
      <p className="wd-credit">STEPBible.org data, Tyndale House Cambridge, CC BY 4.0</p>
    </main>
  )
}

function Occ({ id, tr, form, gloss, heb, here }: { id: number; tr: Translation; form: string; gloss: string; heb: boolean; here: boolean }) {
  const text = useAsync(() => verseText(tr, id), [id, tr])
  const { b, c, v } = splitVid(id)
  const marked = useMemo(() => mark(text ?? '', gloss), [text, gloss])
  return (
    <button className={`wp-occ ${here ? 'is-here' : ''}`} onClick={() => go({ page: 'read', book: b, chapter: c, verse: v, scope: 'chapter' })}>
      <span className="wp-occ-top">
        <span className="xref-ref">{formatRef(id)}</span>
        <span className="wp-occ-word"><span lang={heb ? 'he' : 'grc'} className={heb ? 'hebrew' : 'greek'}>{form}</span> · {gloss}</span>
      </span>
      <span className="xref-text">{marked}</span>
    </button>
  )
}

/** Highlight the interlinear rendering in the verse when the translation uses the same word. */
function mark(text: string, gloss: string) {
  const words = gloss.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(the|and|of|to|in|for|with|his|her|him|you|was|are|is|be)$/.test(w))
  if (!words.length || !text) return text
  const re = new RegExp(`\\b((?:${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\w*)`, 'gi')
  const parts = text.split(re)
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))
}
