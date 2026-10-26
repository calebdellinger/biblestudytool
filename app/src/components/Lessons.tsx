// Lessons: prepare teaching material and work through it as you build it, then present it or print a handout.
// A lesson is sections made of blocks: teaching text, verses, Hebrew/Greek words, discussion questions and prep notes.
// Prep notes are yours alone: they never appear when presenting or on the handout.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatRef, localTr, splitVid } from '../lib/bible'
import { deleteLesson, saveLesson, type Lesson, type LessonBlock, type LessonSection } from '../lib/db'
import { go, useAsync, usePrefs, useStore } from '../lib/hooks'
import { importSeed, lessons, newLesson, SEEDS, uid, verseBlock, versesFor } from '../lib/lessons'
import { concordance, displayStrong, lexEntry } from '../lib/original'
import { renderSpurgeon } from '../lib/spurgeon'
import { IconClose, IconDown, IconLeft, IconRight, IconTrash } from './Icons'

const KIND_LABEL: Record<LessonBlock['t'], string> = { text: 'Teaching text', verse: 'Verse', word: 'Hebrew/Greek word', question: 'Discussion question', prep: 'Prep note (only you)' }

/* ---------- the list ---------- */
export function LessonsPage() {
  const store = useStore()
  const list = useMemo(() => lessons(), [store.lessons]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const have = new Set(list.map(l => l.seed).filter(Boolean))
  return (
    <main className="page lessons-page">
      <header className="page-head">
        <h1>Lessons</h1>
        <p>Prepare what you'll teach, work through it as you go, then present it or print a handout.</p>
      </header>
      {list.length > 0 && (
        <ul className="lesson-list">
          {list.map(l => (
            <li key={l._id}>
              <a className="lesson-row" href={`#/lessons/${encodeURIComponent(l._id)}`}>
                <span className="lesson-row-title">{l.title}</span>
                {l.subtitle && <span className="lesson-row-sub">{l.subtitle}</span>}
                <span className="lesson-row-meta">{l.sections.length} {l.sections.length === 1 ? 'section' : 'sections'} · edited {new Date(l.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <section className="lesson-new">
        <h2>Start a lesson</h2>
        <form className="mem-add" onSubmit={async e => { e.preventDefault(); const l = await newLesson(title.trim()); setTitle(''); go({ page: 'lesson', id: l._id }) }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title, e.g. The Fruit of the Spirit" aria-label="Lesson title" />
          <button className="primary-btn" type="submit">Create</button>
        </form>
        {SEEDS.filter(s => !have.has(s.id)).map(s => (
          <div key={s.id} className="lesson-seed">
            <div><strong>{s.title}</strong><span className="muted"> · {s.subtitle}</span>
              <p className="hint small">Written for you to teach from: every name with its Hebrew, where it first appears, key verses, a deep dive, how it points to Christ, and questions. Add it, then make it your own.</p></div>
            <button className="primary-btn small" disabled={busy === s.id} onClick={async () => { setBusy(s.id); const l = await importSeed(s.id); go({ page: 'lesson', id: l._id }) }}>{busy === s.id ? 'Adding…' : 'Add to my lessons'}</button>
          </div>
        ))}
      </section>
    </main>
  )
}

/* ---------- one lesson ---------- */
export function LessonPage({ id, mode, at }: { id: string; mode?: 'present' | 'handout'; at?: string }) {
  const store = useStore()
  const saved = store.lessons.get(id)
  const [draft, setDraft] = useState<Lesson | null>(null)
  const timer = useRef(0)
  useEffect(() => { setDraft(null) }, [id])
  const lesson = draft ?? saved ?? null
  const update = useCallback((f: (l: Lesson) => Lesson) => {
    setDraft(cur => {
      const next = f(cur ?? saved!)
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => saveLesson(next).then(() => setDraft(d => (d === next ? null : d))), 800)
      return next
    })
  }, [saved])
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!store.ready) return <main className="page"><div className="loading-lines"><span /><span /></div></main>
  if (!lesson || lesson.deleted) return <main className="page"><a className="back-link" href="#/lessons"><IconLeft size={16} />Lessons</a><p className="empty"><span>This lesson isn't here.</span></p></main>
  if (mode === 'present') return <Present lesson={lesson} at={at} />
  if (mode === 'handout') return <Handout lesson={lesson} />
  return <LessonView lesson={lesson} update={update} />
}

function LessonView({ lesson, update }: { lesson: Lesson; update: (f: (l: Lesson) => Lesson) => void }) {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(lesson.sections[0]?.id)
  const setSec = (sid: string, f: (s: LessonSection) => LessonSection) => update(l => ({ ...l, sections: l.sections.map(s => (s.id === sid ? f(s) : s)) }))
  const moveSec = (i: number, d: number) => update(l => { const a = [...l.sections]; const j = i + d; if (j < 0 || j >= a.length) return l; [a[i], a[j]] = [a[j], a[i]]; return { ...l, sections: a } })
  useEffect(() => {
    // keep the contents list in step with what's on screen
    const io = new IntersectionObserver(es => { const v = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setCurrent(v.target.id.slice(4)) }, { rootMargin: '-80px 0px -60% 0px' })
    document.querySelectorAll('.lesson-sec').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [lesson.sections.length])
  const jump = (sid: string) => document.getElementById(`sec-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <main className="page lesson-page">
      <a className="back-link" href="#/lessons"><IconLeft size={16} />Lessons</a>
      <header className="lesson-head">
        {editing ? (
          <>
            <input className="lesson-title-in" value={lesson.title} onChange={e => update(l => ({ ...l, title: e.target.value }))} aria-label="Lesson title" />
            <input className="lesson-sub-in" value={lesson.subtitle ?? ''} onChange={e => update(l => ({ ...l, subtitle: e.target.value }))} placeholder="Subtitle (optional)" aria-label="Subtitle" />
          </>
        ) : (
          <>
            <h1>{lesson.title}</h1>
            {lesson.subtitle && <p className="lesson-sub">{lesson.subtitle}</p>}
          </>
        )}
        <div className="lesson-actions">
          <button className="primary-btn" onClick={() => go({ page: 'lesson', id: lesson._id, mode: 'present', at: current })}>Present</button>
          <button className="text-btn" onClick={() => go({ page: 'lesson', id: lesson._id, mode: 'handout' })}>Handout</button>
          <button className={`text-btn ${editing ? 'is-on' : ''}`} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit'}</button>
        </div>
      </header>

      <div className="lesson-layout">
        <nav className="lesson-toc" aria-label="Sections">
          <select className="field lesson-toc-select" value={current} onChange={e => jump(e.target.value)} aria-label="Go to section">
            {lesson.sections.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
          </select>
          <ol className="lesson-toc-list">
            {lesson.sections.map(s => <li key={s.id}><button className={current === s.id ? 'is-on' : ''} onClick={() => jump(s.id)}>{s.title}</button></li>)}
          </ol>
        </nav>
        <div className="lesson-body">
          {lesson.sections.map((sec, i) => (
            <section key={sec.id} id={`sec-${sec.id}`} className="lesson-sec">
              {editing ? (
                <div className="lesson-sec-edit">
                  <input className="lesson-sec-title-in" value={sec.title} onChange={e => setSec(sec.id, s => ({ ...s, title: e.target.value }))} aria-label="Section title" />
                  <input className="lesson-sub-in" value={sec.subtitle ?? ''} onChange={e => setSec(sec.id, s => ({ ...s, subtitle: e.target.value }))} placeholder="Subtitle (optional)" aria-label="Section subtitle" />
                  <span className="lesson-tools">
                    <button className="icon-btn small" aria-label="Move section up" disabled={i === 0} onClick={() => moveSec(i, -1)}>↑</button>
                    <button className="icon-btn small" aria-label="Move section down" disabled={i === lesson.sections.length - 1} onClick={() => moveSec(i, 1)}>↓</button>
                    <button className="icon-btn small danger" aria-label="Delete section" onClick={() => { if (confirm(`Delete the section "${sec.title}"?`)) update(l => ({ ...l, sections: l.sections.filter(s => s.id !== sec.id) })) }}><IconTrash size={15} /></button>
                  </span>
                </div>
              ) : (
                <header className="lesson-sec-head">
                  <p className="lesson-sec-n">{i + 1}</p>
                  <h2>{sec.title}</h2>
                  {sec.subtitle && <p className="lesson-sec-sub">{sec.subtitle}</p>}
                </header>
              )}
              <Blocks sec={sec} editing={editing} onChange={f => setSec(sec.id, f)} />
            </section>
          ))}
          {editing && <button className="text-btn" onClick={() => update(l => ({ ...l, sections: [...l.sections, { id: uid(), title: 'New section', blocks: [{ id: uid(), t: 'text', text: '' }] }] }))}>+ Add a section</button>}
          {editing && (
            <p className="lesson-danger"><button className="text-btn danger" onClick={async () => { if (confirm(`Delete the whole lesson "${lesson.title}"?`)) { await deleteLesson(lesson); go({ page: 'lessons' }) } }}>Delete this lesson</button></p>
          )}
        </div>
      </div>
    </main>
  )
}

function Blocks({ sec, editing, onChange }: { sec: LessonSection; editing: boolean; onChange: (f: (s: LessonSection) => LessonSection) => void }) {
  const [adding, setAdding] = useState(false)
  const setBlock = (id: string, b: LessonBlock) => onChange(s => ({ ...s, blocks: s.blocks.map(x => (x.id === id ? b : x)) }))
  const move = (i: number, d: number) => onChange(s => { const a = [...s.blocks]; const j = i + d; if (j < 0 || j >= a.length) return s; [a[i], a[j]] = [a[j], a[i]]; return { ...s, blocks: a } })
  const add = (t: LessonBlock['t']) => {
    const b: LessonBlock = t === 'verse' ? { id: uid(), t, s: 0, e: 0, ref: '' } : t === 'word' ? { id: uid(), t, strong: '' } : { id: uid(), t, text: '' }
    onChange(s => ({ ...s, blocks: [...s.blocks, b] })); setAdding(false)
  }
  let q = 0
  return (
    <div className="lesson-blocks">
      {sec.blocks.map((b, i) => {
        if (b.t === 'question') q++
        return (
          <div key={b.id} className={`lb lb-${b.t} ${editing ? 'is-editing' : ''}`}>
            {editing && (
              <div className="lb-bar">
                <span className="lb-kind">{KIND_LABEL[b.t]}</span>
                <button className="icon-btn small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="icon-btn small" aria-label="Move down" disabled={i === sec.blocks.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="icon-btn small danger" aria-label="Delete block" onClick={() => onChange(s => ({ ...s, blocks: s.blocks.filter(x => x.id !== b.id) }))}><IconTrash size={14} /></button>
              </div>
            )}
            <Block b={b} n={q} editing={editing} onChange={nb => setBlock(b.id, nb)} />
          </div>
        )
      })}
      {editing && (adding ? (
        <div className="lb-add">
          {(['text', 'verse', 'word', 'question', 'prep'] as LessonBlock['t'][]).map(t => <button key={t} className="chip-btn" onClick={() => add(t)}>{KIND_LABEL[t]}</button>)}
          <button className="icon-btn small" aria-label="Cancel" onClick={() => setAdding(false)}><IconClose size={14} /></button>
        </div>
      ) : <button className="text-btn small lb-add-btn" onClick={() => setAdding(true)}>+ Add to this section</button>)}
    </div>
  )
}

function AutoText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const t = ref.current; if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px` } }, [value])
  return <textarea ref={ref} className="field lb-text-in" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} />
}

function Block({ b, n, editing, onChange }: { b: LessonBlock; n: number; editing: boolean; onChange: (b: LessonBlock) => void }) {
  if (b.t === 'text') return editing
    ? <AutoText value={b.text} onChange={text => onChange({ ...b, text })} placeholder="Teaching text. **bold**, *italic*, and references like John 3:16 become links." />
    : b.text.trim() ? <div className="sp-prose lb-prose" dangerouslySetInnerHTML={{ __html: renderSpurgeon(b.text) }} /> : null
  if (b.t === 'question') return editing
    ? <AutoText value={b.text} onChange={text => onChange({ ...b, text })} placeholder="A question to discuss" />
    : <p className="lb-q"><span className="lb-q-n">{n}</span><span dangerouslySetInnerHTML={{ __html: renderSpurgeon(b.text).replace(/^<p>|<\/p>\s*$/g, '') }} /></p>
  if (b.t === 'prep') return editing
    ? <AutoText value={b.text} onChange={text => onChange({ ...b, text })} placeholder="Notes to yourself: what to stress, a story to tell, timing…" />
    : b.text.trim() ? <aside className="lb-prepnote"><span className="lb-prep-label">Prep note · only you see this</span><div className="sp-prose" dangerouslySetInnerHTML={{ __html: renderSpurgeon(b.text) }} /></aside> : null
  if (b.t === 'verse') return editing ? <VerseEdit b={b} onChange={onChange} /> : <VerseQuote s={b.s} e={b.e} />
  return editing ? <WordEdit b={b} onChange={onChange} /> : <WordCard strong={b.strong} note={b.note} />
}

function VerseEdit({ b, onChange }: { b: Extract<LessonBlock, { t: 'verse' }>; onChange: (b: LessonBlock) => void }) {
  const [text, setText] = useState(b.ref)
  const parsed = verseBlock(text, b.id)
  return (
    <div className="lb-ref-edit">
      <input className="field" value={text} onChange={e => { setText(e.target.value); const v = verseBlock(e.target.value, b.id); if (v) onChange(v) }} placeholder="Reference, e.g. Exodus 3:14-15" aria-label="Verse reference" />
      <span className="hint small">{text.trim() ? (parsed ? formatRef(parsed.s, parsed.e) : 'Not recognised yet') : ''}</span>
      {b.s > 0 && <VerseQuote s={b.s} e={b.e} />}
    </div>
  )
}
function WordEdit({ b, onChange }: { b: Extract<LessonBlock, { t: 'word' }>; onChange: (b: LessonBlock) => void }) {
  return (
    <div className="lb-ref-edit">
      <input className="field" value={b.strong} onChange={e => onChange({ ...b, strong: e.target.value.toUpperCase().replace(/\s+/g, '') })} placeholder="Strong's number, e.g. H430 or G26" aria-label="Strong's number" />
      <input className="field" value={b.note ?? ''} onChange={e => onChange({ ...b, note: e.target.value })} placeholder="What it means here (optional)" aria-label="Meaning" />
      <p className="hint small">Tip: open any word in the Hebrew/Greek panel while reading to find its number.</p>
      {b.strong && <WordCard strong={b.strong} note={b.note} />}
    </div>
  )
}

/** A verse set off like a card, linked to the passage. */
export function VerseQuote({ s, e, big }: { s: number; e: number; big?: boolean }) {
  const prefs = usePrefs()
  const tr = localTr(prefs.translation)
  const text = useAsync(() => versesFor(s, e, tr), [s, e, tr])
  const { b, c, v } = splitVid(s)
  return (
    <figure className={`lesson-verse ${big ? 'is-big' : ''}`}>
      <blockquote>{text ?? '…'}</blockquote>
      <figcaption><a className="ref-link" href={`#/read/${b}/${c}/${v}`}>{formatRef(s, e)}</a> <span className="muted">{tr}</span></figcaption>
    </figure>
  )
}

/** The Hebrew or Greek word: dictionary form, sound, meaning, how often it's used, and a way into the full word study. */
export function WordCard({ strong, note, big }: { strong: string; note?: string; big?: boolean }) {
  const lex = useAsync(() => lexEntry(strong).catch(() => null), [strong])
  const conc = useAsync(() => concordance(strong).catch(() => null), [strong])
  if (lex === undefined) return <div className="lesson-word is-loading" />
  if (!lex) return <p className="hint small">No dictionary entry for “{strong}”.</p>
  const heb = strong.toUpperCase().startsWith('H')
  const count = conc?.c.occ.length
  return (
    <div className={`lesson-word ${big ? 'is-big' : ''}`}>
      <p className={`lw-lemma ${heb ? 'hebrew' : 'greek'}`} lang={heb ? 'he' : 'grc'} dir={heb ? 'rtl' : 'ltr'}>{lex.lemma}</p>
      <p className="lw-sub"><span className="lw-translit">{lex.translit.replace(/\./g, '')}</span><span className="wd-strong">{displayStrong(conc?.key ?? strong)}</span></p>
      <p className="lw-gloss">{note || lex.gloss.replace(/^[:\s]+/, '')}</p>
      {!big && (
        <p className="lw-more">
          {count ? <span className="muted">{count.toLocaleString()} {count === 1 ? 'place' : 'places'} in Scripture · </span> : null}
          <a className="ref-link" href={`#/word/${encodeURIComponent(conc?.key ?? strong)}`}>Study this word</a>
        </p>
      )}
    </div>
  )
}

/* ---------- presenting ---------- */
type Slide = { kind: 'title' } | { kind: 'section'; sec: LessonSection; n: number } | { kind: 'block'; sec: LessonSection; b: LessonBlock; q?: number }
function slidesOf(l: Lesson, withText: boolean): Slide[] {
  const out: Slide[] = [{ kind: 'title' }]
  l.sections.forEach((sec, i) => {
    out.push({ kind: 'section', sec, n: i + 1 })
    let q = 0, firstWord = true
    for (const b of sec.blocks) {
      if (b.t === 'prep') continue
      if (b.t === 'word' && firstWord) { firstWord = false; continue }   // shown on the section's title slide
      if (b.t === 'text' && (!withText || !b.text.trim())) continue
      if (b.t === 'verse' && !b.s) continue
      out.push({ kind: 'block', sec, b, q: b.t === 'question' ? ++q : undefined })
    }
  })
  return out
}

function Present({ lesson, at }: { lesson: Lesson; at?: string }) {
  const [withText, setWithText] = useState(false)
  const slides = useMemo(() => slidesOf(lesson, withText), [lesson, withText])
  const [i, setI] = useState(() => Math.max(0, slidesOf(lesson, false).findIndex(s => s.kind === 'section' && s.sec.id === at)))
  const [toc, setToc] = useState(false)
  const n = slides.length
  const goTo = useCallback((k: number) => setI(Math.max(0, Math.min(n - 1, k))), [n])
  const exit = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); go({ page: 'lesson', id: lesson._id }) }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); goTo(i + 1) }
      if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); goTo(i - 1) }
      if (e.key === 'Escape') exit()
      if (e.key === 'Home') goTo(0)
      if (e.key === 'End') goTo(n - 1)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })
  const touch = useRef<[number, number] | null>(null)
  const s = slides[Math.min(i, n - 1)]
  const sectionOfSlide = s.kind === 'title' ? null : s.sec
  const word = sectionOfSlide?.blocks.find((b): b is Extract<LessonBlock, { t: 'word' }> => b.t === 'word')

  return createPortal(
    <div className="present" role="dialog" aria-label={`Presenting ${lesson.title}`}
      onTouchStart={e => { touch.current = [e.touches[0].clientX, e.touches[0].clientY] }}
      onTouchEnd={e => {
        const t = touch.current; touch.current = null; if (!t) return
        const dx = e.changedTouches[0].clientX - t[0], dy = e.changedTouches[0].clientY - t[1]
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) goTo(i + (dx < 0 ? 1 : -1))
      }}>
      <div className="present-top">
        <button className="present-btn" onClick={exit} aria-label="Stop presenting"><IconClose /></button>
        <button className="present-btn present-label" onClick={() => setToc(!toc)}>{sectionOfSlide ? sectionOfSlide.title : lesson.title}<IconDown size={14} /></button>
        <span className="present-right">
          <button className={`present-btn small ${withText ? 'is-on' : ''}`} onClick={() => setWithText(!withText)} title="Show your teaching text on slides too">Teaching text</button>
          {document.fullscreenEnabled && <button className="present-btn small" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>Full screen</button>}
        </span>
      </div>
      {toc && (
        <ol className="present-toc">
          {slides.map((sl, k) => (sl.kind === 'section' ? <li key={k}><button onClick={() => { goTo(k); setToc(false) }}>{sl.n}. {sl.sec.title}</button></li> : null))}
        </ol>
      )}
      <div className="present-stage" onClick={e => { const x = e.clientX / innerWidth; goTo(i + (x < 0.3 ? -1 : 1)) }}>
        <div key={i} className={`slide slide-${s.kind === 'block' ? s.b.t : s.kind}`}>
          {s.kind === 'title' && (
            <>
              <p className="slide-kicker">Lesson</p>
              <h1 className="slide-title">{lesson.title}</h1>
              {lesson.subtitle && <p className="slide-sub">{lesson.subtitle}</p>}
            </>
          )}
          {s.kind === 'section' && (
            <>
              <p className="slide-kicker">{s.n} of {lesson.sections.length}</p>
              {word ? <WordCard strong={word.strong} note={word.note} big /> : null}
              <h1 className="slide-title">{s.sec.title}</h1>
              {s.sec.subtitle && <p className="slide-sub">{s.sec.subtitle}</p>}
            </>
          )}
          {s.kind === 'block' && s.b.t === 'verse' && <VerseQuote s={s.b.s} e={s.b.e} big />}
          {s.kind === 'block' && s.b.t === 'word' && <WordCard strong={s.b.strong} note={s.b.note} big />}
          {s.kind === 'block' && s.b.t === 'question' && (
            <>
              <p className="slide-kicker">Discuss · {s.q}</p>
              <p className="slide-question" dangerouslySetInnerHTML={{ __html: renderSpurgeon(s.b.text).replace(/<\/?p>/g, '') }} />
            </>
          )}
          {s.kind === 'block' && s.b.t === 'text' && <div className="sp-prose slide-text" dangerouslySetInnerHTML={{ __html: renderSpurgeon(s.b.text) }} />}
        </div>
      </div>
      <div className="present-foot">
        <button className="present-btn" aria-label="Previous" disabled={i === 0} onClick={() => goTo(i - 1)}><IconLeft /></button>
        <div className="present-progress"><span style={{ width: `${((i + 1) / n) * 100}%` }} /></div>
        <span className="present-count">{i + 1} / {n}</span>
        <button className="present-btn" aria-label="Next" disabled={i === n - 1} onClick={() => goTo(i + 1)}><IconRight /></button>
      </div>
    </div>,
    document.body,
  )
}

/* ---------- handout ---------- */
function Handout({ lesson }: { lesson: Lesson }) {
  const [withText, setWithText] = useState(false)
  const [lines, setLines] = useState(true)
  const last = lesson.sections.length - 1
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(last)
  const opts = lesson.sections.map((s, i) => <option key={s.id} value={i}>{i + 1}. {s.title}</option>)
  return (
    <main className="page handout-page">
      <div className="handout-tools no-print">
        <a className="back-link" href={`#/lessons/${encodeURIComponent(lesson._id)}`}><IconLeft size={16} />{lesson.title}</a>
        <label className="handout-opt"><input type="checkbox" checked={withText} onChange={e => setWithText(e.target.checked)} /> Include teaching text</label>
        <label className="handout-opt"><input type="checkbox" checked={lines} onChange={e => setLines(e.target.checked)} /> Lines for answers</label>
        <label className="handout-opt">Sections <select className="field" value={from} onChange={e => { const v = +e.target.value; setFrom(v); if (to < v) setTo(v) }} aria-label="From section">{opts}</select>
          to <select className="field" value={to} onChange={e => { const v = +e.target.value; setTo(v); if (from > v) setFrom(v) }} aria-label="To section">{opts}</select></label>
        <button className="primary-btn" onClick={() => print()}>Print or save PDF</button>
      </div>
      <article className="handout">
        <header className="handout-head">
          <h1>{lesson.title}</h1>
          {lesson.subtitle && <p>{lesson.subtitle}</p>}
          <p className="handout-name">Name ____________________ &nbsp; Date __________</p>
        </header>
        {lesson.sections.map((sec, i) => {
          if (i < from || i > to) return null
          let q = 0
          const word = sec.blocks.find((b): b is Extract<LessonBlock, { t: 'word' }> => b.t === 'word')
          return (
            <section key={sec.id} className="handout-sec">
              <h2><span className="handout-n">{i + 1}</span>{sec.title}{sec.subtitle ? <span className="handout-subt"> · {sec.subtitle}</span> : null}</h2>
              {word && <HandoutWord strong={word.strong} note={word.note} />}
              {sec.blocks.map(b => {
                if (b.t === 'verse' && b.s) return <VerseQuote key={b.id} s={b.s} e={b.e} />
                if (b.t === 'text' && withText && b.text.trim()) return <div key={b.id} className="sp-prose" dangerouslySetInnerHTML={{ __html: renderSpurgeon(b.text) }} />
                if (b.t === 'question') return (
                  <div key={b.id} className="handout-q">
                    <p><strong>{++q}.</strong> <span dangerouslySetInnerHTML={{ __html: renderSpurgeon(b.text).replace(/<\/?p>/g, '') }} /></p>
                    {lines && <div className="handout-lines"><span /><span /><span /></div>}
                  </div>
                )
                return null
              })}
            </section>
          )
        })}
        <footer className="handout-foot">Scripture: {lesson.title} handout · prepared in YHWH</footer>
      </article>
    </main>
  )
}
function HandoutWord({ strong, note }: { strong: string; note?: string }) {
  const lex = useAsync(() => lexEntry(strong).catch(() => null), [strong])
  if (!lex) return null
  const heb = strong.toUpperCase().startsWith('H')
  return (
    <p className="handout-word">
      <span className={heb ? 'hebrew' : 'greek'} lang={heb ? 'he' : 'grc'}>{lex.lemma}</span>
      <em>{lex.translit.replace(/\./g, '')}</em> · {note || lex.gloss.replace(/^[:\s]+/, '')}
    </p>
  )
}
