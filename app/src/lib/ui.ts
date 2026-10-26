// App-wide UI state that several screens open: the note sheet and the "add to a note" picker.
import { useSyncExternalStore } from 'react'
import { getState } from './db'

export type SheetState =
  | { mode: 'closed' }
  | { mode: 'note'; noteId: string | null; anchors: string[]; typed?: { s: number; e: number }[] }
  | { mode: 'pick'; markId: string }

let sheet: SheetState = { mode: 'closed' }
const subs = new Set<() => void>()
export function setSheet(s: SheetState) { sheet = s; subs.forEach(f => f()) }
export const useSheet = () => useSyncExternalStore(fn => (subs.add(fn), () => { subs.delete(fn) }), () => sheet)

/** Open a note: an existing one, or a new one attached to these highlights. */
export const openNote = (noteId: string | null, anchors: string[] = [], typed?: { s: number; e: number }[]) => {
  // Sermon notes have their own full-page editor instead of the note sheet.
  if (noteId && getState().notes.find(n => n._id === noteId)?.kind === 'sermon') { setSheet({ mode: 'closed' }); location.hash = `#/sermon/${encodeURIComponent(noteId)}`; return }
  setSheet({ mode: 'note', noteId, anchors, typed })
}
export const pickNoteFor = (markId: string) => setSheet({ mode: 'pick', markId })
export const closeSheet = () => setSheet({ mode: 'closed' })

// A highlight to scroll to once its page has rendered (e.g. after following a link from a verse).
let pendingMark: string | null = null
export const scrollToMarkLater = (id: string) => { pendingMark = id }
export const takePendingMark = () => { const m = pendingMark; pendingMark = null; return m }
