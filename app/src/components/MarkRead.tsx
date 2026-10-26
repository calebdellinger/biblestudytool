// A quiet "Mark as read" at the end of something you've read. Only you decide what counts as read.
import { markRead, unmarkRead, useReadMarks, dayKey } from '../lib/reading'
import { IconCheck } from './Icons'

const fmt = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(y, m - 1, day)
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}

export function MarkRead({ k, what }: { k: string; what: string }) {
  const marks = useReadMarks()
  const m = marks.get(k)
  if (!m) return (
    <div className="mark-read"><button className="text-btn" onClick={() => markRead(k)}>Mark {what} as read</button></div>
  )
  const last = m.dates[m.dates.length - 1]
  return (
    <div className="mark-read is-read">
      <span><IconCheck size={15} /> Read {fmt(last)}{m.dates.length > 1 ? ` · ${m.dates.length} times` : ''}</span>
      {last === dayKey()
        ? <button className="text-btn" onClick={() => unmarkRead(k)}>Undo</button>
        : <button className="text-btn" onClick={() => markRead(k)}>Read again</button>}
    </div>
  )
}
