// "From your notes" on Today: one older note brought back each day, preferring notes on today's reading,
// then notes on what you're memorizing, then anything written a while ago. No counts, nothing to keep up.
import { useMemo, useState } from 'react'
import { formatRef } from '../lib/bible'
import { categoryPath, type Note } from '../lib/db'
import type { PlanReading } from '../lib/daily'
import { useStore } from '../lib/hooks'
import { openNote } from '../lib/ui'
import { ScanThumb } from './Scan'
import { InkThumb } from './Ink'

const MIN_AGE_DAYS = 14

function hash(s: string) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0 }
const touches = (n: Note, s: number, e: number) => n.refs.some(r => r.s <= e && r.e >= s)
function ago(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 45) return `${Math.round(days / 7)} weeks ago`
  if (days < 548) return `${Math.round(days / 30.4)} months ago`
  return `${Math.round(days / 365)} years ago`
}

export function FromYourNotes({ day, todays }: { day: Date; todays: PlanReading[] }) {
  const store = useStore()
  const [skip, setSkip] = useState(0)
  const key = day.toDateString()

  const picks = useMemo(() => {
    const cutoff = new Date(day.getTime() - MIN_AGE_DAYS * 86_400_000).toISOString()
    const old = store.notes.filter(n => n.createdAt < cutoff && (n.body.trim() || n.kind === 'handwritten' || n.kind === 'ink'))
    if (!old.length) return []
    const reading = todays.flatMap(r => r.ranges)
    const memo = [...store.mems.filter(m => !m.deleted && !m.passage).map(m => [m.s, m.e] as [number, number]),
      ...store.passages.filter(p => !p.deleted).map(p => [p.s, p.e] as [number, number])]
    const order = (list: Note[]) => [...list].sort((a, b) => hash(key + a._id) - hash(key + b._id))
    const onReading = order(old.filter(n => reading.some(([s, e]) => touches(n, s, e))))
    const onMemory = order(old.filter(n => !onReading.includes(n) && memo.some(([s, e]) => touches(n, s, e))))
    const rest = order(old.filter(n => !onReading.includes(n) && !onMemory.includes(n)))
    return [
      ...onReading.map(n => ({ n, why: `On today's reading, ${todays.find(r => r.ranges.some(([s, e]) => touches(n, s, e)))?.label ?? ''}` })),
      ...onMemory.map(n => ({ n, why: 'On a passage you are memorizing' })),
      ...rest.map(n => ({ n, why: `Written ${ago(n.createdAt)}` })),
    ]
  }, [store.notes, store.mems, store.passages, todays, key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!picks.length) return null
  const { n, why } = picks[skip % picks.length]
  const where = n.title || (n.refs[0] ? formatRef(n.refs[0].s, n.refs[0].e) : '')
  return (
    <section className="today-notes">
      <div className="today-sec-head">
        <h2>From your notes</h2>
        <span className="muted">{why}</span>
      </div>
      <button className="today-note" onClick={() => openNote(n._id)}>
        <span className="today-note-where">{where}{n.category ? <span className="muted"> · {categoryPath(n.category)}</span> : null}</span>
        {n.kind === 'ink' ? <InkThumb note={n} /> : n.kind === 'handwritten' ? <ScanThumb note={n} /> : <span className="today-note-body">{n.body.length > 320 ? `${n.body.slice(0, 320)}…` : n.body}</span>}
        <span className="today-note-date">{new Date(n.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
      </button>
      {picks.length > 1 && <button className="text-btn small" onClick={() => setSkip(skip + 1)}>Another</button>}
    </section>
  )
}
