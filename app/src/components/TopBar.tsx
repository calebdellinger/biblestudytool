import { useEffect, useRef, useState } from 'react'
import { bookById, chapterName } from '../lib/bible'
import { parseQuery } from '../lib/refs'
import { go, useCanGoBack, useStore, useSync, type Route } from '../lib/hooks'
import { dueMems } from '../lib/memory'
import { splitVid } from '../lib/bible'
import { IconDown, IconLeft, IconNotes, IconToday, IconQuill, IconSearch, IconSettings, IconLessons } from './Icons'

type Props = { route: Route; onPickPassage: () => void; current: { book: number; chapter: number } }

export function TopBar({ route, onPickPassage, current }: Props) {
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sync = useSync()
  const store = useStore()
  const canBack = useCanGoBack()
  const due = store.mems.length ? dueMems().length : 0
  const book = bookById(current.book)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(t.tagName)) {
        e.preventDefault(); setSearchOpen(true); setTimeout(() => input.current?.focus())
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = q.trim()
    if (!text) return
    const ref = parseQuery(text)
    if (ref) {
      const s = splitVid(ref.s)
      const single = ref.s === ref.e
      go({ page: 'read', book: s.b, chapter: s.c, verse: single || s.v > 1 ? s.v : null, scope: 'chapter' })
    } else {
      go({ page: 'search', q: text })
    }
    setQ(''); input.current?.blur(); setSearchOpen(false)
  }

  const syncLabel = {
    off: 'Sync is off', connecting: 'Connecting to your PC…', synced: 'Synced with your PC',
    syncing: 'Syncing…', offline: 'Your PC is out of reach — changes are saved on this device',
    error: sync.error || 'Sync error',
  }[sync.status]

  return (
    <header className="topbar">
      {/* Back one page. On the first page of a visit there is nowhere to go back to, except from a side page to your reading. */}
      <button className="icon-btn back-btn" aria-label="Back" title="Back"
        disabled={!canBack && route.page === 'read'}
        onClick={() => (canBack ? history.back() : go({ page: 'read', book: current.book, chapter: current.chapter, verse: null, scope: 'chapter' }))}>
        <IconLeft />
      </button>

      <button className="passage-btn" onClick={onPickPassage} aria-label="Choose a book and chapter">
        <span>{book ? `${chapterName(book.id)} ${current.chapter}` : '…'}</span>
        <IconDown size={16} />
      </button>

      <form className={`search ${searchOpen ? 'is-open' : ''}`} onSubmit={submit} role="search">
        <IconSearch size={17} />
        <input
          ref={input} value={q} onChange={e => setQ(e.target.value)}
          onBlur={() => !q && setSearchOpen(false)}
          placeholder="Go to Jn 3:16 or search words" aria-label="Go to a passage or search"
          enterKeyHint="go" autoComplete="off" spellCheck={false}
        />
        <kbd className="search-kbd" aria-hidden="true">/</kbd>
      </form>

      <nav className="topbar-actions">
        <button className="icon-btn search-toggle" aria-label="Search"
          onClick={() => { setSearchOpen(true); setTimeout(() => input.current?.focus()) }}>
          <IconSearch />
        </button>
        <a className={`icon-btn ${route.page === 'spurgeon' ? 'is-active' : ''}`} href="#/spurgeon" aria-label="Theologians" title="Theologians">
          <IconQuill />
        </a>
        <a className={`icon-btn ${route.page === 'lessons' || route.page === 'lesson' ? 'is-active' : ''}`} href="#/lessons" aria-label="Lessons" title="Lessons">
          <IconLessons />
        </a>
        <a className={`icon-btn ${['today', 'memory', 'practice'].includes(route.page) ? 'is-active' : ''}`} href="#/today"
          aria-label={due ? `Today, ${due} to practise` : 'Today'} title={due ? `Today · ${due} to practise` : 'Today'}>
          <IconToday />
          {due > 0 && <span className="due-dot" aria-hidden="true" />}
        </a>
        <a className={`icon-btn ${route.page === 'notes' ? 'is-active' : ''}`} href="#/notes" aria-label="Notebook" title="Notebook">
          <IconNotes />
        </a>
        <a className={`icon-btn ${route.page === 'settings' ? 'is-active' : ''}`} href="#/settings" aria-label="Settings" title="Settings">
          <IconSettings />
          <span className={`sync-dot sync-${sync.status}`} title={syncLabel} aria-label={syncLabel} />
        </a>
      </nav>
    </header>
  )
}
