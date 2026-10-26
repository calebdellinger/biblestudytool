// Where your reading time has gone: Scripture by book and chapter, and the sermons and books you've spent time in.
// No streaks, goals or scores: just time, and what you've chosen to mark as read.
import { useMemo, useState } from 'react'
import { books, type Book } from '../lib/bible'
import { useAsync } from '../lib/hooks'
import { loadLogs, useReadMarks, type LogDay } from '../lib/reading'
import { loadSermons } from '../lib/spurgeon'
import { loadLibrary } from '../lib/theologians'
import { IconLeft, IconRight } from './Icons'

type Mode = 'month' | 'year' | 'all'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MODE_KEY = 'margin.reading.mode'

export function dur(sec: number) {
  const m = Math.round(sec / 60)
  if (m < 1) return sec > 0 ? '<1 min' : '—'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

export function ReadingPage() {
  const logs = useAsync(loadLogs, [])
  const lib = useAsync(loadLibrary, [])
  const sermons = useAsync(loadSermons, [])
  const read = useReadMarks()
  const [mode, setModeRaw] = useState<Mode>(() => { try { return (localStorage.getItem(MODE_KEY) as Mode) || 'month' } catch { return 'month' } })
  const setMode = (m: Mode) => { setModeRaw(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode */ } }
  const today = new Date()
  const [y, setY] = useState(today.getFullYear())
  const [mo, setMo] = useState(today.getMonth())
  const [openBook, setOpenBook] = useState<number | null>(null)

  const inPeriod = (d: string) => mode === 'all' ? true : mode === 'year' ? d.startsWith(`${y}-`) : d.startsWith(`${y}-${String(mo + 1).padStart(2, '0')}-`)
  const label = mode === 'all' ? 'All time' : mode === 'year' ? String(y) : new Date(y, mo, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const step = (n: number) => {
    if (mode === 'year') { setY(y + n); return }
    const d = new Date(y, mo + n, 1); setY(d.getFullYear()); setMo(d.getMonth())
  }
  const atNow = mode === 'all' || (mode === 'year' ? y >= today.getFullYear() : y > today.getFullYear() || (y === today.getFullYear() && mo >= today.getMonth()))
  const first = logs?.[0]?.date
  const atStart = mode === 'all' || !first || (mode === 'year' ? `${y}` <= first.slice(0, 4) : `${y}-${String(mo + 1).padStart(2, '0')}` <= first.slice(0, 7))

  const sum = useMemo(() => tally((logs ?? []).filter(l => inPeriod(l.date))), [logs, mode, y, mo]) // eslint-disable-line react-hooks/exhaustive-deps
  const byMonth = useMemo(() => {
    if (mode !== 'year') return null
    const m = Array(12).fill(0) as number[]
    for (const l of logs ?? []) if (l.date.startsWith(`${y}-`)) m[Number(l.date.slice(5, 7)) - 1] += Object.values(l.t).reduce((a, b) => a + b, 0)
    return m
  }, [logs, mode, y])

  if (!logs) return <main className="page reading-page"><div className="loading-lines"><span /><span /><span /></div></main>
  const bks = books()
  const topBooks = [...sum.books].sort((a, b) => b[1].total - a[1].total)
  const maxBook = topBooks[0]?.[1].total ?? 0
  const maxCh = Math.max(0, ...[...sum.books.values()].flatMap(b => [...b.ch.values()]))
  const level = (s: number) => !s ? 0 : s >= maxCh * 0.6 ? 4 : s >= maxCh * 0.3 ? 3 : s >= maxCh * 0.1 ? 2 : 1

  const workTime = new Map<string, number>()
  for (const [k, s] of sum.other) if (k.startsWith('w:')) { const id = k.slice(2).split('/')[0]; workTime.set(id, (workTime.get(id) ?? 0) + s) }
  const works = (lib ?? []).flatMap(a => a.works.map(w => ({ a, w, s: workTime.get(w.id) ?? 0 }))).filter(x => x.s > 0).sort((a, b) => b.s - a.s)
  const sermonTime = [...sum.other].filter(([k]) => k.startsWith('s:')).sort((a, b) => b[1] - a[1])
  const psalmTime = [...sum.other].filter(([k]) => k.startsWith('p:')).sort((a, b) => b[1] - a[1])
  const sermonTitle = new Map((sermons ?? []).map(s => [s.id, s.title]))
  const otherTotal = [...sum.other.values()].reduce((a, b) => a + b, 0)
  const bibleRead = [...read.keys()].filter(k => k.startsWith('b:')).length

  return (
    <main className="page reading-page">
      <header className="page-head">
        <h1>Reading</h1>
        <p>Where your time has gone. Time counts only while you're scrolling or tapping on a page; it stops after a couple of quiet minutes.</p>
      </header>

      <div className="rd-period">
        <div className="seg small">
          {(['month', 'year', 'all'] as Mode[]).map(m => <button key={m} className={mode === m ? 'is-on' : ''} onClick={() => setMode(m)}>{m === 'all' ? 'All time' : m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
        <div className="rd-step">
          {mode !== 'all' && <button className="icon-btn" aria-label="Earlier" disabled={atStart} onClick={() => step(-1)}><IconLeft size={18} /></button>}
          <span>{label}</span>
          {mode !== 'all' && <button className="icon-btn" aria-label="Later" disabled={atNow} onClick={() => step(1)}><IconRight size={18} /></button>}
        </div>
      </div>

      {sum.bible + otherTotal === 0 ? (
        <p className="empty"><span>{logs.length ? `Nothing recorded for ${label}.` : 'Nothing recorded yet. Time starts counting from today as you read.'}</span></p>
      ) : (
        <p className="rd-total"><strong>{dur(sum.bible)}</strong> in Scripture{otherTotal ? <> · <strong>{dur(otherTotal)}</strong> in sermons and books</> : null}</p>
      )}

      {byMonth && byMonth.some(Boolean) && (
        <section className="rd-section">
          <h2>By month</h2>
          <div className="rd-months">
            {byMonth.map((s, i) => (
              <button key={i} className="rd-month" onClick={() => { setMo(i); setMode('month') }} title={`${MONTHS[i]}: ${dur(s)}`}>
                <span className="rd-month-bar"><span style={{ height: `${(s / Math.max(...byMonth)) * 100}%` }} /></span>
                <span className="rd-month-l">{MONTHS[i][0]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {topBooks.length > 0 && (
        <section className="rd-section">
          <h2>Where in Scripture</h2>
          <ol className="rd-bars">
            {topBooks.slice(0, openBook === -1 ? 66 : 8).map(([b, v]) => {
              const bk = bks[b - 1]
              return (
                <li key={b}>
                  <button className="rd-bar" aria-expanded={openBook === b} onClick={() => setOpenBook(openBook === b ? null : b)}>
                    <span className="rd-bar-name">{bk?.name}</span>
                    <span className="rd-bar-track"><span style={{ width: `${(v.total / maxBook) * 100}%` }} /></span>
                    <span className="rd-bar-time">{dur(v.total)}</span>
                  </button>
                  {openBook === b && bk && <ChapterTimes book={bk} times={v.ch} />}
                </li>
              )
            })}
          </ol>
          {topBooks.length > 8 && openBook !== -1 && <button className="text-btn" onClick={() => setOpenBook(-1)}>All {topBooks.length} books</button>}
        </section>
      )}

      {bks.length > 0 && (
        <section className="rd-section">
          <h2>The whole Bible</h2>
          <p className="rd-legend"><span><span className="rd-cell l2" /> darker means more time</span>{bibleRead ? <span><span className="rd-cell is-read" /> marked read ({bibleRead} of 1,189 chapters)</span> : null}</p>
          {(['OT', 'NT'] as const).map(t => (
            <div key={t} className="rd-map">
              {bks.filter(b => b.testament === t).map(b => {
                const ch = sum.books.get(b.id)?.ch
                return (
                  <div key={b.id} className="rd-map-row">
                    <a className="rd-map-name" href={`#/read/${b.id}/1?scope=book`}>{b.abbr}</a>
                    <span className="rd-map-cells">
                      {b.verses.map((_, i) => {
                        const s = ch?.get(i + 1) ?? 0
                        return <a key={i} href={`#/read/${b.id}/${i + 1}`} className={`rd-cell l${level(s)} ${read.has(`b:${b.id}.${i + 1}`) ? 'is-read' : ''}`}
                          title={`${b.name} ${i + 1}${s ? `: ${dur(s)}` : ''}`} aria-label={`${b.name} ${i + 1}`} />
                      })}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </section>
      )}

      {(works.length > 0 || sermonTime.length > 0 || psalmTime.length > 0) && (
        <section className="rd-section">
          <h2>Sermons and books</h2>
          <ol className="rd-list">
            {works.map(({ a, w, s }) => {
              const done = w.chapters.filter(c => read.has(`w:${w.id}/${c[0]}`)).length
              return (
                <li key={w.id}><a href={`#/spurgeon/work/${w.id}`}>
                  <span className="rd-list-title">{w.title}<span className="muted"> · {a.name}</span></span>
                  <span className="rd-list-meta">{dur(s)}{done ? ` · ${done} of ${w.chapters.length} chapters marked read` : ''}</span>
                </a></li>
              )
            })}
            {psalmTime.length > 0 && (
              <li><a href="#/spurgeon/spurgeon">
                <span className="rd-list-title">The Treasury of David<span className="muted"> · Spurgeon</span></span>
                <span className="rd-list-meta">{dur(psalmTime.reduce((t, x) => t + x[1], 0))} · Psalm {psalmTime.slice(0, 5).map(([k]) => k.slice(2)).join(', ')}{psalmTime.length > 5 ? '…' : ''}</span>
              </a></li>
            )}
            {sermonTime.slice(0, 12).map(([k, s]) => (
              <li key={k}><a href={`#/spurgeon/sermon/${encodeURIComponent(k.slice(2))}`}>
                <span className="rd-list-title">{sermonTitle.get(k.slice(2)) ?? 'Sermon'}<span className="muted"> · Spurgeon</span></span>
                <span className="rd-list-meta">{dur(s)}{read.has(k) ? ' · marked read' : ''}</span>
              </a></li>
            ))}
          </ol>
          {sermonTime.length > 12 && <p className="muted small-note">And {sermonTime.length - 12} more sermons.</p>}
        </section>
      )}
    </main>
  )
}

function ChapterTimes({ book, times }: { book: Book; times: Map<number, number> }) {
  const list = [...times].sort((a, b) => b[1] - a[1])
  return (
    <ol className="rd-chapters">
      {list.map(([c, s]) => <li key={c}><a href={`#/read/${book.id}/${c}`}><span>{book.name === 'Psalms' ? 'Psalm' : book.name} {c}</span><span className="muted">{dur(s)}</span></a></li>)}
    </ol>
  )
}

function tally(days: LogDay[]) {
  const books = new Map<number, { total: number; ch: Map<number, number> }>()
  const other = new Map<string, number>()
  let bible = 0
  for (const d of days) for (const [k, s] of Object.entries(d.t)) {
    if (k.startsWith('b:')) {
      const [b, c] = k.slice(2).split('.').map(Number)
      const e = books.get(b) ?? { total: 0, ch: new Map() }
      e.total += s; e.ch.set(c, (e.ch.get(c) ?? 0) + s); books.set(b, e); bible += s
    } else other.set(k, (other.get(k) ?? 0) + s)
  }
  return { books, other, bible }
}
