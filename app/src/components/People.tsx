import { useEffect, useMemo, useState } from 'react'
import { formatRef, splitVid } from '../lib/bible'
import {
  chapterYear, fmtSpan, fmtYear, lifespan, loadEvents, loadPeople, loadWorld, peopleInChapter, peopleInVerse, personBio, personMentions,
  type Person,
} from '../lib/people'
import { go, useAsync } from '../lib/hooks'
import { IconLeft } from './Icons'

const relation = (p: Person, all: Person[]) => {
  const parent = all[p.father[0] ?? p.mother[0]]
  if (!parent) return ''
  return `${p.gender === 'F' ? 'Daughter' : p.gender === 'M' ? 'Son' : 'Child'} of ${parent.name}`
}
const names = (ns: number[], all: Person[]) => ns.map(n => all[n]).filter(Boolean)

/* ---------- people in the verse (Context tab) ---------- */
export function PeopleSection({ verse }: { verse: number }) {
  const data = useAsync(async () => {
    const [inVerse, all] = await Promise.all([peopleInVerse(verse), loadPeople()])
    return { inVerse, all, chapter: inVerse.length ? [] : (await peopleInChapter(verse)).slice(0, 8) }
  }, [verse])
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => setOpen(null), [verse])
  if (!data) return null
  const list = data.inVerse.length ? data.inVerse : data.chapter
  if (!list.length) return null
  return (
    <section className="sp-block">
      <div className="cm-head"><h3 className="sp-h">People</h3></div>
      {!data.inVerse.length && <p className="hint small">No one is named in this verse. The people most mentioned in this chapter:</p>}
      <ol className="place-list">
        {list.map(p => {
          const on = open === p.n
          const rel = relation(p, data.all)
          return (
            <li key={p.n} className={`place ${on ? 'is-open' : ''}`}>
              <button className="place-head" onClick={() => setOpen(on ? null : p.n)} aria-expanded={on}>
                <span className="place-name">{p.name}</span>
                <span className="place-type">{lifespan(p) || `${p.verseCount} ${p.verseCount === 1 ? 'verse' : 'verses'}`}</span>
              </button>
              {rel && <p className="place-today">{rel}</p>}
              {on && (
                <div className="place-more">
                  <Family p={p} all={data.all} />
                  <a className="text-btn small" href={`#/person/${p.n}`}>Everything about {p.name}</a>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Family({ p, all }: { p: Person; all: Person[] }) {
  const rows: [string, Person[]][] = [
    ['Parents', names([...p.father, ...p.mother], all)],
    [p.partners.length === 1 ? 'Spouse' : 'Spouses', names(p.partners, all)],
    ['Children', names(p.children, all)],
    ['Siblings', names(p.siblings, all)],
  ]
  const shown = rows.filter(([, l]) => l.length)
  if (!shown.length) return <p className="muted small">No family recorded.</p>
  return (
    <dl className="family">
      {shown.map(([label, l]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{l.slice(0, 12).map(x => <a key={x.n} className="chip chip-link" href={`#/person/${x.n}`}>{x.name}</a>)}{l.length > 12 && <span className="muted small"> and {l.length - 12} more</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ---------- timeline: Scripture and the world around it ---------- */
export function TimelineSection({ verse }: { verse: number }) {
  const data = useAsync(async () => {
    const yr = await chapterYear(verse)
    if (!yr) return null
    const [events, world] = await Promise.all([loadEvents(), loadWorld()])
    const Y = yr.year
    const pick = <T,>(items: T[], at: (x: T) => number, want: number) => {
      for (const span of [120, 250, 500, 1000]) {
        const hit = items.filter(x => Math.abs(at(x) - Y) <= span)
        if (hit.length >= want || span === 1000) return hit.sort((a, b) => Math.abs(at(a) - Y) - Math.abs(at(b) - Y)).slice(0, want + 2)
      }
      return []
    }
    const scripture = pick(events, e => e.year, 5)
    const worldNear = pick(world, w => (w.end != null ? Math.max(w.start, Math.min(Y, w.end)) : w.start), 6)
    return { yr, scripture, world: worldNear }
  }, [Math.floor(verse / 1000)])
  if (!data) return null
  const { yr, scripture, world } = data
  type Row = { y: number; kind: 'here' | 'bible' | 'world'; title: string; sub: string; go?: number; span?: string }
  const rows: Row[] = [
    { y: yr.year, kind: 'here' as const, title: 'This passage', sub: yr.min !== yr.max ? fmtSpan(yr.min, yr.max) : fmtYear(yr.year) },
    ...scripture.map(e => ({ y: e.year, kind: 'bible' as const, title: e.title, sub: formatRef(e.s, e.e, true), go: e.s, span: fmtYear(e.year) })),
    ...world.map(w => ({ y: w.start, kind: 'world' as const, title: w.title, sub: `${w.region}. ${w.note}`, span: fmtSpan(w.start, w.end) })),
  ].sort((a, b) => a.y - b.y || (a.kind === 'here' ? -1 : 1))
  const early = yr.year < -1000
  return (
    <section className="sp-block">
      <div className="cm-head"><h3 className="sp-h">When</h3><span className="cm-range">about {fmtYear(Math.round(yr.year / 10) * 10)}</span></div>
      <ol className="timeline">
        {rows.map((r, i) => (
          <li key={i} className={`tl tl-${r.kind}`}>
            <span className="tl-year">{r.kind === 'here' ? '' : r.span}</span>
            <span className="tl-dot" aria-hidden="true" />
            <div className="tl-body">
              {r.go ? <button className="tl-title" onClick={() => { const { b, c, v } = splitVid(r.go!); go({ page: 'read', book: b, chapter: c, verse: v, scope: 'chapter' }) }}>{r.title}</button>
                : <span className="tl-title">{r.title}</span>}
              <span className="tl-sub">{r.sub}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="tl-key"><span className="tl-key-bible" />In Scripture <span className="tl-key-world" />Elsewhere in the world</p>
      <p className="muted small-note">
        Scripture dates follow the traditional (Ussher-style) chronology{early ? '; before about 1000 BC scholars differ by centuries' : ''}. World dates are approximate.
      </p>
    </section>
  )
}

/* ---------- a person's page ---------- */
export function PersonPage({ n }: { n: number }) {
  const all = useAsync(loadPeople, [])
  const p = all?.[n]
  const bio = useAsync(async () => (p ? personBio(p) : ''), [p?.n])
  const mentions = useAsync(() => personMentions(n), [n])
  const [more, setMore] = useState(false)
  const [allRefs, setAllRefs] = useState(false)
  useEffect(() => { setMore(false); setAllRefs(false); window.scrollTo(0, 0) }, [n])
  const paras = useMemo(() => (bio ?? '').split(/\n+/).map(s => s.trim()).filter(Boolean), [bio])
  if (!all) return <main className="page"><div className="loading-lines"><span /><span /></div></main>
  if (!p) return <main className="page"><p>Person not found.</p></main>
  const parents = names([...p.father, ...p.mother], all), spouses = names(p.partners, all), kids = names(p.children, all)
  return (
    <main className="page person-page">
      <button className="back-link" onClick={() => history.back()}><IconLeft size={16} />Back</button>
      <header className="sermon-head">
        <p className="sermon-num">{[lifespan(p), `named in ${p.verseCount} ${p.verseCount === 1 ? 'verse' : 'verses'}`].filter(Boolean).join(', ')}</p>
        <h1>{p.name}</h1>
        {p.aka.length > 0 && <p className="hint">Also called {p.aka.join(', ')}</p>}
      </header>

      {(parents.length > 0 || spouses.length > 0 || kids.length > 0) && (
        <section className="tree" aria-label="Family">
          {parents.length > 0 && <p className="tree-label">{parents.length === 1 ? 'Parent' : 'Parents'}</p>}
          {parents.length > 0 && <div className="tree-row">{parents.map(x => <a key={x.n} className="tree-node" href={`#/person/${x.n}`}>{x.name}</a>)}</div>}
          {parents.length > 0 && <div className="tree-line" />}
          {spouses.length > 0 && <p className="tree-label">{p.name} and {spouses.length === 1 ? 'spouse' : 'spouses'}</p>}
          <div className="tree-row">
            <span className="tree-node is-self">{p.name}</span>
            {spouses.map(x => <a key={x.n} className="tree-node spouse" href={`#/person/${x.n}`}>{x.name}</a>)}
          </div>
          {kids.length > 0 && <div className="tree-line" />}
          {kids.length > 0 && <p className="tree-label">Children</p>}
          {kids.length > 0 && <div className="tree-row kids">{kids.map(x => <a key={x.n} className="tree-node" href={`#/person/${x.n}`}>{x.name}</a>)}</div>}
        </section>
      )}
      {p.siblings.length > 0 && <p className="hint small">Siblings: {names(p.siblings, all).map((x, i) => <span key={x.n}>{i ? ', ' : ''}<a className="ref-link" href={`#/person/${x.n}`}>{x.name}</a></span>)}</p>}

      {paras.length > 0 && (
        <section className="person-bio">
          <h2 className="sp-h">From Easton's Bible Dictionary</h2>
          {(more ? paras : paras.slice(0, 3)).map((t, i) => <p key={i} className="sp-prose">{t}</p>)}
          {paras.length > 3 && <button className="text-btn" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Read the full entry'}</button>}
        </section>
      )}

      {mentions && mentions.length > 0 && (
        <section className="person-verses">
          <h2 className="sp-h">Where {p.name} appears</h2>
          <div className="ref-chips">
            {(allRefs ? mentions : mentions.slice(0, 60)).map(v => {
              const { b, c, v: vv } = splitVid(v)
              return <button key={v} className="chip chip-link" onClick={() => go({ page: 'read', book: b, chapter: c, verse: vv, scope: 'chapter' })}>{formatRef(v, v, true)}</button>
            })}
            {!allRefs && mentions.length > 60 && <button className="text-btn small" onClick={() => setAllRefs(true)}>{mentions.length - 60} more</button>}
          </div>
        </section>
      )}
      <p className="wd-credit">People and family data: Theographic Bible Metadata (CC BY-SA 4.0). Biography: Easton's Bible Dictionary (1897), public domain.</p>
    </main>
  )
}
