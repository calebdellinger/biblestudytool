import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadBooks, vid } from './lib/bible'
import { initStore, loadPlace, savePlace, startSync } from './lib/db'
import { go, useMedia, usePrefs, useRoute, type Route } from './lib/hooks'
import { TopBar } from './components/TopBar'
import { BookPicker } from './components/BookPicker'
import { Reader } from './components/Reader'
import { Panel, type Tool } from './components/Panel'
import { ActionBar } from './components/ActionBar'
import { SearchPage, SettingsPage } from './components/Pages'
import { Notebook, NoteSheet } from './components/Notes'
import { SelectionToolbar } from './components/Annotate'
import { MapPage } from './components/Context'
import { PersonPage } from './components/People'
import { MemoryPage, PracticePage } from './components/Memory'
import { TodayPage } from './components/Today'
import { PaperPage } from './components/Paper'
import { PsalmPage, SermonPage, SpurgeonHome, SpurgeonSearch } from './components/Spurgeon'
import { WorkPage } from './components/Theologians'
import { ReadingPage } from './components/Reading'
import { WordPage } from './components/WordStudy'
import { LessonPage, LessonsPage } from './components/Lessons'
import { UpdateBanner } from './components/UpdateBanner'
// The sermon notes editor is loaded only when you open one, so the rest of the app stays light.
const SermonNotesPage = lazy(() => import('./components/Sermon').then(m => ({ default: m.SermonNotesPage })))
import { MemRecordPage } from './components/MemRecord'

const DEFAULT: Route = { page: 'read', book: 43, chapter: 1, verse: null, scope: 'chapter' }

// The opening verse stays until it's tapped (see index.html); this tells it the app is ready behind it.
function hideSplash() {
  (window as unknown as { __appReady?: () => void }).__appReady?.()
}

export default function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    (async () => {
      await Promise.all([loadBooks(), initStore()])
      if (!location.hash) {
        const p = await loadPlace()
        if (p) {
          const b = Math.floor(p.verse / 1_000_000), c = Math.floor((p.verse % 1_000_000) / 1000), v = p.verse % 1000
          go({ page: 'read', book: b, chapter: c, verse: v > 1 ? v : null, scope: p.scope }, true)
        }
      }
      setReady(true)
      startSync()
      hideSplash()
      // A tapped notification asks an open window to go to its page.
      navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'open') location.href = e.data.url })
    })()
  }, [])
  if (!ready) return <div className="boot" aria-label="Loading" />
  return <Shell />
}

function Shell() {
  const route = useRoute(DEFAULT)
  const prefs = usePrefs()
  const wide = useMedia('(min-width: 1000px)')
  const [picker, setPicker] = useState(false)
  // Verses you've tapped (quietly marked), the tool open on them, and which one the tool is looking at.
  const [picked, setPicked] = useState<number[]>([])
  const [tool, setTool] = useState<Tool | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const selected = picked.length ? picked[picked.length - 1] : null
  const setSelected = (f: number | null | ((s: number | null) => number | null)) => setPicked(p => {
    const cur = p.length ? p[p.length - 1] : null
    const next = typeof f === 'function' ? f(cur) : f
    return next == null ? [] : next === cur && p.length ? p : [next]
  })
  const [focusWord, setFocusWord] = useState<number | null>(null)
  const [last, setLast] = useState({ book: 43, chapter: 1 })
  const lastScope = useRef<string | null>(null)

  // Theme
  useEffect(() => {
    const el = document.documentElement
    // Neon is a dark-only style: it always uses the dark colours, whatever the light/dark setting says.
    if (prefs.style === 'neon') el.setAttribute('data-theme', 'dark')
    else if (prefs.theme === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', prefs.theme)
    if (prefs.style === 'parchment' || prefs.style === 'modern' || prefs.style === 'neon') el.setAttribute('data-style', prefs.style); else el.removeAttribute('data-style')
    // Match the phone's status bar to the page colour.
    const paper = getComputedStyle(el).getPropertyValue('--paper').trim()
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', paper))
  }, [prefs.theme, prefs.style])

  const reading = route.page === 'read' ? route : null
  // New page or new scope starts at the top (chapter view scrolls to its own verse).
  const pageKey = route.page === 'read' ? `${route.scope}:${route.book}` : route.page === 'search' ? `s:${route.q}` : route.page === 'spurgeon' ? `sp:${route.view}:${route.id ?? route.q ?? route.author ?? ''}` : route.page === 'map' ? `map:${route.verse}` : route.page === 'person' ? `p:${route.n}` : route.page === 'word' ? `w:${route.strong}` : route.page === 'lesson' ? `l:${route.id}:${route.mode ?? ''}` : route.page === 'practice' ? `pr:${route.id ?? ''}` : route.page
  useEffect(() => { if (!(route.page === 'read' && route.scope === 'chapter')) window.scrollTo(0, 0) }, [pageKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!reading) return
    setLast({ book: reading.book, chapter: reading.chapter })
    // Switching to verse view clears the screen; the verse view itself follows the panel as you step verses.
    if (reading.scope === 'verse') { if (lastScope.current !== 'verse') setSelected(null) }
    else if (reading.verse && reading.scope !== 'book') setSelected(vid(reading.book, reading.chapter, reading.verse))
    else setSelected(s => (s && Math.floor(s / 1000) === reading.book * 1000 + reading.chapter ? s : null))
    lastScope.current = reading.scope
    savePlace({ verse: vid(reading.book, reading.chapter, reading.verse ?? 1), scope: reading.scope, translation: prefs.translation })
  }, [reading?.book, reading?.chapter, reading?.verse, reading?.scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const remember = useCallback((ids: number[]) => {
    if (route.page === 'read' && route.scope === 'chapter') {
      const v = ids.length ? Math.min(...ids) % 1000 : null
      history.replaceState(history.state, '', `#/read/${route.book}/${route.chapter}${v ? `/${v}` : ''}`)
    }
  }, [route])
  const onSelect = useCallback((id: number | null) => {
    setPicked(id ? [id] : []); setFocus(id); setFocusWord(null); remember(id ? [id] : [])
  }, [remember])
  const onToggle = useCallback((id: number) => {
    setFocusWord(null)
    setPicked(p => {
      const next = p.includes(id) ? p.filter(x => x !== id) : [...p, id].sort((a, b) => a - b)
      remember(next)
      if (!next.length) setTool(null)
      setFocus(f => (next.includes(id) ? id : f && next.includes(f) ? f : next[0] ?? null))
      return next
    })
  }, [remember])
  const clearPicks = useCallback(() => { setPicked([]); setTool(null); setFocusWord(null); remember([]) }, [remember])
  const closePanel = useCallback(() => { setTool(null); setFocusWord(null) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !tool && picked.length && !document.querySelector('.note-sheet, .sel-toolbar, dialog[open]')) clearPicks()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [tool, picked.length, clearPicks])

  const showBar = !!(reading && reading.scope !== 'book' && picked.length)
  const showPanel = showBar && !!tool
  const focusVerse = focus && picked.includes(focus) ? focus : picked[0]
  const current = reading ? { book: reading.book, chapter: reading.chapter } : last
  const mainCls = useMemo(() => `layout ${showPanel && wide ? 'with-panel' : ''} ${showBar ? 'has-bar' : ''}`, [showPanel, wide, showBar])

  if (route.page === 'paper') return <PaperPage date={route.date} edition={route.edition} />
  if (route.page === 'lesson' && route.mode === 'present') return <LessonPage id={route.id} mode="present" at={route.at} />
  return (
    <>
      <TopBar route={route} current={current} onPickPassage={() => setPicker(true)} />
      <div className={mainCls}>
        <div className="layout-main">
          {route.page === 'read' && (
            <Reader book={route.book} chapter={route.chapter} verse={route.verse} scope={route.scope}
              prefs={prefs} selected={selected} onSelect={onSelect} picked={picked} onToggle={onToggle}
              onWord={(v, i) => { setPicked(p => (p.includes(v) ? p : [...p, v].sort((a, b) => a - b))); setFocus(v); setTool('words'); setFocusWord(i) }} />
          )}
          {route.page === 'notes' && <Notebook />}
          {route.page === 'sermon' && <Suspense fallback={<main className="page"><p className="muted">Opening…</p></main>}><SermonNotesPage id={route.id} /></Suspense>}
          {route.page === 'settings' && <SettingsPage />}
          {route.page === 'search' && <SearchPage q={route.q} />}
          {route.page === 'map' && <MapPage verse={route.verse} />}
          {route.page === 'person' && <PersonPage n={route.n} />}
          {route.page === 'word' && <WordPage strong={route.strong} from={route.from} />}
          {route.page === 'lessons' && <LessonsPage />}
          {route.page === 'lesson' && route.mode !== 'present' && <LessonPage id={route.id} mode={route.mode} />}
          {route.page === 'today' && <TodayPage />}
          {route.page === 'memory' && <MemoryPage />}
          {route.page === 'practice' && <PracticePage id={route.id} />}
          {route.page === 'memrecord' && <MemRecordPage />}
          {route.page === 'spurgeon' && route.view === 'home' && <SpurgeonHome author={route.author} />}
          {route.page === 'reading' && <ReadingPage />}
          {route.page === 'spurgeon' && route.view === 'work' && <WorkPage id={route.id!} />}
          {route.page === 'spurgeon' && route.view === 'sermon' && <SermonPage id={route.id!} />}
          {route.page === 'spurgeon' && route.view === 'psalm' && <PsalmPage n={Number(route.id)} />}
          {route.page === 'spurgeon' && route.view === 'search' && <SpurgeonSearch q={route.q ?? ''} />}
        </div>
        {showPanel && (
          <>
            {!wide && <div className="sheet-backdrop" onClick={closePanel} />}
            <Panel verses={picked} focus={focusVerse} onFocus={v => { setFocus(v); setFocusWord(null) }} tool={tool!} prefs={prefs}
              onClose={closePanel} asSheet={!wide} focusWord={focusWord} />
          </>
        )}
        {showBar && <ActionBar verses={picked} tool={tool} onTool={t => { setTool(tool === t ? null : t); setFocusWord(null) }} onClear={clearPicks} />}
      </div>
      <SelectionToolbar />
      <UpdateBanner />
      <NoteSheet />
      <BookPicker open={picker} current={current.book} onClose={() => { setPicker(false); setTimeout(() => (document.activeElement as HTMLElement | null)?.blur()) }}
        onPick={(b, c) => { setPicker(false); setTimeout(() => (document.activeElement as HTMLElement | null)?.blur()); go({ page: 'read', book: b, chapter: c, verse: null, scope: 'chapter' }) }} />
    </>
  )
}
