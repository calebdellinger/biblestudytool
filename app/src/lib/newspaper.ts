// Typesets The Daily Word as a real PDF: masthead, three balanced columns, headlines, drop caps, page breaks.
// Built here rather than with the browser's print, because Safari can't carry newspaper columns across pages.
import { jsPDF } from 'jspdf'

export type Run = { text: string; font?: 'normal' | 'bold' | 'italic' | 'bolditalic'; sup?: boolean; red?: boolean }
export type Block =
  | { kind: 'masthead'; title: string; edition: string; dayLine: string; dateLine: string; source: string; first: boolean }
  | { kind: 'index'; items: [string, string][] }
  | { kind: 'story'; kicker: string; headline: string; headlineItalic?: boolean; dek?: string; paras: Run[][]; dropCap?: boolean; subheads?: Record<number, string> }

const PAGE = { w: 612, h: 792 }, M = { top: 40, bottom: 44, side: 38 }
const COLS = 3, GAP = 15
const COL_W = (PAGE.w - 2 * M.side - (COLS - 1) * GAP) / COLS
const BODY = 9.6, LEAD = 12.4
const RED: [number, number, number] = [138, 28, 20]

// The PDF's built-in Times and Helvetica cover Western European text; swap anything else for a close match.
const clean = (s: string) => s.replace(/[    ]/g, ' ').replace(/[‐‑]/g, '-').replace(/[^\x00-\xff‘’“”–—…•]/g, '')

type Word = { runs: { text: string; font: Run['font']; sup?: boolean; red?: boolean; w: number }[]; w: number }
type Line = { words: Word[]; width: number; last: boolean; indent: number; space: number }

export function buildPaper(blocks: Block[], footer: string): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true })
  let y = M.top, page = 1
  const width = (text: string, font: Run['font'] = 'normal', size = BODY) => { doc.setFont('times', font ?? 'normal'); doc.setFontSize(size); return doc.getTextWidth(text) }

  function newPage() {
    doc.addPage(); page++; y = M.top
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90)
    doc.text(footer, M.side, M.top - 14); doc.text(`Page ${page}`, PAGE.w - M.side, M.top - 14, { align: 'right' })
    doc.setDrawColor(20); doc.setLineWidth(0.6); doc.line(M.side, M.top - 9, PAGE.w - M.side, M.top - 9)
    doc.setTextColor(17)
  }
  const room = () => PAGE.h - M.bottom - y

  // Break runs into words (keeping a verse number glued to the word after it).
  function words(runs: Run[]): Word[] {
    const out: Word[] = []
    let cur: Word | null = null
    for (const r of runs) {
      const parts = clean(r.text).split(/(\s+)/)
      for (const part of parts) {
        if (!part) continue
        if (/^\s+$/.test(part)) { if (cur) { out.push(cur); cur = null } continue }
        const size = r.sup ? BODY * 0.62 : BODY
        const w = width(part, r.sup ? 'bold' : r.font, size)
        cur ??= { runs: [], w: 0 }
        cur.runs.push({ text: part, font: r.sup ? 'bold' : r.font, sup: r.sup, red: r.red || r.sup, w })
        cur.w += w + (r.sup ? 0.8 : 0)
        if (r.sup) continue // superscript sticks to the next word
      }
    }
    if (cur) out.push(cur)
    return out
  }
  // Lay a paragraph into lines of the column width; the first `dropLines` lines are indented for a drop cap.
  function lines(runs: Run[], dropW = 0, dropLines = 0): Line[] {
    const ws = words(runs), out: Line[] = [], space = width(' ')
    let cur: Word[] = [], curW = 0
    const avail = (n: number) => COL_W - (n < dropLines ? dropW : 0)
    for (const w of ws) {
      const need = curW + (cur.length ? space : 0) + w.w
      if (cur.length && need > avail(out.length)) {
        out.push({ words: cur, width: curW, last: false, indent: out.length < dropLines ? dropW : 0, space })
        cur = [w]; curW = w.w
      } else { cur.push(w); curW = need }
    }
    if (cur.length) out.push({ words: cur, width: curW, last: true, indent: out.length < dropLines ? dropW : 0, space })
    return out
  }
  function drawLine(l: Line, x: number, baseline: number) {
    const gaps = l.words.length - 1
    const extra = !l.last && gaps > 0 ? Math.min((COL_W - l.indent - l.width) / gaps, 4) : 0
    let cx = x + l.indent
    for (const w of l.words) {
      for (const r of w.runs) {
        doc.setFont('times', r.font ?? 'normal'); doc.setFontSize(r.sup ? BODY * 0.62 : BODY)
        if (r.red) doc.setTextColor(...RED); else doc.setTextColor(17)
        doc.text(r.text, cx, r.sup ? baseline - BODY * 0.34 : baseline)
        cx += r.w + (r.sup ? 0.8 : 0)
      }
      cx += l.space + extra
    }
    doc.setTextColor(17)
  }

  // Flow a list of items (lines, sub-headings, gaps) into three balanced columns, across pages as needed.
  type Item = { h: number; draw: (x: number, top: number) => void; keepWithNext?: boolean }
  function flow(items: Item[]) {
    let i = 0
    while (i < items.length) {
      if (room() < LEAD * 3) { newPage() }
      const H = room()
      // How many items fit if we use the whole remaining height in every column?
      const colsFill: number[][] = []
      let j = i
      for (let c = 0; c < COLS && j < items.length; c++) {
        const col: number[] = []; let h = 0
        while (j < items.length && h + items[j].h <= H) {
          if (items[j].keepWithNext && j + 1 < items.length && h + items[j].h + items[j + 1].h > H) break
          col.push(j); h += items[j].h; j++
        }
        colsFill.push(col)
      }
      let used: number[][]
      if (j >= items.length) {
        // Everything left fits on this page: balance the columns so they end level.
        const rest = items.slice(i)
        const total = rest.reduce((a, it) => a + it.h, 0)
        let target = total / COLS
        for (let attempt = 0; attempt < 40; attempt++) {
          used = []; let k = i
          for (let c = 0; c < COLS; c++) {
            const col: number[] = []; let h = 0
            while (k < items.length && (c === COLS - 1 || h + items[k].h <= target + 0.5)) { col.push(k); h += items[k].h; k++ }
            used.push(col)
          }
          const tallest = Math.max(...used.map(col => col.reduce((a, n) => a + items[n].h, 0)))
          if (k >= items.length && tallest <= H + 0.5) break
          target += LEAD / 2
        }
        used = used!
      } else used = colsFill
      let maxH = 0
      used.forEach((col, c) => {
        const x = M.side + c * (COL_W + GAP)
        let top = y
        for (const n of col) { items[n].draw(x, top); top += items[n].h }
        maxH = Math.max(maxH, top - y)
        if (c > 0 && col.length) { doc.setDrawColor(190); doc.setLineWidth(0.4); doc.line(x - GAP / 2, y, x - GAP / 2, y + Math.max(maxH, top - y)) }
      })
      i = Math.max(i, ...used.flat().map(n => n + 1))
      y += maxH
      if (i < items.length) newPage()
    }
  }

  for (const b of blocks) {
    if (b.kind === 'masthead') {
      if (!b.first) newPage()
      doc.setTextColor(17); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      doc.text(b.edition.toUpperCase(), M.side, y); doc.text(b.dayLine.toUpperCase(), PAGE.w / 2, y, { align: 'center' }); doc.text("M'CHEYNE READING PLAN", PAGE.w - M.side, y, { align: 'right' })
      y += 5; doc.setDrawColor(17); doc.setLineWidth(0.8); doc.line(M.side, y, PAGE.w - M.side, y)
      y += 46; doc.setFont('times', 'bold'); doc.setFontSize(52); doc.text(clean(b.title), PAGE.w / 2, y, { align: 'center' })
      y += 12; doc.setLineWidth(0.8); doc.line(M.side, y, PAGE.w - M.side, y)
      y += 10; doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
      doc.text(b.dateLine.toUpperCase(), M.side, y); doc.text('YHWH', PAGE.w / 2, y, { align: 'center' }); doc.text(b.source.toUpperCase(), PAGE.w - M.side, y, { align: 'right' })
      y += 5; doc.setLineWidth(1.6); doc.line(M.side, y, PAGE.w - M.side, y); doc.setLineWidth(0.5); doc.line(M.side, y + 2.6, PAGE.w - M.side, y + 2.6)
      y += 16
    } else if (b.kind === 'index') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...RED); doc.text('IN THIS EDITION', M.side, y)
      let x = M.side + width('IN THIS EDITION  ', 'bold', 7) + 18; doc.setTextColor(17)
      for (const [kind, title] of b.items) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(clean(kind.toUpperCase()), x, y)
        const kw = doc.getTextWidth(clean(kind.toUpperCase())) + 4
        doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.text(clean(title), x + kw, y)
        x += kw + doc.getTextWidth(clean(title)) + 16
      }
      y += 7; doc.setDrawColor(17); doc.setLineWidth(0.5); doc.line(M.side, y, PAGE.w - M.side, y); y += 16
    } else {
      // Headline across the full width.
      const hSize = b.headlineItalic ? 22 : 24
      doc.setFont('times', b.headlineItalic ? 'bolditalic' : 'bold'); doc.setFontSize(hSize)
      const hLines: string[] = doc.splitTextToSize(clean(b.headline), PAGE.w - 2 * M.side)
      if (room() < 14 + hLines.length * hSize * 1.08 + (b.dek ? 14 : 0) + LEAD * 6) newPage()
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...RED); doc.text(clean(b.kicker.toUpperCase()), M.side, y)
      doc.setTextColor(17); y += hSize * 0.95
      doc.setFont('times', b.headlineItalic ? 'bolditalic' : 'bold'); doc.setFontSize(hSize)
      for (const hl of hLines) { doc.text(hl, M.side, y); y += hSize * 1.08 }
      y -= hSize * 0.3
      if (b.dek) { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(70); doc.text(clean(b.dek), M.side, y + 6); doc.setTextColor(17); y += 14 }
      y += 8
      // Body: paragraphs → lines → items, with sub-headings (chapter names) and a drop cap on the first paragraph.
      const items: Item[] = []
      b.paras.forEach((runs, pi) => {
        const sub = b.subheads?.[pi]
        if (sub) items.push({ h: 15, keepWithNext: true, draw: (x, top) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(17); doc.text(clean(sub.toUpperCase()), x, top + 10) } })
        let paraRuns = runs, dropW = 0, drop = ''
        if (b.dropCap && pi === 0 && runs[0]?.text) {
          drop = clean(runs[0].text).trimStart()[0]
          paraRuns = [{ ...runs[0], text: clean(runs[0].text).trimStart().slice(1) }, ...runs.slice(1)]
          dropW = width(drop, 'bold', 34) + 3
        }
        const ls = lines(paraRuns, dropW, drop ? 3 : 0)
        ls.forEach((l, li) => items.push({
          h: LEAD + (l.last ? 3.5 : 0),
          draw: (x, top) => {
            if (drop && li === 0) { doc.setFont('times', 'bold'); doc.setFontSize(34); doc.setTextColor(...RED); doc.text(drop, x, top + LEAD * 2.55); doc.setTextColor(17) }
            drawLine(l, x, top + LEAD - 3)
          },
        }))
      })
      flow(items)
      y += 8; doc.setDrawColor(17); doc.setLineWidth(0.8); doc.line(M.side, y, PAGE.w - M.side, y); y += 16
    }
  }
  // Footer line on the first page too.
  doc.setPage(1); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(110)
  doc.text(clean(footer), PAGE.w / 2, PAGE.h - 24, { align: 'center' })
  return doc.output('blob')
}
