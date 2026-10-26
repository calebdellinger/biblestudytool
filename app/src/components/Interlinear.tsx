import { useEffect, useRef, useState } from 'react'
import { formatRef, localTr, splitVid, verseText, type Translation } from '../lib/bible'
import { describeMorph, displayStrong, lexEntry, wordsFor, type Word } from '../lib/original'
import { go, useAsync } from '../lib/hooks'
import { IconClose } from './Icons'

/** One verse, word by word: original, transliteration, English gloss, Strong's number. */
export function VerseWords({ verse, selected, onPick, compact = false }: {
  verse: number; selected?: number | null; onPick?: (i: number) => void; compact?: boolean
}) {
  const words = useAsync(() => wordsFor(verse), [verse])
  if (!words) return <div className="iw-loading" aria-label="Loading" />
  if (!words.length) return <p className="muted">No original-language text for this verse.</p>
  const lang = words[0].lang
  return (
    <div className={`iw-row ${lang} ${compact ? 'compact' : ''}`} dir={lang === 'hebrew' ? 'rtl' : 'ltr'}>
      {words.map((w, i) => (
        <button key={i} className={`iw ${selected === i ? 'is-on' : ''}`} onClick={() => onPick?.(i)}
          aria-label={`${w.text}, ${w.translit}, ${w.gloss}, ${displayStrong(w.strong)}`} aria-pressed={selected === i}>
          <span className="iw-orig" lang={lang === 'hebrew' ? 'he' : 'grc'}>{w.text}</span>
          <span className="iw-translit" dir="ltr">{w.translit}</span>
          <span className={`iw-gloss ${w.glossMuted ? 'muted' : ''}`} dir="ltr">{w.gloss}</span>
          {!compact && <span className="iw-strong" dir="ltr">{displayStrong(w.strong)}</span>}
        </button>
      ))}
    </div>
  )
}

/** Everything about one word: dictionary form, meaning, grammar, and where else it's used. */
export function WordDetail({ verse, index, tr, onClose }: { verse: number; index: number; tr: Translation; onClose: () => void }) {
  const words = useAsync(() => wordsFor(verse), [verse])
  const w: Word | undefined = words?.[index]
  const lex = useAsync(async () => (w ? lexEntry(w.strong) : null), [w?.strong])
  const morph = useAsync(async () => (w ? describeMorph(w.morph) : null), [w?.morph])
  const [showAll, setShowAll] = useState(false)
  const box = useRef<HTMLElement>(null)
  useEffect(() => setShowAll(false), [w?.strong])
  useEffect(() => { box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [verse, index, lex])
  if (!w) return null
  const heb = w.lang === 'hebrew'
  const others = (lex?.verses ?? []).filter(v => v !== verse)
  const shown = showAll ? others : others.slice(0, 12)

  return (
    <section ref={box} className="word-detail" aria-label={`Word study: ${lex?.lemma ?? w.text}`}>
      <header className="wd-head">
        <div>
          <p className={`wd-lemma ${w.lang}`} lang={heb ? 'he' : 'grc'} dir={heb ? 'rtl' : 'ltr'}>{lex?.lemma ?? w.text}</p>
          <p className="wd-sub">
            <span className="wd-translit">{lex?.translit?.replace(/\./g, '') ?? w.translit}</span>
            <span className="wd-strong">{displayStrong(w.strong)}</span>
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close word study"><IconClose /></button>
      </header>

      {lex?.gloss && <p className="wd-gloss">{lex.gloss.replace(/^[:\s]+/, '')}</p>}

      <dl className="wd-facts">
        <div><dt>In this verse</dt><dd><span lang={heb ? 'he' : 'grc'} className={w.lang}>{w.text}</span>, “{w.gloss}”</dd></div>
        {morph?.rows.length ? <div><dt>Grammar</dt><dd>{morph.summary}</dd></div> : null}
        {heb && w.parts.length > 1 && (
          <div><dt>Made of</dt><dd className="wd-parts">
            {w.parts.map((p, i) => (
              <span key={i} className={`wd-part ${p.main ? 'is-main' : ''}`}>
                <span lang="he" className="hebrew">{p.text}</span> {p.gloss}
              </span>
            ))}
          </dd></div>
        )}
        {lex && <div><dt>Used</dt><dd>{lex.count.toLocaleString()} {lex.count === 1 ? 'time' : 'times'} in {lex.verses.length.toLocaleString()} {lex.verses.length === 1 ? 'verse' : 'verses'}</dd></div>}
      </dl>

      {lex?.def && (
        <details className="wd-def">
          <summary>Dictionary entry</summary>
          <div dangerouslySetInnerHTML={{ __html: lex.def }} />
        </details>
      )}

      {lex && lex.verses.length > 1 && (
        <button className="primary-btn small wd-study" onClick={() => go({ page: 'word', strong: w.strong, from: verse })}>
          Follow {lex.translit?.replace(/\./g, '') ?? 'this word'} through the Bible
        </button>
      )}

      {others.length > 0 && (
        <div className="wd-occ">
          <h3>Elsewhere</h3>
          <ol>{shown.map(v => <Occurrence key={v} id={v} tr={tr} />)}</ol>
          {others.length > shown.length && (
            <button className="text-btn" onClick={() => setShowAll(true)}>Show all {others.length.toLocaleString()}</button>
          )}
        </div>
      )}
      <p className="wd-credit">STEPBible.org data, Tyndale House Cambridge, CC BY 4.0</p>
    </section>
  )
}

function Occurrence({ id, tr }: { id: number; tr: Translation }) {
  const text = useAsync(() => verseText(localTr(tr), id), [id, tr])
  const { b, c, v } = splitVid(id)
  return (
    <li>
      <button className="xref" onClick={() => go({ page: 'read', book: b, chapter: c, verse: v, scope: 'chapter' })}>
        <span className="xref-ref">{formatRef(id)}</span>
        <span className="xref-text">{text}</span>
      </button>
    </li>
  )
}
