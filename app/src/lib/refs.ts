// Turn typed text ("jn 3:16-18", "see Rom 8:28") into verse ranges.
import { bcv_parser } from 'bible-passage-reference-parser/esm/bcv_parser.js'
import * as lang from 'bible-passage-reference-parser/esm/lang/en.js'
import { bookByOsis, vid } from './bible'

// In running text (notes, sermons) a book name alone isn't a reference: "Every link is God's" must not mean Isaiah.
const inText = new bcv_parser(lang)
inText.set_options({ osis_compaction_strategy: 'bcv', consecutive_combination_strategy: 'separate', book_alone_strategy: 'ignore' })
// In the search box it is: typing "Romans" should open Romans.
const inQuery = new bcv_parser(lang)
inQuery.set_options({ osis_compaction_strategy: 'bcv', consecutive_combination_strategy: 'separate', book_alone_strategy: 'full' })

export type Range = { s: number; e: number }

function osisToId(osis: string): number | null {
  const [bk, c, v] = osis.split('.')
  const book = bookByOsis(bk)
  if (!book) return null
  return vid(book.id, Number(c ?? 1), Number(v ?? 1))
}
function toRanges(osis: string): Range[] {
  const out: Range[] = []
  if (!osis) return out
  for (const part of osis.split(',')) {
    const [a, b] = part.split('-')
    const s = osisToId(a), e = osisToId(b ?? a)
    if (s && e) out.push({ s, e })
  }
  return out
}

/** Every reference written in a piece of text, as verse-id ranges. */
export const findRefs = (text: string): Range[] => toRanges(inText.parse(text).osis())

/** The first reference in a search box entry, or null if it isn't a reference. */
export const parseQuery = (text: string): Range | null => toRanges(inQuery.parse(text).osis())[0] ?? null
