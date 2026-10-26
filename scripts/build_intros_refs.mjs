// Turns the key-verse references in intro.json into verse ids [label, start, end].
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const pkg = path.join(root, 'app/node_modules/bible-passage-reference-parser/esm')
const { bcv_parser } = await import(path.join(pkg, 'bcv_parser.js'))
const lang = await import(path.join(pkg, 'lang/en.js'))
const books = JSON.parse(fs.readFileSync(path.join(root, 'app/public/data/books.json'), 'utf8'))
const byOsis = new Map(books.map(b => [b.osis, b]))
const p = new bcv_parser(lang)
p.set_options({ osis_compaction_strategy: 'bcv', consecutive_combination_strategy: 'combine' })
const file = path.join(root, 'app/public/data/intro.json')
const d = JSON.parse(fs.readFileSync(file, 'utf8'))
const bad = []
for (const b of d.books) {
  b.key = b.key.map(k => typeof k === 'string' ? k : k[0]).map(k => {
    const o = p.parse(k).osis()
    const [a, z = a] = o.split('-')
    const id = s => { const [bk, c, v] = s.split('.'); const x = byOsis.get(bk); return x ? x.id * 1e6 + +c * 1000 + +(v ?? 1) : NaN }
    const s = id(a), e = id(z)
    if (!o || o.includes(',') || Number.isNaN(s) || Math.floor(s / 1e6) !== b.id) bad.push(`${b.id} ${k} -> ${o}`)
    const label = k.replace(/^\S+\s/, '').replace('-', '–')
    return [label, s, e]
  })
}
if (bad.length) { console.log(bad.join('\n')); process.exit(1) }
fs.writeFileSync(file, JSON.stringify(d))
console.log('refs ok', fs.statSync(file).size, 'bytes')
