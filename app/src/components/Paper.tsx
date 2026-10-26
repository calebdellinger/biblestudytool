// The Daily Word: today's readings and Spurgeon's Morning and Evening, laid out like a morning newspaper for printing.
// One continuous paper: Morning devotion, the first two readings, Evening devotion, the last two readings.
import { Fragment, useEffect, useState } from 'react'
import { bookById, loadBook, localTr, splitVid, type Translation } from '../lib/bible'
import { go, useAsync, useCanGoBack, usePrefs } from '../lib/hooks'
import { loadPlan, planIndex, type PlanReading } from '../lib/daily'
import { dateKey, loadReadings, renderSpurgeon, type Reading } from '../lib/spurgeon'
import { dueMems } from '../lib/memory'
import { formatRef } from '../lib/bible'
import { IconLeft } from './Icons'
import type { Block, Run } from '../lib/newspaper'

/** Spurgeon's devotion as plain paragraphs for the PDF. */
function devotionBlock(r: Reading): Block {
  const doc = new DOMParser().parseFromString(`<div>${renderSpurgeon(r.text)}</div>`, 'text/html')
  const paras = [...doc.body.querySelectorAll('p, blockquote, li')].filter(el => !el.querySelector('p')).map(el => [{ text: (el.textContent ?? '').replace(/\s+/g, ' ').trim() }] as Run[]).filter(p => p[0].text)
  return { kind: 'story', kicker: `${r.period === 'morning' ? 'Morning' : 'Evening'} · C. H. Spurgeon`, headline: `“${r.verse}”`, headlineItalic: true, dek: r.scripture, paras, dropCap: true }
}
/** A reading as one paragraph per chapter, with red verse numbers. */
function passageBlock(p: Passage): Block {
  const subheads: Record<number, string> = {}
  const paras: Run[][] = p.chapters.map((ch, i) => {
    if (p.chapters.length > 1) subheads[i] = `${bookById(ch.b)?.name === 'Psalms' ? 'Psalm' : bookById(ch.b)?.name} ${ch.c}`
    return ch.verses.flatMap(([v, t]) => [{ text: String(v), sup: true }, { text: t + ' ' }])
  })
  return { kind: 'story', kicker: p.kind, headline: p.label, paras, subheads }
}

type Edition = 'full' | 'split'
type Passage = { label: string; kind: string; chapters: { b: number; c: number; verses: [number, string][] }[] }

const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

async function passageText(r: PlanReading, i: number, tr: Translation): Promise<Passage> {
  const chapters: Passage['chapters'] = []
  for (const [s, e] of r.ranges) {
    const a = splitVid(s), z = splitVid(e)
    const book = await loadBook(tr, a.b)
    for (let c = a.c; c <= z.c; c++) {
      const vs = book[c - 1] ?? []
      const from = c === a.c ? a.v : 1, to = c === z.c ? z.v : vs.length
      const verses: [number, string][] = []
      for (let v = from; v <= to; v++) if (vs[v - 1]) verses.push([v, vs[v - 1]])
      chapters.push({ b: a.b, c, verses })
    }
  }
  return { label: r.label, kind: i < 2 ? 'Family reading' : 'Secret reading', chapters }
}

export function PaperPage({ date }: { date: string; edition?: Edition }) {
  const userPrefs = usePrefs()
  const canBack = useCanGoBack()
  // Back to where you came from; if the phone doesn't move within a moment (no history, or a Home Screen app quirk),
  // go straight to Today so you're never stuck on the paper.
  function leave() {
    const here = location.hash
    if (canBack) history.back()
    setTimeout(() => { if (location.hash === here) go({ page: 'today' }) }, canBack ? 350 : 0)
  }
  // When the PC makes the PDF it passes the translation in the address.
  const trParam = new URLSearchParams(location.search).get('tr')
  const prefs = trParam === 'KJV' || trParam === 'BSB' ? { ...userPrefs, translation: trParam as 'KJV' | 'BSB' } : { ...userPrefs, translation: localTr(userPrefs.translation) }
  const day = parseDay(date)
  const data = useAsync(async () => {
    const plan = await loadPlan()
    const readings = plan[planIndex(day)] ?? []
    const passages = await Promise.all(readings.map((r, i) => passageText(r, i, prefs.translation as Translation)))
    const me = await loadReadings()
    const pick = (p: 'morning' | 'evening') => me.find(r => r.date === dateKey(day) && r.period === p) ?? null
    return { passages, morning: pick('morning'), evening: pick('evening'), day: planIndex(day) + 1 }
  }, [date, prefs.translation])
  const [memory] = useState(() => dueMems())
  useEffect(() => { document.title = `The Daily Word, ${day.toDateString()}` ; return () => { document.title = 'YHWH' } }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  // The PDF is made as soon as the paper opens (by the PC, which lays it out exactly as previewed; or, if the PC can't be
  // reached, typeset on the phone). Then a single tap hands the finished file to the share sheet, which on iPhone has
  // Print and Save to Files. Sharing has to happen straight from the tap, which is why the file is ready beforehand.
  const [pdf, setPdf] = useState<File | null>(null)
  const name = `The Daily Word ${date}.pdf`
  async function localPdf(): Promise<Blob> {
    const { buildPaper } = await import('../lib/newspaper')
    const src = prefs.translation === 'KJV' ? 'King James Version' : 'Berean Standard Bible'
    const dateLine = day.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const d = data!
    const idx: [string, string][] = d.passages.map(p => [p.kind.replace(' reading', ''), p.label])
    if (d.evening) idx.splice(Math.min(2, idx.length), 0, ['Evening', d.evening.scripture])
    if (memory.length) idx.push(['Memory', memory.slice(0, 3).map(m => formatRef(m.s, m.e)).join(', ')])
    const blocks: Block[] = [
      { kind: 'masthead', title: 'The Daily Word', edition: 'Daily Edition', dayLine: `Day ${d.day} of 365`, dateLine, source: src, first: true },
      ...(idx.length ? [{ kind: 'index', items: idx } as Block] : []),
      ...(d.morning ? [devotionBlock(d.morning)] : []),
      ...d.passages.slice(0, 2).map(passageBlock),
      ...(d.evening ? [devotionBlock(d.evening)] : []),
      ...d.passages.slice(2).map(passageBlock),
    ]
    return buildPaper(blocks, `The Daily Word · ${dateLine} · Scripture: ${src} (public domain) · Devotions: C. H. Spurgeon, Morning and Evening`)
  }
  // (Not when this page is itself being turned into the PDF on the PC: that would ask the PC for another copy.)
  const makingOnPc = new URLSearchParams(location.search).has('pdf')
  useEffect(() => {
    if (!data || makingOnPc) return
    let live = true
    setPdf(null)
    ;(async () => {
      let blob: Blob | null = null
      try {
        const r = await fetch(`/api/paper.pdf?date=${date}&edition=full&tr=${prefs.translation}`, { signal: AbortSignal.timeout(30_000) })
        if (r.ok && (r.headers.get('content-type') ?? '').includes('pdf')) blob = await r.blob()
      } catch { /* PC out of reach */ }
      if (!blob) blob = await localPdf().catch(() => null)
      if (live && blob) setPdf(new File([blob], name, { type: 'application/pdf' }))
    })()
    return () => { live = false }
  }, [data, date, prefs.translation]) // eslint-disable-line react-hooks/exhaustive-deps
  async function sharePdf() {
    if (!pdf) return
    if (navigator.canShare?.({ files: [pdf] })) {
      try { await navigator.share({ files: [pdf], title: name }) } catch { /* closed the share sheet */ }
      return
    }
    // Computers: open the PDF in a new tab to print or save.
    const url = URL.createObjectURL(pdf)
    if (!window.open(url, '_blank')) { const a = document.createElement('a'); a.href = url; a.download = name; a.click() }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="paper-root">
      <div className="paper-tools">
        <button className="text-btn paper-back" onClick={leave}><IconLeft size={16} />Back</button>
        {/* The PC makes the PDF: iPhone Safari can't print newspaper columns, so its own Print gives one long column. */}
        <span className="paper-actions">
          <button className="primary-btn" disabled={!pdf} onClick={sharePdf}>{pdf ? 'Print or save PDF' : 'Preparing PDF…'}</button>
        </span>
      </div>
      {!data ? <div className="loading-lines"><span /><span /><span /></div> : (
        <Issue title="The Daily Word" edition="Daily Edition" day={day} planDay={data.day} tr={prefs.translation}
          lead={data.morning} second={data.evening} passages={data.passages} memory={memory} />
      )}
    </div>
  )
}

function Issue({ title, edition, day, planDay, tr, lead, second, passages, memory }: {
  title: string; edition: string; day: Date; planDay: number; tr: string
  lead: Reading | null; second?: Reading | null; passages: Passage[]; memory?: ReturnType<typeof dueMems>
}) {
  const dateLine = day.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <article className="paper">
      <header className="masthead">
        <div className="mh-top"><span>{edition}</span><span>Day {planDay} of 365</span><span>M'Cheyne Reading Plan</span></div>
        <h1>{title}</h1>
        <div className="mh-rule"><span>{dateLine}</span><span>YHWH</span><span>{tr === 'KJV' ? 'King James Version' : 'Berean Standard Bible'}</span></div>
      </header>

      <section className="front">
        {lead && <Devotion r={lead} lead />}
        {(passages.length > 0 || (memory && memory.length > 0)) && (
          <aside className="index-box">
            <h3>In this edition</h3>
            <ol>{passages.slice(0, 2).map(p => <li key={p.label}><span>{p.kind}</span>{p.label}</li>)}{second && <li><span>Evening</span>{second.scripture}</li>}{passages.slice(2).map(p => <li key={p.label}><span>{p.kind}</span>{p.label}</li>)}</ol>
            {memory && memory.length > 0 && (
              <>
                <h3>Memory today</h3>
                <ul>{memory.slice(0, 5).map(m => <li key={m._id}>{formatRef(m.s, m.e)}</li>)}</ul>
              </>
            )}
          </aside>
        )}
      </section>

      {passages.map((p, i) => (<Fragment key={p.label}>
        {i === 2 && second && <section className="story"><Devotion r={second} /></section>}
        <section className="story">
          <p className="kicker">{p.kind}</p>
          <h2>{p.label}</h2>
          <div className="columns scripture-cols">
            {p.chapters.map(ch => (
              <div key={`${ch.b}-${ch.c}`} className="ch">
                {p.chapters.length > 1 && <h4>{bookById(ch.b)?.name === 'Psalms' ? 'Psalm' : bookById(ch.b)?.name} {ch.c}</h4>}
                <p>{ch.verses.map(([v, t]) => <span key={v}><sup>{v}</sup>{t} </span>)}</p>
              </div>
            ))}
          </div>
        </section>
      </Fragment>))}
      {passages.length <= 2 && second && <section className="story"><Devotion r={second} /></section>}

      <footer className="colophon">
        Printed from YHWH. Scripture from the {tr === 'KJV' ? 'King James Version' : 'Berean Standard Bible'} (public domain).
        Devotions from C. H. Spurgeon, Morning and Evening (1865–1868).
      </footer>
    </article>
  )
}

function Devotion({ r, lead }: { r: Reading; lead?: boolean }) {
  const html = renderSpurgeon(r.text)
  return (
    <div className={lead ? 'devotion lead' : 'devotion'}>
      <p className="kicker">{r.period === 'morning' ? 'Morning' : 'Evening'} · C. H. Spurgeon</p>
      <h2 className="headline">“{r.verse}”</h2>
      <p className="dek">{r.scripture}</p>
      <div className="columns prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
