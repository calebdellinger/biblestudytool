// Build Margin's Spurgeon library.
// Sources (all public domain / CC0):
//   lyteword/chspurgeon-sermons  Metropolitan Tabernacle Pulpit, 63 volumes (markdown, CC0)
//   lyteword/chspurgeon-tod      The Treasury of David (markdown, CC0)
//   npm "morning-evening"        Morning and Evening (JSON, from CCEL)
// Usage: node scripts/build_spurgeon.mjs <dir containing chspurgeon-sermons, chspurgeon-tod> <morning-evening devotionals.json>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(path.join(ROOT, 'app', 'package.json'))
const { bcv_parser } = await import(require.resolve('bible-passage-reference-parser/esm/bcv_parser.js'))
const lang = await import(require.resolve('bible-passage-reference-parser/esm/lang/en.js'))
const bcv = new bcv_parser(lang)
bcv.set_options({ osis_compaction_strategy: 'bcv', consecutive_combination_strategy: 'separate', book_alone_strategy: 'full' })

const [SRC, ME] = process.argv.slice(2)
const OUT = path.join(ROOT, 'app', 'public', 'data', 'spurgeon')
const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'public', 'data', 'books.json'), 'utf8'))
const OSIS = Object.fromEntries(books.map(b => [b.osis, b.id]))
const vid = (b, c, v) => b * 1_000_000 + c * 1000 + v
function toId(o) { const [b, c, v] = o.split('.'); return OSIS[b] ? vid(OSIS[b], +(c ?? 1), +(v ?? 1)) : null }
function refs(text) {
  const osis = bcv.parse(text).osis()
  if (!osis) return []
  return osis.split(',').map(p => { const [a, b] = p.split('-'); return [toId(a), toId(b ?? a)] }).filter(r => r[0] && r[1])
}
const decode = s => s.replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'sermons'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'tod'), { recursive: true })

// ---- Sermons
const sermons = []
const sdir = path.join(SRC, 'chspurgeon-sermons')
for (const vol of fs.readdirSync(sdir).filter(d => d.startsWith('volume-'))) {
  const v = +vol.split('-')[1]
  for (const file of fs.readdirSync(path.join(sdir, vol)).filter(f => f.endsWith('.md'))) {
    const md = fs.readFileSync(path.join(sdir, vol, file), 'utf8')
    const lines = md.split('\n')
    const head = lines[0].match(/^#\s*Sermon\s+([^|]+?)\s*\|\s*(.+)$/)
    if (!head) continue
    const num = head[1].trim(), title = decode(head[2].trim())
    const quote = []
    for (const l of lines.slice(1, 20)) {
      if (l.startsWith('>')) quote.push(l.replace(/^>\s?/, '').trim())
      else if (quote.length && l.trim()) break
    }
    const qText = decode(quote.join(' ').replace(/\s+/g, ' ').trim())
    const r = refs(qText)
    const ref = r.length ? r[r.length - 1] : null
    const id = file.replace(/^sermon[-_]/, '').replace(/\.md$/, '')
    const body = decode(lines.slice(1).join('\n')).trim()
    fs.writeFileSync(path.join(OUT, 'sermons', `${id}.md`), body)
    sermons.push([id, num, title, v, ref?.[0] ?? 0, ref?.[1] ?? 0, qText.slice(0, 220)])
  }
}
sermons.sort((a, b) => parseInt(a[1]) - parseInt(b[1]) || a[1].localeCompare(b[1]))
fs.writeFileSync(path.join(OUT, 'sermons.json'), JSON.stringify(sermons))

// ---- Treasury of David
const tdir = path.join(SRC, 'chspurgeon-tod')
let psalms = 0
for (const vol of fs.readdirSync(tdir).filter(d => d.startsWith('volume-'))) {
  for (const file of fs.readdirSync(path.join(tdir, vol)).filter(f => /^psalm-\d+\.md$/.test(f))) {
    const n = +file.match(/\d+/)[0]
    let md = decode(fs.readFileSync(path.join(tdir, vol, file), 'utf8')).replace(/^---[\s\S]*?---\s*/, '')
    const sections = {}; let cur = 'intro'; sections[cur] = []
    for (const line of md.split('\n')) {
      const h2 = line.match(/^##\s+(.+)/)
      if (h2 && !line.startsWith('###')) {
        const t = h2[1].toLowerCase()
        cur = t.startsWith('exposition') ? 'exposition' : t.startsWith('explanatory') ? 'notes' : t.startsWith('hints') ? 'hints' : t.startsWith('works') ? 'works' : t
        sections[cur] = []; continue
      }
      sections[cur].push(line)
    }
    const verseRange = s => { const m = s.match(/(\d+)(?:\s*(?:-|–|&|,|to)\s*(\d+))?/); return m ? [+m[1], +(m[2] ?? m[1])] : null }
    // Exposition: "### Verse 1" blocks
    const exposition = []
    let block = null
    for (const line of (sections.exposition ?? [])) {
      const h = line.match(/^###\s+Verses?\s+(.+)/)
      if (h) { block = [...(verseRange(h[1]) ?? [0, 0]), []]; exposition.push(block); continue }
      if (block) block[2].push(line); else (exposition.pre ??= []).push(line)
    }
    // Notes and hints: paragraphs starting "**Verse 1 —**" or "**Verses 1-3.**"
    const byVerse = lines => {
      const out = []; let cur = null
      for (const line of lines ?? []) {
        const m = line.match(/^\*\*\s*(?:Verses?|Ver\.?)\s+([\d\s,&\-–to]+)/i)
        if (m) { cur = [...(verseRange(m[1]) ?? [0, 0]), [line]]; out.push(cur) }
        else if (cur) cur[2].push(line)
        else if (line.trim()) { cur = [0, 0, [line]]; out.push(cur) }
      }
      return out.map(([s, e, l]) => [s, e, l.join('\n').trim()]).filter(x => x[2])
    }
    const title = (sections.intro.find(l => l.startsWith('# ')) ?? `# Psalm ${n}`).slice(2).trim()
    const intro = sections.intro.filter(l => !l.startsWith('# ')).join('\n').trim()
    fs.writeFileSync(path.join(OUT, 'tod', `${n}.json`), JSON.stringify({
      title, intro,
      exposition: exposition.map(([s, e, l]) => [s, e, l.join('\n').trim()]),
      notes: byVerse(sections.notes), hints: byVerse(sections.hints),
      works: (sections.works ?? []).join('\n').trim(),
    }))
    psalms++
  }
}

// Psalm 119 comes as one file per eight-verse section, each with exposition, notes and hints per verse.
{
  const dir = fs.readdirSync(tdir).map(v => path.join(tdir, v, 'psalm-119')).find(d => fs.existsSync(d))
  if (dir) {
    const strip = t => decode(t).replace(/^---[\s\S]*?---\s*/, '')
    const intro = fs.existsSync(path.join(dir, '_index.md')) ? strip(fs.readFileSync(path.join(dir, '_index.md'), 'utf8')).replace(/^#\s.*$/m, '').trim() : ''
    const exposition = [], notes = [], hints = []
    const files = fs.readdirSync(dir).filter(f => /^verses-\d+/.test(f)).sort((a, b) => parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]))
    for (const f of files) {
      let v = 0, kind = null, buf = []
      const flush = () => { if (v && kind && buf.join('').trim()) ({ exposition, notes, hints })[kind].push([v, v, buf.join('\n').trim()]); buf = [] }
      for (const line of strip(fs.readFileSync(path.join(dir, f), 'utf8')).split('\n')) {
        const ex = line.match(/^##\s+Exposition\s+Verse\s+(\d+)/i)
        if (ex) { flush(); v = +ex[1]; kind = 'exposition'; continue }
        if (/^###\s+Explanatory/i.test(line)) { flush(); kind = 'notes'; continue }
        if (/^###\s+Hints/i.test(line)) { flush(); kind = 'hints'; continue }
        if (/^#\s/.test(line)) continue
        buf.push(line)
      }
      flush()
    }
    fs.writeFileSync(path.join(OUT, 'tod', '119.json'), JSON.stringify({ title: 'Psalm 119', intro, exposition, notes, hints, works: '' }))
    psalms++
  }
}

// ---- Morning and Evening
const me = JSON.parse(fs.readFileSync(ME, 'utf8')).map(d => {
  const r = refs(d.scripture)[0] ?? [0, 0]
  return [d.date, d.period, d.scripture, r[0], r[1], d.verse, d.text]
})
fs.writeFileSync(path.join(OUT, 'morning-evening.json'), JSON.stringify(me))

const keyed = sermons.filter(s => s[4]).length
console.log(`sermons ${sermons.length} (${keyed} keyed to a text), psalms ${psalms}, morning & evening ${me.length} (${me.filter(m => m[3]).length} keyed)`)
