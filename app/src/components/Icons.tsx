// Small line icons drawn for this app (1.6px strokes, 20px grid).
type P = { size?: number }
const S = ({ size = 20, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
export const IconSearch = (p: P) => <S {...p}><circle cx="9" cy="9" r="5.5" /><path d="M13 13l4 4" /></S>
export const IconNotes = (p: P) => <S {...p}><path d="M5 3h7l3 3v11H5z" /><path d="M8 9h5M8 12h5M8 15h3" /></S>
export const IconSettings = (p: P) => <S {...p}><path d="M4 6h8M15 6h1M4 14h1M8 14h8" /><circle cx="13.5" cy="6" r="1.8" /><circle cx="6.5" cy="14" r="1.8" /></S>
export const IconClose = (p: P) => <S {...p}><path d="M5 5l10 10M15 5L5 15" /></S>
export const IconLeft = (p: P) => <S {...p}><path d="M12 4l-6 6 6 6" /></S>
export const IconRight = (p: P) => <S {...p}><path d="M8 4l6 6-6 6" /></S>
export const IconDown = (p: P) => <S {...p}><path d="M5 8l5 5 5-5" /></S>
export const IconPlus = (p: P) => <S {...p}><path d="M10 4v12M4 10h12" /></S>
export const IconBook = (p: P) => <S {...p}><path d="M4 4.5C6 3.5 8 3.5 10 5c2-1.5 4-1.5 6-.5V16c-2-1-4-1-6 .5-2-1.5-4-1.5-6-.5z" /><path d="M10 5v11.5" /></S>
export const IconTrash = (p: P) => <S {...p}><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" /></S>
export const IconCheck = (p: P) => <S {...p}><path d="M4 10.5l4 4 8-9" /></S>
export const IconMemory = (p: P) => <S {...p}><rect x="3.5" y="6" width="10" height="11" rx="1.6" /><path d="M6.5 3.5h8.4a1.6 1.6 0 0 1 1.6 1.6V14" /><path d="M6.5 10h4M6.5 13h2.5" /></S>
export const IconToday = (p: P) => <S {...p}><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3" /></S>
export const IconPin = (p: P) => <S {...p}><path d="M10 17.5s5.2-4.7 5.2-8.8a5.2 5.2 0 0 0-10.4 0c0 4.1 5.2 8.8 5.2 8.8z" /><circle cx="10" cy="8.7" r="1.9" /></S>
export const IconWords = (p: P) => <S {...p}><path d="M2.8 15.5l3.6-10 3.6 10M4.1 12h4.6" /><path d="M12.4 10c.5-.7 1.3-1.1 2.3-1.1 1.4 0 2.3.8 2.3 2.2v4.4M17 12.4c-3 0-4.6.6-4.6 1.8 0 .8.6 1.3 1.6 1.3 1.8 0 3-1.2 3-3.1" /></S>
/** A lectern with an open book: lessons to teach. */
export const IconLessons = (p: P) => <S {...p}><path d="M5 6.2c2.3-.9 4.6-.9 7 .5 2.4-1.4 4.7-1.4 7-.5v5c-2.3-.9-4.6-.9-7 .5-2.4-1.4-4.7-1.4-7-.5z" /><path d="M12 6.7v5" /><path d="M12 12.2v6.5M9 18.7h6" /></S>
export const IconQuill = (p: P) => <S {...p}><path d="M16.5 3.5C11 4 7.5 7.5 6 13l-1.5 3.5" /><path d="M16.5 3.5c-.5 4.5-3.5 8-8.5 9.5" /><path d="M9 9.5h4" /></S>
