// Your memory record: how much of the Bible you've memorized, book by book, and how it grew over time.
// A verse counts as memorized once it reaches "Got it" (or Kept). Verses you're still learning show as a lighter bar.
import { useMemo, useState } from 'react'
import { books, formatRef, loadBooks, type Book } from '../lib/bible'
import { useAsync, useStore } from '../lib/hooks'
import { BOX_LABEL, mems, verseIds } from '../lib/memory'
import type { Mem } from '../lib/db'
import { IconLeft } from './Icons'

type Scope = 'all' | 'OT' | 'NT'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const known = (m: Mem) => m.box === 'got' || m.box === 'kept'
/** The day a verse first reached Got it, from its practice history. */
const firstGot = (m: Mem) => m.learned ?? m.reviews.find(r => r.g === 'got')?.d ?? (known(m) ? m.updatedAt.slice(0, 10) : null)
const lastReview = (m: Mem) => m.reviews[m.reviews.length - 1]
const slipping = (m: Mem) => !known(m) && m.reviews.some(r => r.g === 'got')

function pct(n: number, of: number) {
  if (!of || !n) return '0%'
  const p = (n / of) * 100
  return p >= 99.95 ? '100%' : p >= 10 ? `${Math.round(p)}%` : p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`
}
const nice = (d: string) => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function MemRecordPage() {
  const store = useStore()
  const bks = useAsync(() => loadBooks(), []) ?? books()
  const [scope, setScope] = useState<Scope>('all')
  const [sort, setSort] = useState<'bible' | 'most'>('bible')
  const [open, setOpen] = useState<number | null>(null)

  const all = useMemo(() => mems(), [store.mems]) // eslint-disable-line react-hooks/exhaustive-deps
  // verse id -> memorized (true) or still learning (false); a verse memorized anywhere counts as memorized
  const verses = useMemo(() => {
    const v = new Map<number, boolean>()
    for (const m of all) for (const id of verseIds(m.s, m.e)) v.set(id, (v.get(id) ?? false) || known(m))
    return v
  }, [all])

  const inScope = (b: Book) => scope === 'all' || b.testament === scope
  const perBook = useMemo(() => {
    const t = new Map<number, { got: number; learning: number; byCh: Map<number, number> }>()
    for (const [id, k] of verses) {
      const b = Math.floor(id / 1_000_000), c = Math.floor((id % 1_000_000) / 1000)
      const e = t.get(b) ?? { got: 0, learning: 0, byCh: new Map() }
      if (k) { e.got++; e.byCh.set(c, (e.byCh.get(c) ?? 0) + 1) } else e.learning++
      t.set(b, e)
    }
    return t
  }, [verses])

  const shown = bks.filter(inScope)
  const totalVerses = shown.reduce((a, b) => a + b.verses.reduce((x, y) => x + y, 0), 0)
  const got = shown.reduce((a, b) => a + (perBook.get(b.id)?.got ?? 0), 0)
  const learning = shown.reduce((a, b) => a + (perBook.get(b.id)?.learning ?? 0), 0)
  const booksDone = shown.filter(b => (perBook.get(b.id)?.got ?? 0) === b.verses.reduce((x, y) => x + y, 0)).length
  const booksTouched = shown.filter(b => (perBook.get(b.id)?.got ?? 0) > 0).length
  const size = (b: Book) => b.verses.reduce((x, y) => x + y, 0)
  const ordered = sort === 'bible' ? shown : [...shown].sort((a, b) => (perBook.get(b.id)?.got ?? 0) / size(b) - (perBook.get(a.id)?.got ?? 0) / size(a) || a.id - b.id)

  // Growth: memorized verses (in this scope) by the month they were first learned, as a running total over the last 12 months.
  const growth = useMemo(() => {
    const firsts = new Map<number, string>()
    for (const m of all) {
      const d = firstGot(m)
      if (!d || !known(m)) continue
      for (const id of verseIds(m.s, m.e)) { const prev = firsts.get(id); if (!prev || d < prev) firsts.set(id, d) }
    }
    const now = new Date(), months: { key: string; label: string }[] = []
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()] }) }
    const bookT = new Map(bks.map(b => [b.id, b.testament]))
    const ok = (id: number) => scope === 'all' || bookT.get(Math.floor(id / 1_000_000)) === scope
    const dates = [...firsts].filter(([id]) => ok(id)).map(([, d]) => d.slice(0, 7))
    return months.map(m => ({ ...m, total: dates.filter(d => d <= m.key).length, added: dates.filter(d => d === m.key).length }))
  }, [all, scope, bks])
  const maxGrowth = Math.max(1, ...growth.map(g => g.total))

  const testament = new Map(bks.map(b => [b.id, b.testament]))
  const mine = (m: Mem) => scope === 'all' || testament.get(Math.floor(m.s / 1_000_000)) === scope
  const memorized = all.filter(m => known(m) && mine(m)).sort((a, b) => (firstGot(b) ?? '').localeCompare(firstGot(a) ?? ''))
  const slip = all.filter(m => slipping(m) && mine(m))

  return (
    <main className="page memrec">
      <a className="back-link" href="#/memory"><IconLeft size={16} />Memory</a>
      <header className="page-head">
        <h1>What you've memorized</h1>
        <p>Every verse you've reached “Got it” on, across the whole Bible.</p>
      </header>

      <div className="seg memrec-scope" role="tablist" aria-label="Which part of the Bible">
        {([['all', 'Whole Bible'], ['OT', 'Old Testament'], ['NT', 'New Testament']] as [Scope, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'is-on' : ''} onClick={() => setScope(k)}>{l}</button>
        ))}
      </div>

      <section className="memrec-hero">
        <div className="memrec-big">
          <span className="memrec-pct">{pct(got, totalVerses)}</span>
          <span className="memrec-of">of the {scope === 'all' ? 'Bible' : scope === 'OT' ? 'Old Testament' : 'New Testament'}</span>
        </div>
        <div className="memrec-track" aria-hidden="true">
          <span className="is-got" style={{ width: `${Math.max(got ? 0.6 : 0, (got / totalVerses) * 100)}%` }} />
          <span className="is-learning" style={{ width: `${(learning / totalVerses) * 100}%` }} />
        </div>
        <p className="memrec-facts">
          <span><strong>{got.toLocaleString()}</strong> of {totalVerses.toLocaleString()} verses</span>
          {learning > 0 && <span><strong>{learning}</strong> still learning</span>}
          <span><strong>{booksTouched}</strong> of {shown.length} books started</span>
          {booksDone > 0 && <span><strong>{booksDone}</strong> {booksDone === 1 ? 'book' : 'books'} complete</span>}
        </p>
      </section>

      <section className="rd-section">
        <div className="memrec-sec-head">
          <h2>Book by book</h2>
          <div className="seg small">
            <button className={sort === 'bible' ? 'is-on' : ''} onClick={() => setSort('bible')}>Bible order</button>
            <button className={sort === 'most' ? 'is-on' : ''} onClick={() => setSort('most')}>Most memorized</button>
          </div>
        </div>
        <p className="rd-legend"><span><span className="memrec-key is-got" /> memorized</span><span><span className="memrec-key is-learning" /> learning</span><span>bars show how much of each book</span></p>
        <ol className="rd-bars memrec-bars">
          {ordered.map(b => {
            const e = perBook.get(b.id), n = size(b), g = e?.got ?? 0, l = e?.learning ?? 0
            return (
              <li key={b.id} className={g ? '' : 'is-zero'}>
                <button className="rd-bar" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)} disabled={!g && !l}>
                  <span className="rd-bar-name">{b.name}</span>
                  <span className="memrec-bar-track">
                    <span className="is-got" style={{ width: `${g ? Math.max(1.2, (g / n) * 100) : 0}%` }} />
                    <span className="is-learning" style={{ width: `${(l / n) * 100}%` }} />
                  </span>
                  <span className="rd-bar-time" title={`${g} of ${n} verses`}>{pct(g, n)}</span>
                </button>
                {open === b.id && e && (
                  <ul className="rd-chapters">
                    {b.verses.map((vc, i) => {
                      const c = e.byCh.get(i + 1) ?? 0
                      if (!c) return null
                      return <li key={i}><a href={`#/read/${b.id}/${i + 1}`}><span>{b.osis === 'Ps' ? 'Psalm' : 'Chapter'} {i + 1}</span><span className="muted">{c} of {vc} · {pct(c, vc)}</span></a></li>
                    })}
                    {l > 0 && <li className="muted small">{l} more {l === 1 ? 'verse' : 'verses'} still being learned</li>}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      </section>

      <section className="rd-section">
        <h2>Over the last year</h2>
        <p className="rd-legend"><span>Verses memorized in total at the end of each month</span></p>
        <div className="rd-months">
          {growth.map(g => (
            <div key={g.key} className="rd-month" title={`${g.label}: ${g.total} memorized${g.added ? `, ${g.added} new` : ''}`}>
              <span className="rd-month-bar"><span style={{ height: `${(g.total / maxGrowth) * 100}%` }} /></span>
              <span className="rd-month-l">{g.label[0]}</span>
            </div>
          ))}
        </div>
        <p className="hint small">{growth[11].added ? `${growth[11].added} new this month.` : 'Nothing new yet this month.'}</p>
      </section>

      {slip.length > 0 && (
        <section className="rd-section">
          <h2>Slipping</h2>
          <p className="hint small">You knew these once, but your last practice wasn't “Got it”. They'll keep coming up until they're solid again.</p>
          <ul className="memrec-list">{slip.map(m => <Row key={m._id} m={m} />)}</ul>
        </section>
      )}

      <section className="rd-section">
        <h2>Your verses <span className="tab-count">{memorized.length}</span></h2>
        {memorized.length === 0
          ? <p className="empty"><span>Nothing memorized yet. Verses show up here once you mark them “Got it”.</span></p>
          : <ul className="memrec-list">{memorized.map(m => <Row key={m._id} m={m} />)}</ul>}
      </section>
    </main>
  )
}

function Row({ m }: { m: Mem }) {
  const first = firstGot(m), last = lastReview(m)
  return (
    <li>
      <a className="memrec-row" href={`#/memory/practice/${encodeURIComponent(m._id)}`}>
        <span className="memrec-ref">{formatRef(m.s, m.e)}{m.passage ? <span className="muted small"> · part of a passage</span> : null}</span>
        <span className="memrec-meta">
          {first && <span>Memorized {nice(first)}</span>}
          {last && <span>Last practised {nice(last.d)} · {last.g === 'got' ? 'Got it' : last.g === 'almost' ? 'Almost' : 'Not yet'}</span>}
        </span>
        <span className={`memrec-box box-${m.box}`}>{BOX_LABEL[m.box]}</span>
      </a>
    </li>
  )
}
