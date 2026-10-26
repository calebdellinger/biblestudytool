import { useEffect, useMemo, useRef, useState } from 'react'
import { books, type Book } from '../lib/bible'
import { IconClose, IconLeft } from './Icons'
import { SECTIONS } from '../lib/intro'

type Props = { open: boolean; current: number; onClose: () => void; onPick: (book: number, chapter: number) => void }

export function BookPicker({ open, current, onClose, onPick }: Props) {
  const [book, setBook] = useState<Book | null>(null)
  const [filter, setFilter] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const filterInput = useRef<HTMLInputElement>(null)
  const inner = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const d = dialog.current!
    if (open && !d.open) {
      const coarse = matchMedia('(pointer: coarse)').matches
      // The dialog focuses whatever carries "autofocus" as it opens; on a phone that's the list, not the search box.
      if (coarse) inner.current?.setAttribute('autofocus', ''); else inner.current?.removeAttribute('autofocus')
      d.showModal(); setBook(null); setFilter('')
      // On a phone, don't jump into the search box: that pops up the keyboard over the book list.
      // The dialog itself takes focus instead; tap the box if you want to type.
      if (coarse) inner.current?.focus({ preventScroll: true })
      else setTimeout(() => filterInput.current?.focus(), 30)
    }
    if (!open && d.open) d.close()
  }, [open])

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase().replace(/\s+/g, '')
    return books().filter(b => !f || b.name.toLowerCase().replace(/\s+/g, '').startsWith(f) || b.abbr.toLowerCase().replace(/\s+/g, '').startsWith(f))
  }, [filter])

  function chooseBook(b: Book) {
    if (b.verses.length === 1) return onPick(b.id, 1)
    setBook(b)
  }

  return (
    <dialog ref={dialog} className="picker" onClose={onClose} onClick={e => e.target === dialog.current && onClose()}>
      <div className="picker-inner" ref={inner} tabIndex={-1}>
        <div className="picker-head">
          {book ? (
            <button className="icon-btn" onClick={() => setBook(null)} aria-label="Back to books"><IconLeft /></button>
          ) : null}
          {book ? <h2 className="picker-title">{book.name}</h2> : (
            <input ref={filterInput} className="picker-filter" placeholder="Find a book" value={filter}
              onChange={e => setFilter(e.target.value)} aria-label="Find a book"
              onKeyDown={e => { if (e.key === 'Enter' && list[0]) chooseBook(list[0]) }} />
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        {book ? (
          <div className="chapter-grid">
            {book.verses.map((_, i) => (
              <button key={i} className="chapter-cell" onClick={() => onPick(book.id, i + 1)}>{i + 1}</button>
            ))}
          </div>
        ) : (
          <div className="book-columns">
            {(['OT', 'NT'] as const).map(t => {
              const secs = SECTIONS.filter(x => x.t === t).map(x => ({ ...x, list: list.filter(b => x.first <= b.id && b.id <= x.last) })).filter(x => x.list.length)
              if (!secs.length) return null
              return (
                <section key={t} className="book-group">
                  <h3>{t === 'OT' ? 'Old Testament' : 'New Testament'}</h3>
                  {secs.map(x => (
                    <div key={x.id} className="book-sec">
                      <h4>{x.name}</h4>
                      <ul>
                        {x.list.map(b => (
                          <li key={b.id}>
                            <button className={`book-item ${b.id === current ? 'is-current' : ''}`} onClick={() => chooseBook(b)}>
                              {b.name}<span className="book-chapters">{b.verses.length}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </dialog>
  )
}
