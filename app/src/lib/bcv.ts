// Shared parser instance that reports where references sit in a piece of text.
import { bcv_parser } from 'bible-passage-reference-parser/esm/bcv_parser.js'
import * as lang from 'bible-passage-reference-parser/esm/lang/en.js'

const bcv = new bcv_parser(lang)
bcv.set_options({ osis_compaction_strategy: 'bcv', consecutive_combination_strategy: 'separate' })

export default {
  indices(text: string): { osis: string; indices: [number, number] }[] {
    return bcv.parse(text).osis_and_indices() as { osis: string; indices: [number, number] }[]
  },
}
