import { useEffect, useState } from 'react'
import { splitVid } from '../lib/bible'
import { commentaryFor } from '../lib/commentary'
import { renderSpurgeon } from '../lib/spurgeon'
import { useAsync } from '../lib/hooks'
import { AnnotatedHtml } from './Annotate'

const range = (s: number, e: number) => (s === e ? `Verse ${s}` : `Verses ${s}–${e}`)

/** Matthew Henry (devotional) then Barnes (verse notes, New Testament), for one verse. */
export function CommentaryTab({ verse }: { verse: number }) {
  const data = useAsync(() => commentaryFor(verse), [verse])
  const [full, setFull] = useState(false)
  const [outline, setOutline] = useState(false)
  useEffect(() => { setFull(false); setOutline(false) }, [verse])
  const { b, c } = splitVid(verse)
  if (!data) return <p className="muted">Loading…</p>
  const nothing = !data.concise.length && !data.complete.length && !data.barnes

  return (
    <div className="spurgeon-tab commentary-tab">
      {(data.concise.length > 0 || data.complete.length > 0) && (
        <section className="sp-block">
          <div className="cm-head">
            <h3 className="sp-h">Matthew Henry</h3>
            {data.concise[0] && <span className="cm-range">{range(data.concise[0].s, data.concise[0].e)}</span>}
          </div>
          {data.concise.map(x => (
            <AnnotatedHtml key={x.i} className="sp-prose" html={renderSpurgeon(x.md)} doc={`henry-c:${b}:${c}:${x.i}`}
              label={`Matthew Henry (concise), ${range(x.s, x.e).toLowerCase()}`} href={`#/read/${b}/${c}/${x.s}`} suggest={verse} />
          ))}
          {data.complete.length > 0 && (
            <button className="text-btn" onClick={() => setFull(!full)} aria-expanded={full}>
              {full ? 'Hide the full commentary' : `Read Henry's full commentary on ${range(data.complete[0].s, data.complete[data.complete.length - 1].e).toLowerCase()}`}
            </button>
          )}
          {full && data.complete.map(x => (
            <div key={x.i} className="cm-full">
              <p className="cm-title">{x.title}</p>
              <AnnotatedHtml className="sp-prose" html={renderSpurgeon(x.md)} doc={`henry:${b}:${c}:${x.i}`}
                label={`Matthew Henry, ${x.title}`} href={`#/read/${b}/${c}/${x.s}`} suggest={verse} />
            </div>
          ))}
          {data.outline && (
            <>
              <button className="text-btn" onClick={() => setOutline(!outline)} aria-expanded={outline}>{outline ? 'Hide' : 'Show'} the chapter outline</button>
              {outline && <div className="sp-prose small cm-outline" dangerouslySetInnerHTML={{ __html: renderSpurgeon(data.outline) }} />}
            </>
          )}
        </section>
      )}

      {data.barnes && (
        <section className="sp-block">
          <div className="cm-head"><h3 className="sp-h">Barnes' Notes</h3></div>
          <AnnotatedHtml className="sp-prose" html={renderSpurgeon(data.barnes)} doc={`barnes:${verse}`}
            label={`Barnes' Notes`} href={`#/read/${b}/${c}/${verse % 1000}`} suggest={verse} />
        </section>
      )}

      {b < 40 && !nothing && <p className="muted small-note">Barnes' Notes here cover the New Testament.</p>}
      {nothing && <p className="empty"><span>No commentary on this verse.</span></p>}
      <p className="wd-credit">Matthew Henry, Commentary on the Whole Bible (1706). Albert Barnes, Notes on the New Testament (1834–1885). Public domain.</p>
    </div>
  )
}
