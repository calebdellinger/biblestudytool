// Memory: this week's passages, three boxes, and a practice session.
import { useEffect, useMemo, useState } from 'react'
import { formatRef, splitVid, verseText, type Translation } from '../lib/bible'
import { parseQuery } from '../lib/refs'
import { go, useAsync, usePrefs, useStore } from '../lib/hooks'
import type { Grade, Mem, MemBox, MemPassage } from '../lib/db'
import {
  BOX_LABEL, SECTION_MAX, WEEKLY_GOAL, addMem, addPassage, dueCount, dueLabel, dueQueue, firstLetters, grade, gradeRun, hideOrder,
  memText, mems, knownSections, passageById, passages, removeMem, removePassage, runRange, sectionMems, sectionsOf, setCuts, singles,
  sortForPractice, suggestCuts, thisWeek, today, tokens, verseIds, weekStart,
} from '../lib/memory'
import { IconClose } from './Icons'

const PASSAGE_MAX = 80
const PENDING_KEY = 'margin.mem.pending'
/** Hand a verse range from the study panel to the Memory page, which opens the passage setup. */
export function memorizePassage(s: number, e: number) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ s, e })) } catch { /* private mode */ }
  go({ page: 'memory' })
}

export function MemoryPage() {
  const store = useStore()
  const prefs = usePrefs()
  const all = useMemo(() => singles(), [store.mems]) // eslint-disable-line react-hooks/exhaustive-deps
  const pass = useMemo(() => passages(), [store.passages]) // eslint-disable-line react-hooks/exhaustive-deps
  const dueN = useMemo(() => dueCount(), [store.mems, store.passages]) // eslint-disable-line react-hooks/exhaustive-deps
  const week = useMemo(() => thisWeek(), [store.mems]) // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [showKept, setShowKept] = useState(false)
  const [setup, setSetup] = useState<{ s: number; e: number } | null>(() => {
    try { const v = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); return v ? JSON.parse(v) : null } catch { return null }
  })

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const r = parseQuery(text.trim())
    if (!r) { setError('Type a reference like Ps 119:11, Rom 8:38-39 or Isaiah 55'); return }
    const n = verseIds(r.s, r.e).length
    if (n > PASSAGE_MAX) { setError(`That's ${n} verses. Try up to ${PASSAGE_MAX} at a time; a chapter or two works well.`); return }
    if (n > SECTION_MAX) { setSetup({ s: r.s, e: r.e }); setText(''); setError(''); return }
    if (Math.floor(r.s / 1000) !== Math.floor(r.e / 1000)) { setError('Keep a short passage within one chapter.'); return }
    await addMem(r.s, r.e, prefs.translation)
    setText(''); setError('')
  }

  const boxes: MemBox[] = ['not', 'almost', 'got']
  const kept = all.filter(m => m.box === 'kept')
  const next = [...all, ...pass.flatMap(p => sectionMems(p))].filter(m => m.due > today()).sort((a, b) => a.due.localeCompare(b.due))[0]
  const any = all.length > 0 || pass.length > 0

  return (
    <main className="page memory">
      <header className="page-head mem-head">
        <div>
          <h1>Memory</h1>
          <p>{dueN
            ? `${dueN} ${dueN === 1 ? 'thing' : 'things'} to practise today`
            : any ? `All caught up.${next ? ` Next review ${dueLabel(next.due).toLowerCase() === 'tomorrow' ? 'tomorrow' : `on ${dueLabel(next.due)}`}.` : ''}` : 'Hide a few verses in your heart each week, or a whole passage a little at a time.'}</p>
        </div>
        <div className="mem-head-actions">
          {any && <a className="text-btn" href="#/memory/record">Your record</a>}
          {dueN > 0 && <button className="primary-btn mem-go" onClick={() => go({ page: 'practice' })}>Practise</button>}
        </div>
      </header>

      <section className="mem-week">
        <div className="mem-week-head">
          <h2>This week <span className="mem-week-n">{week.length} of {WEEKLY_GOAL}</span></h2>
          <span className="mem-goal" aria-label={`${week.length} of ${WEEKLY_GOAL} this week`}>
            {Array.from({ length: Math.max(WEEKLY_GOAL, week.length) }, (_, i) => <span key={i} className={i < week.length ? 'is-on' : ''} />)}
          </span>
        </div>
        <form className="mem-add" onSubmit={add}>
          <input value={text} onChange={e => { setText(e.target.value); setError('') }} placeholder="Add verses, e.g. Ps 119:11 or Isaiah 55"
            aria-label="Verses to memorize" autoComplete="off" spellCheck={false} enterKeyHint="done" />
          <button className="primary-btn" type="submit" disabled={!text.trim()}>Add</button>
        </form>
        {error && <p className="sel-error">{error}</p>}
        {!error && week.length >= WEEKLY_GOAL && <p className="hint">That's a full week. More than five new verses at once tends to crowd out the ones you're learning.</p>}
        {!error && !any && <p className="hint">One to three verses are learned whole. Four or more become a passage, learned a few verses at a time; passages don't count toward the weekly five.</p>}
      </section>

      {setup && <PassageSetup s={setup.s} e={setup.e} tr={prefs.translation} onClose={() => setSetup(null)} />}

      {pass.length > 0 && (
        <section className="mem-passages">
          <h2>Passages</h2>
          <ul className="mem-list">{pass.sort((a, b) => a.s - b.s).map(p => <PassageCard key={p._id} p={p} />)}</ul>
        </section>
      )}

      {all.length > 0 && (
        <section className="mem-boxes" aria-label="Boxes">
          {boxes.map(b => {
            const list = sortForPractice(all.filter(m => m.box === b))
            return (
              <div key={b} className={`mem-box box-${b}`}>
                <h3>{BOX_LABEL[b]}<span className="tab-count">{list.length || ''}</span></h3>
                <p className="mem-box-rule">{b === 'not' ? 'Every day' : b === 'almost' ? 'Every couple of days' : 'Spacing out: 3, 7, 14 days'}</p>
                {list.length ? <ul className="mem-list">{list.map(m => <MemRow key={m._id} m={m} />)}</ul> : <p className="mem-empty">Empty</p>}
              </div>
            )
          })}
        </section>
      )}

      {kept.length > 0 && (
        <section className="mem-kept">
          <button className="mem-kept-toggle" aria-expanded={showKept} onClick={() => setShowKept(!showKept)}>
            Kept <span className="tab-count">{kept.length}</span><span className="muted"> · reviewed monthly</span>
          </button>
          {showKept && <ul className="mem-list">{sortForPractice(kept).map(m => <MemRow key={m._id} m={m} />)}</ul>}
        </section>
      )}
    </main>
  )
}

function MemRow({ m }: { m: Mem }) {
  const text = useAsync(() => memText(m), [m.s, m.e, m.tr])
  const { b, c, v } = splitVid(m.s)
  const due = dueLabel(m.due)
  return (
    <li className="mem-row">
      <button className="mem-row-main" onClick={() => go({ page: 'practice', id: m._id })} aria-label={`Practise ${formatRef(m.s, m.e)}`}>
        <span className="mem-ref">{formatRef(m.s, m.e, true)}{m.added >= weekStart() && <span className="mem-new">New</span>}</span>
        <span className="mem-snip">{text?.join(' ')}</span>
      </button>
      <span className="mem-meta">
        <span className={due === 'Today' ? 'mem-due is-due' : 'mem-due'}>{due}</span>
        <a className="text-btn small" href={`#/read/${b}/${c}/${v}`}>Read</a>
        <button className="icon-btn small" aria-label={`Stop memorizing ${formatRef(m.s, m.e)}`} title="Remove"
          onClick={() => { if (confirm(`Stop memorizing ${formatRef(m.s, m.e)}?`)) removeMem(m) }}><IconClose size={15} /></button>
      </span>
    </li>
  )
}

/* ---------- passages ---------- */
/** Choose where a passage splits into sections. For a passage already started, only the part not yet opened can change. */
function PassageSetup({ s, e, tr, existing, onClose }: { s: number; e: number; tr: string; existing?: MemPassage; onClose: () => void }) {
  const ids = useMemo(() => verseIds(s, e), [s, e])
  const texts = useAsync(() => Promise.all(ids.map(v => verseText(tr as Translation, v).then(t => t ?? ''))), [ids, tr])
  const [cuts, setCutsState] = useState<number[] | null>(existing ? existing.cuts : null)
  useEffect(() => { if (texts && !cuts) setCutsState(suggestCuts(ids, texts)) }, [texts]) // eslint-disable-line react-hooks/exhaustive-deps
  const fixedEnd = existing ? sectionsOf(existing)[existing.open - 1][1] : 0
  const [busy, setBusy] = useState(false)
  if (!texts || !cuts) return <section className="mem-setup"><div className="loading-lines"><span /><span /></div></section>
  const toggle = (id: number) => { if (id <= fixedEnd) return; setCutsState(c => c!.includes(id) ? c!.filter(x => x !== id) : [...c!, id].sort((a, b) => a - b)) }
  const sections = sectionsOf({ s, e, cuts })
  const long = sections.filter(([a, b]) => verseIds(a, b).length > SECTION_MAX).length
  let n = 0
  async function save() {
    setBusy(true)
    if (existing) await setCuts(existing, cuts!); else await addPassage(s, e, tr, cuts!)
    onClose()
  }
  return (
    <section className="mem-setup" aria-label={`Set up ${formatRef(s, e)}`}>
      <div className="mem-setup-head">
        <h2>{formatRef(s, e)}</h2>
        <p className="hint">{sections.length} sections. You learn one at a time; the next opens once the last reaches Got it. Tap between two verses to split or join them.</p>
      </div>
      <ol className="mem-setup-list">
        {ids.map((id, i) => {
          const startsSection = i === 0 || cuts.includes(ids[i - 1])
          if (startsSection) n++
          const { c, v } = splitVid(id)
          const locked = id <= fixedEnd
          return (
            <li key={id}>
              {startsSection && <p className="mem-setup-sec">Section {n}{locked ? ' · started' : ''}</p>}
              <p className="mem-setup-verse"><sup>{v === 1 ? `${c}:1` : v}</sup> {texts[i] || <span className="muted">(not in this translation)</span>}</p>
              {i < ids.length - 1 && (
                <button className={`mem-gap ${cuts.includes(id) ? 'is-cut' : ''}`} disabled={locked} onClick={() => toggle(id)}
                  aria-label={cuts.includes(id) ? `Join verse ${v} to the next` : `Split after verse ${v}`}>
                  <span>{locked ? '' : cuts.includes(id) ? 'Join' : 'Split here'}</span>
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {long > 0 && <p className="hint">{long === 1 ? 'One section is' : `${long} sections are`} longer than {SECTION_MAX} verses. That works, but 2–3 verses stick better.</p>}
      <div className="button-row">
        <button className="primary-btn" disabled={busy} onClick={save}>{existing ? 'Save sections' : `Start learning · ${sections.length} sections`}</button>
        <button className="text-btn" onClick={onClose}>Cancel</button>
      </div>
    </section>
  )
}

function PassageCard({ p }: { p: MemPassage }) {
  useStore()
  const [edit, setEdit] = useState(false)
  const secs = sectionsOf(p)
  const ms = sectionMems(p)
  const learned = (i: number) => { const m = ms.find(x => x.idx === i); return !!m && (m.box === 'got' || m.box === 'kept') }
  let known = 0
  while (known < secs.length && learned(known)) known++
  const due = dueQueue(today(), `pass:${p._id}`).length
  const dates = [...ms.map(m => m.due), ...(p.run ? [p.run.due] : [])].sort()
  const first = splitVid(p.s)
  return (
    <li className="mem-pass">
      <div className="mem-pass-top">
        <a className="mem-ref" href={`#/read/${first.b}/${first.c}/${first.v}`}>{formatRef(p.s, p.e, true)}</a>
        <span className={due ? 'mem-due is-due' : 'mem-due'}>{due ? 'Today' : dates[0] ? dueLabel(dates[0]) : ''}</span>
      </div>
      <div className="mem-strip" aria-hidden="true">
        {secs.map(([a, b], i) => {
          const m = ms.find(x => x.idx === i)
          return <span key={i} className={m ? `box-${m.box}` : 'is-locked'} style={{ flexGrow: verseIds(a, b).length }} />
        })}
      </div>
      <p className="mem-pass-note">
        {known === secs.length ? 'You can say the whole passage from memory.'
          : known ? `You can say ${formatRef(p.s, secs[known - 1][1], true)} from memory.`
            : `Learning section 1 of ${secs.length}.`}
        {p.open < secs.length && known ? ` ${p.open} of ${secs.length} sections open.` : ''}
        {p.runs.length ? ` Last whole run: ${p.runs[p.runs.length - 1].missed.length ? 'a few stumbles' : 'clean'}.` : ''}
      </p>
      <div className="mem-pass-actions">
        {due > 0 && <button className="primary-btn small" onClick={() => go({ page: 'practice', id: `pass:${p._id}` })}>Practise</button>}
        {p.open < secs.length && <button className="text-btn small" onClick={() => setEdit(!edit)}>{edit ? 'Close' : 'Change sections'}</button>}
        <button className="text-btn small danger" onClick={() => { if (confirm(`Stop memorizing ${formatRef(p.s, p.e)}? Your progress on it will be removed.`)) removePassage(p) }}>Remove</button>
      </div>
      {edit && <PassageSetup s={p.s} e={p.e} tr={p.tr} existing={p} onClose={() => setEdit(false)} />}
    </li>
  )
}

/** Say everything learned so far in one go, then tap any verse you stumbled on; only those sections go back for practice. */
function RunCard({ p, onDone }: { p: MemPassage; onDone: (missedSections: number[]) => void }) {
  const [s, e] = runRange(p)
  const ids = useMemo(() => verseIds(s, e), [s, e])
  const texts = useAsync(() => Promise.all(ids.map(v => verseText(p.tr as Translation, v).then(t => t ?? ''))), [ids, p.tr])
  const [mode, setMode] = useState<'recall' | 'letters'>('recall')
  const [revealed, setRevealed] = useState(false)
  const [slips, setSlips] = useState<Set<number>>(new Set())
  const secs = sectionsOf(p)
  const missed = [...new Set([...slips].map(id => secs.findIndex(([a, b]) => a <= id && id <= b)).filter(i => i >= 0))].sort((a, b) => a - b)
  const flip = (id: number) => setSlips(x => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <article className="mem-card">
      <h1 className="mem-card-ref">{formatRef(s, e)}</h1>
      <p className="mem-card-meta">Everything learned so far · {knownSections(p)} sections · {p.tr}</p>
      <div className="seg small mem-modes" role="tablist">
        <button role="tab" aria-selected={mode === 'recall'} className={mode === 'recall' ? 'is-on' : ''} onClick={() => setMode('recall')}>Recall</button>
        <button role="tab" aria-selected={mode === 'letters'} className={mode === 'letters' ? 'is-on' : ''} onClick={() => setMode('letters')}>First letters</button>
      </div>
      <div className={`mem-text mode-${mode}`}>
        {!texts ? null : mode === 'recall' && !revealed
          ? <button className="recall-cover" onClick={() => setRevealed(true)}>Say it all from the start, then tap to check</button>
          : ids.map((id, i) => (
            <button key={id} className={`run-verse ${slips.has(id) ? 'is-slip' : ''}`} onClick={() => flip(id)} aria-pressed={slips.has(id)}>
              <sup>{splitVid(id).v}</sup>{mode === 'letters' ? tokens(texts[i]).map(firstLetters).join(' ') : texts[i]}{' '}
            </button>
          ))}
      </div>
      {(revealed || mode === 'letters') && (
        <>
          <p className="hint mem-hint">Tap any verse where you stumbled. Only those sections go back for practice.</p>
          <div className="button-row run-done">
            <button className="primary-btn" onClick={() => onDone(missed)}>
              {missed.length ? `Done · ${missed.length} ${missed.length === 1 ? 'section' : 'sections'} to practise` : 'Said it all'}
            </button>
          </div>
        </>
      )}
    </article>
  )
}

/* ---------- practice ---------- */
type Mode = 'read' | 'letters' | 'fade' | 'recall' | 'chain'
const MODES: { id: Mode; label: string }[] = [
  { id: 'read', label: 'Read' }, { id: 'letters', label: 'First letters' }, { id: 'fade', label: 'Fade' }, { id: 'recall', label: 'Recall' },
]
const CHAIN = { id: 'chain' as Mode, label: 'Chain' }
const startMode = (m: Mem): Mode => m.box === 'not' ? (m.reviews.length ? 'letters' : 'read') : m.box === 'almost' ? 'fade' : 'recall'

export function PracticePage({ id }: { id?: string }) {
  const store = useStore()
  // The queue is fixed when the session starts; a passage you miss comes round once more at the end.
  const [queue, setQueue] = useState<string[] | null>(null)
  const [pos, setPos] = useState(0)
  const [results, setResults] = useState<Grade[]>([])
  useEffect(() => {
    if (!store.ready) return
    setQueue(!id ? dueQueue() : id.startsWith('pass:') ? dueQueue(today(), id) : [id]); setPos(0); setResults([])
  }, [id, store.ready])

  if (!queue) return <main className="page" />
  const key = queue[pos]
  const run = key?.startsWith('run:') ? store.passages.find(p => p._id === key.slice(4) && !p.deleted) : undefined
  const current = run ? undefined : store.mems.find(m => m._id === key)
  if (!queue.length || (!current && !run)) {
    return (
      <main className="page practice">
        <div className="practice-done">
          <h1>{results.length ? 'Done for today' : 'Nothing due'}</h1>
          {results.length > 0 && (
            <p>{(['got', 'almost', 'not'] as Grade[]).map(g => [g, results.filter(r => r === g).length] as const).filter(([, n]) => n)
              .map(([g, n]) => `${n} ${BOX_LABEL[g].toLowerCase()}`).join(' · ')}</p>
          )}
          <button className="primary-btn" onClick={() => go({ page: 'memory' })}>Back to Memory</button>
        </div>
      </main>
    )
  }

  async function onRun(missed: number[]) {
    await gradeRun(run!, missed)
    setResults(r => [...r, missed.length ? 'almost' : 'got'])
    setPos(p => p + 1)
  }
  async function onGrade(g: Grade) {
    await grade(current!, g)
    setResults(r => [...r, g])
    const repeat = g === 'not' && queue!.filter(x => x === current!._id).length < 2
    if (repeat) setQueue(q => [...q!, current!._id])
    setPos(p => p + 1)
  }

  return (
    <main className="page practice">
      <div className="practice-top">
        <button className="icon-btn" onClick={() => go({ page: 'memory' })} aria-label="End practice"><IconClose /></button>
        <div className="practice-progress" aria-label={`${pos + 1} of ${queue.length}`}>
          <span style={{ width: `${(pos / queue.length) * 100}%` }} />
        </div>
        <span className="practice-count">{pos + 1} / {queue.length}</span>
      </div>
      {run ? <RunCard key={`${run._id}-${pos}`} p={run} onDone={onRun} /> : <Card key={`${current!._id}-${pos}`} m={current!} onGrade={onGrade} />}
    </main>
  )
}

function Card({ m, onGrade }: { m: Mem; onGrade: (g: Grade) => void }) {
  const verses = useAsync(() => memText(m), [m.s, m.e, m.tr])
  const passage = m.passage ? passageById(m.passage) : undefined
  const prevRange = passage && m.idx ? sectionsOf(passage)[m.idx - 1] : undefined
  const prev = useAsync(async () => prevRange ? memText({ s: prevRange[0], e: prevRange[1], tr: m.tr }) : null, [prevRange?.[0], prevRange?.[1], m.tr])
  const cue = useMemo(() => { const t = tokens((prev ?? []).join(' ')); return t.slice(-10).map(x => x.pre + x.word + x.post).join(' ') }, [prev])
  const modes = prevRange ? [...MODES, CHAIN] : MODES
  const [mode, setMode] = useState<Mode>(() => startMode(m))
  const [level, setLevel] = useState(2)       // fade: how many fifths of the words are hidden
  const [shown, setShown] = useState<Set<number>>(new Set()) // words you tapped to peek at
  const [revealed, setRevealed] = useState(false)
  const toks = useMemo(() => tokens((verses ?? []).join(' ')), [verses])
  const order = useMemo(() => hideOrder(toks.length, m.s), [toks.length, m.s])
  const hidden = useMemo(() => new Set(order.slice(0, Math.round((toks.length * level) / 5))), [order, level, toks.length])
  useEffect(() => { setShown(new Set()); setRevealed(false) }, [mode, level])

  const peek = (i: number) => setShown(s => new Set(s).add(i))
  const words = toks.map((t, i) => {
    if (mode === 'letters') return <span key={i}><span className="w">{firstLetters(t)}</span> </span>
    if (mode === 'fade' && hidden.has(i) && !shown.has(i) && t.word) {
      return <span key={i}><span className="w">{t.pre}<button className="blank" style={{ width: `${Math.max(1.6, t.word.length * 0.58)}em` }} onClick={() => peek(i)} aria-label="Show word" />{t.post}</span> </span>
    }
    return <span key={i}><span className="w">{t.pre}{t.word}{t.post}</span> </span>
  })

  return (
    <article className="mem-card">
      <h1 className="mem-card-ref">{formatRef(m.s, m.e)}</h1>
      <p className="mem-card-meta">{passage ? `${formatRef(passage.s, passage.e)} · section ${(m.idx ?? 0) + 1} of ${sectionsOf(passage).length} · ` : ''}{BOX_LABEL[m.box]} · {m.tr}</p>
      <div className="seg small mem-modes" role="tablist">
        {modes.map(x => <button key={x.id} role="tab" aria-selected={mode === x.id} className={mode === x.id ? 'is-on' : ''} onClick={() => setMode(x.id)}>{x.label}</button>)}
      </div>

      <div className={`mem-text mode-${mode}`} aria-live="polite">
        {!verses ? null : mode === 'chain' && !revealed
          ? <>
              <p className="chain-cue">…{cue}</p>
              <button className="recall-cover" onClick={() => setRevealed(true)}>Carry on from here, then tap to check</button>
            </>
          : mode === 'recall' && !revealed
            ? <button className="recall-cover" onClick={() => setRevealed(true)}>Say it from memory, then tap to check</button>
            : words}
      </div>

      {mode === 'fade' && (
        <div className="fade-ctl">
          <button className="text-btn small" disabled={level <= 1} onClick={() => setLevel(l => l - 1)}>Show more</button>
          <span className="fade-dots" aria-label={`${level} of 5 hidden`}>{[1, 2, 3, 4, 5].map(i => <span key={i} className={i <= level ? 'is-on' : ''} />)}</span>
          <button className="text-btn small" disabled={level >= 5} onClick={() => setLevel(l => l + 1)}>Hide more</button>
        </div>
      )}
      {mode === 'letters' && <p className="hint mem-hint">Say each word from its first letter.</p>}
      {mode === 'chain' && <p className="hint mem-hint">The joins between sections are where a long passage comes apart. This practises the step from the last section into this one.</p>}

      <div className="grade-row" role="group" aria-label="How did it go?">
        <button className="grade grade-not" onClick={() => onGrade('not')}><b>Not yet</b><span>Tomorrow</span></button>
        <button className="grade grade-almost" onClick={() => onGrade('almost')}><b>Almost</b><span>In 2 days</span></button>
        <button className="grade grade-got" onClick={() => onGrade('got')}><b>Got it</b><span>{gotLabel(m)}</span></button>
      </div>
    </article>
  )
}
function gotLabel(m: Mem) {
  const s = m.streak + 1
  if (m.box === 'kept' || s > 3) return 'In a month'
  return `In ${[3, 7, 14][s - 1]} days`
}

/** Small "Memorize" control for a verse range, used in the study panel. */
export function MemorizeButton({ s, e, tr }: { s: number; e: number; tr: string }) {
  const store = useStore()
  const m = useMemo(() => mems().find(x => x.s <= s && e <= x.e), [store.mems, s, e]) // eslint-disable-line react-hooks/exhaustive-deps
  const p = useMemo(() => passages().find(x => x.s <= s && e <= x.e), [store.passages, s, e]) // eslint-disable-line react-hooks/exhaustive-deps
  if (m || p) return <a className="add-note-btn is-quiet" href="#/memory" title={m ? `Memorizing · ${BOX_LABEL[m.box]}` : 'Part of a passage you are memorizing'}>Memorizing</a>
  const long = verseIds(s, e).length > SECTION_MAX
  return <button className="add-note-btn" onClick={() => (long ? memorizePassage(s, e) : addMem(s, e, tr))}>{long ? 'Memorize passage' : 'Memorize'}</button>
}
