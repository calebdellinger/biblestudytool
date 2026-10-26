import { useEffect, useRef, useState } from 'react'
import { bookById, chapterName, formatRef, splitVid } from '../lib/bible'
import { confidenceLabel, loadPlaces, placesInChapter, placesInVerse, todayLine, typeLabel, type Place } from '../lib/places'
import { go, useAsync, useMedia } from '../lib/hooks'
import { MapView, useNow } from './MapView'
import { IconLeft } from './Icons'
import { PeopleSection, TimelineSection } from './People'

/* ---------- verse panel: Context tab ---------- */
export function ContextTab({ verse }: { verse: number }) {
  const data = useAsync(async () => ({ v: await placesInVerse(verse), ch: await placesInChapter(verse) }), [verse])
  const [focus, setFocus] = useState<string | null>(null)
  const [now, setNow] = useNow()
  useEffect(() => setFocus(null), [verse])
  const { b, c } = splitVid(verse)
  if (!data) return <p className="muted">Loading…</p>
  const shown = data.v.length ? data.v : data.ch
  const chapter = `${chapterName(b)} ${c}`
  return (
    <div className="context-tab">
      <section className="sp-block">
        <div className="cm-head">
          <h3 className="sp-h">Places</h3>
          {shown.length > 0 && <a className="text-btn small" href={`#/map/${verse}`}>Open the large map</a>}
        </div>
        {!data.v.length && shown.length > 0 && <p className="hint small">No places are named in this verse. Showing the places in {chapter}.</p>}
        {!shown.length && <p className="empty"><span>No places are named in {chapter}.</span></p>}
        {shown.length > 0 && (
          <>
            <MapView highlight={shown} dim={data.v.length ? data.ch : []} focus={focus} onPick={setFocus} height={300} now={now} setNow={setNow} />
            <ol className="place-list">
              {shown.map(p => <PlaceCard key={p.id} p={p} open={focus === p.id} onToggle={() => setFocus(focus === p.id ? null : p.id)} current={verse} />)}
            </ol>
          </>
        )}
      </section>
      <PeopleSection verse={verse} />
      <TimelineSection verse={verse} />
    </div>
  )
}

/* ---------- one place ---------- */
export function PlaceCard({ p, open, onToggle, current }: { p: Place; open: boolean; onToggle: () => void; current?: number }) {
  const ref = useRef<HTMLLIElement>(null)
  const [all, setAll] = useState(false)
  useEffect(() => { if (open) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [open])
  const today = todayLine(p)
  const conf = confidenceLabel(p.confidence)
  const others = p.verses.filter(v => v !== current)
  return (
    <li ref={ref} className={`place ${open ? 'is-open' : ''}`}>
      <button className="place-head" onClick={onToggle} aria-expanded={open}>
        <span className="place-name">{p.name}</span>
        <span className="place-type">{typeLabel(p.type)}</span>
      </button>
      {p.lon == null ? <p className="place-today muted">Location unknown</p> : today && <p className="place-today">{p.type === 'region' ? today : <><span className="muted">Today </span>{today}</>}</p>}
      {open && (
        <div className="place-more">
          {p.lon != null && (
            <p className={`conf conf-${conf.toLowerCase()}`}>
              {conf} identification{p.alts.length ? `. Also suggested: ${p.alts.join(', ')}` : ''}
            </p>
          )}
          {others.length > 0 && (
            <div className="place-verses">
              <p className="mine-h">Named in {p.verses.length} {p.verses.length === 1 ? 'verse' : 'verses'}</p>
              <div className="ref-chips">
                {(all ? others : others.slice(0, 18)).map(v => {
                  const { b, c, v: vv } = splitVid(v)
                  return <button key={v} className="chip chip-link" onClick={() => go({ page: 'read', book: b, chapter: c, verse: vv, scope: 'chapter' })}>{formatRef(v, v, true)}</button>
                })}
                {!all && others.length > 18 && <button className="text-btn small" onClick={() => setAll(true)}>{others.length - 18} more</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/* ---------- full-page map for a chapter ---------- */
export function MapPage({ verse }: { verse: number }) {
  const all = useAsync(loadPlaces, [])
  const ch = useAsync(() => placesInChapter(verse), [verse])
  const [focus, setFocus] = useState<string | null>(null)
  const [now, setNow] = useNow()
  const wide = useMedia('(min-width: 900px)')
  const { b, c, v } = splitVid(verse)
  const bk = bookById(b)
  const h = wide ? Math.max(480, window.innerHeight - 140) : Math.round(window.innerHeight * 0.55)
  return (
    <main className={`map-page ${wide ? 'wide' : ''}`}>
      <div className="map-page-map">
        {ch && <MapView highlight={ch} dim={all ?? []} focus={focus} onPick={setFocus} height={h} now={now} setNow={setNow} />}
      </div>
      <aside className="map-page-list">
        <button className="back-link" onClick={() => go({ page: 'read', book: b, chapter: c, verse: v, scope: 'chapter' })}><IconLeft size={16} />Back to {bk ? chapterName(b) : ''} {c}</button>
        <h1>Places in {bk ? chapterName(b) : ''} {c}</h1>
        <p className="hint small">Faint dots are other places in the Bible; tap one to see it.</p>
        <ol className="place-list">
          {(focus && !ch?.some(p => p.id === focus) ? [all!.find(p => p.id === focus)!] : []).concat(ch ?? []).map(p => (
            <PlaceCard key={p.id} p={p} open={focus === p.id} onToggle={() => setFocus(focus === p.id ? null : p.id)} />
          ))}
        </ol>
      </aside>
    </main>
  )
}
