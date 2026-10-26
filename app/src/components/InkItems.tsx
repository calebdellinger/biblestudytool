// Shapes, arrows, text boxes and verse cards on the ink canvas: drawing them, hit-testing, selection handles,
// arrows that stay attached to what they point at, and lasso geometry.
import type { InkItemDoc } from '../lib/db'
import { INK_COLORS } from '../lib/ink'

export type InkItem = InkItemDoc
export type ShapeKind = 'rect' | 'ellipse' | 'tri' | 'line' | 'arrow'
export const SHAPE_LABEL: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Circle', tri: 'Triangle', line: 'Line', arrow: 'Arrow' }
export const strokeW = (sw: number) => [0, 2.5, 4, 7][sw] ?? 4
export const isLineLike = (it: InkItem) => it.t === 'line' || it.t === 'arrow'
const LINE_H = 1.28
export const textLines = (it: InkItem) => (it.text ?? '').split('\n')

/* ---------- verse cards ---------- */
export const VERSE = { pad: 34, ref: 19, size: 25, lh: 1.5, minW: 280, defW: 560, maxLines: 24 }
const ACCENT: Record<string, string> = { ink: '#24427f', blue: '#2c55b8', red: '#b23a2e', green: '#2e7d4f', yellow: '#b8860b' }
const wrapCache = new Map<string, string[]>()
function wrap(text: string, chars: number): string[] {
  const key = `${chars}|${text}`
  const hit = wrapCache.get(key); if (hit) return hit
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > chars) { out.push(line); line = word } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  if (wrapCache.size > 500) wrapCache.clear()
  wrapCache.set(key, out)
  return out
}
export function verseLayout(it: InkItem) {
  const inner = it.w - VERSE.pad * 2 - 14
  let lines = wrap(it.text ?? '', Math.max(12, Math.floor(inner / (VERSE.size * 0.47))))
  if (lines.length > VERSE.maxLines) lines = [...lines.slice(0, VERSE.maxLines - 1), `${lines[VERSE.maxLines - 1]}…`]
  const h = VERSE.pad + VERSE.ref + 22 + lines.length * VERSE.size * VERSE.lh + VERSE.pad * 0.75 + 20
  return { lines, h }
}

/** The raised card: a thick edge underneath, soft cast shadows, a lit top edge, a coloured spine, and the verse in serif. */
function VerseCard({ it }: { it: InkItem }) {
  const { lines, h } = verseLayout(it)
  const x = it.x, y = it.y, w = it.w, r = 20, accent = ACCENT[it.c] ?? ACCENT.ink
  const ty = y + VERSE.pad + VERSE.ref
  return (
    <g className="vc">
      {/* the card's thickness, seen below and to the right */}
      <rect x={x + 3} y={y + 9} width={w} height={h} rx={r} className="vc-edge" style={{ fill: `color-mix(in srgb, ${accent} 30%, var(--vc-edge))` }} />
      <rect x={x} y={y} width={w} height={h} rx={r} className="vc-face" filter="url(#vc-shadow)" />
      <rect x={x} y={y} width={w} height={h} rx={r} fill="url(#vc-sheen)" />
      {/* spine */}
      <path d={`M${x + r} ${y}h8v${h}h-8a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`} fill={accent} />
      {/* lit top edge */}
      <path d={`M${x + r} ${y + 1.2}H${x + w - r}`} className="vc-light" />
      <text x={x + w - VERSE.pad + 4} y={y + VERSE.pad + 70} className="vc-quote" textAnchor="end">”</text>
      <text x={x + VERSE.pad + 14} y={ty} className="vc-ref" style={{ fill: accent }}>{it.ref}</text>
      <text className="vc-text" fontSize={VERSE.size}>
        {lines.map((l, i) => <tspan key={i} x={x + VERSE.pad + 14} y={ty + 22 + (i + 0.85) * VERSE.size * VERSE.lh}>{l}</tspan>)}
      </text>
      <text x={x + VERSE.pad + 14} y={y + h - 22} className="vc-tr">{it.tr ?? ''}</text>
    </g>
  )
}
/** Shared SVG definitions for verse cards; put once in each drawing. */
export function VerseDefs() {
  return (
    <defs>
      <filter id="vc-shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="22" stdDeviation="22" floodColor="#0b1020" floodOpacity="0.16" />
        <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#0b1020" floodOpacity="0.12" />
      </filter>
      <linearGradient id="vc-sheen" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
        <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.06" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.05" />
      </linearGradient>
    </defs>
  )
}

/* ---------- geometry ---------- */
/** Bounding box [x0, y0, x1, y1] in band coordinates. */
export function itemBox(it: InkItem): [number, number, number, number] {
  if (it.t === 'text') {
    const size = it.size ?? 28, lines = textLines(it)
    const w = Math.max(size * 2, ...lines.map(l => l.length * size * 0.56))
    return [it.x, it.y, it.x + w, it.y + Math.max(1, lines.length) * size * LINE_H]
  }
  if (it.t === 'verse') return [it.x, it.y, it.x + it.w, it.y + verseLayout(it).h]
  return [Math.min(it.x, it.x + it.w), Math.min(it.y, it.y + it.h), Math.max(it.x, it.x + it.w), Math.max(it.y, it.y + it.h)]
}
function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
/** Is (x, y) on the item? Outlines are picked by their edge (or anywhere inside if filled); text and cards by their box. */
export function hitItem(it: InkItem, x: number, y: number, tol: number) {
  if (isLineLike(it)) return segDist(x, y, it.x, it.y, it.x + it.w, it.y + it.h) <= tol + strokeW(it.sw)
  const [x0, y0, x1, y1] = itemBox(it)
  const inside = x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol
  if (it.t === 'text' || it.t === 'verse' || it.fill || !inside) return inside
  if (it.t === 'rect') return x - x0 < tol * 2 || x1 - x < tol * 2 || y - y0 < tol * 2 || y1 - y < tol * 2 || (x1 - x0 < tol * 6 || y1 - y0 < tol * 6)
  if (it.t === 'ellipse') {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.max(1, (x1 - x0) / 2), ry = Math.max(1, (y1 - y0) / 2)
    return Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry) < tol * 2 || Math.min(rx, ry) < tol * 3
  }
  const a: [number, number] = [(x0 + x1) / 2, y0], b: [number, number] = [x1, y1], c: [number, number] = [x0, y1]
  return Math.min(segDist(x, y, ...a, ...b), segDist(x, y, ...b, ...c), segDist(x, y, ...c, ...a)) < tol * 2
}
/** Somewhere an arrow can attach: anywhere inside the item's area. */
export const canAnchor = (it: InkItem) => !isLineLike(it)
export function insideItem(it: InkItem, x: number, y: number, tol = 0) {
  const [x0, y0, x1, y1] = itemBox(it)
  return x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol
}
/** Where a line from the item's centre toward (tx, ty) leaves the item's edge (plus a small gap). */
export function edgePoint(it: InkItem, tx: number, ty: number, gap: number): [number, number] {
  const [x0, y0, x1, y1] = itemBox(it)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, dx = tx - cx, dy = ty - cy
  const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
  let t: number
  if (it.t === 'ellipse') {
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2
    t = 1 / Math.sqrt((ux * ux) / (rx * rx || 1) + (uy * uy) / (ry * ry || 1))
  } else {
    const tx1 = ux ? (ux > 0 ? x1 - cx : x0 - cx) / ux : Infinity, ty1 = uy ? (uy > 0 ? y1 - cy : y0 - cy) / uy : Infinity
    t = Math.min(Math.abs(tx1), Math.abs(ty1))
  }
  return [cx + ux * (t + gap), cy + uy * (t + gap)]
}
const centre = (it: InkItem): [number, number] => { const [x0, y0, x1, y1] = itemBox(it); return [(x0 + x1) / 2, (y0 + y1) / 2] }
/** An attached line/arrow with its ends recomputed from what they're attached to (all in canvas coordinates).
 *  `find` gives an item and its band top by id. */
export function resolveLine(it: InkItem, top: number, find: (id: string) => { it: InkItem; top: number } | undefined): InkItem {
  if (!isLineLike(it) || (!it.from && !it.to)) return it
  const A = it.from ? find(it.from) : undefined, B = it.to ? find(it.to) : undefined
  const shift = (o: { it: InkItem; top: number }) => ({ ...o.it, y: o.it.y + o.top })
  const a = A ? shift(A) : undefined, b = B ? shift(B) : undefined
  let sx = it.x, sy = it.y + top, ex = it.x + it.w, ey = it.y + it.h + top
  const aim1 = b ? centre(b) : [ex, ey] as [number, number]
  if (a) [sx, sy] = edgePoint(a, aim1[0], aim1[1], 6)
  const aim2 = a ? centre(a) : [sx, sy] as [number, number]
  if (b) [ex, ey] = edgePoint(b, aim2[0], aim2[1], it.t === 'arrow' ? 8 : 6)
  return { ...it, x: sx, y: sy - top, w: ex - sx, h: ey - sy }
}

/* ---------- drawing ---------- */
export function ItemShape({ it }: { it: InkItem }) {
  if (it.t === 'verse') return <VerseCard it={it} />
  const color = INK_COLORS[it.c], w = strokeW(it.sw)
  const fill = it.fill ? color : 'none'
  const common = { stroke: color, strokeWidth: w, fill, fillOpacity: it.fill ? 0.14 : undefined, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
  const [x0, y0, x1, y1] = itemBox(it)
  switch (it.t) {
    case 'rect': return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={6} {...common} />
    case 'ellipse': return <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} {...common} />
    case 'tri': return <polygon points={`${(x0 + x1) / 2},${y0} ${x1},${y1} ${x0},${y1}`} {...common} />
    case 'line': return <line x1={it.x} y1={it.y} x2={it.x + it.w} y2={it.y + it.h} {...common} />
    case 'arrow': {
      const ex = it.x + it.w, ey = it.y + it.h, ang = Math.atan2(it.h, it.w), L = 14 + w * 3, spread = 0.45
      const p1 = [ex - L * Math.cos(ang - spread), ey - L * Math.sin(ang - spread)], p2 = [ex - L * Math.cos(ang + spread), ey - L * Math.sin(ang + spread)]
      return (
        <g>
          <line x1={it.x} y1={it.y} x2={ex - Math.cos(ang) * L * 0.5} y2={ey - Math.sin(ang) * L * 0.5} {...common} />
          <polygon points={`${ex},${ey} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill={color} stroke={color} strokeWidth={w * 0.6} strokeLinejoin="round" />
        </g>
      )
    }
    case 'text': {
      const size = it.size ?? 28
      return (
        <text x={it.x} y={it.y} fontSize={size} fill={color} className="ink-text">
          {textLines(it).map((l, i) => <tspan key={i} x={it.x} dy={i === 0 ? size * 0.95 : size * LINE_H}>{l || ' '}</tspan>)}
        </text>
      )
    }
  }
  return null
}

/* ---------- selection handles ---------- */
export type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'a' | 'b'
export function handlesOf(it: InkItem): [Handle, number, number][] {
  if (isLineLike(it)) return [['a', it.x, it.y], ['b', it.x + it.w, it.y + it.h]]
  const [x0, y0, x1, y1] = itemBox(it)
  if (it.t === 'text' || it.t === 'verse') return [['se', x1, y1]]
  return [['nw', x0, y0], ['ne', x1, y0], ['se', x1, y1], ['sw', x0, y1]]
}
/** The item after dragging handle `h` to (x, y). Text grows its font from the corner; verse cards change width. */
export function resizeItem(orig: InkItem, h: Handle, x: number, y: number): InkItem {
  if (h === 'a') return { ...orig, x, y, w: orig.x + orig.w - x, h: orig.y + orig.h - y }
  if (h === 'b') return { ...orig, w: x - orig.x, h: y - orig.y }
  if (orig.t === 'verse') return { ...orig, w: Math.max(VERSE.minW, Math.round(x - orig.x)) }
  if (orig.t === 'text') {
    const [x0, y0, , y1] = itemBox(orig)
    const k = Math.max(0.2, (y - y0) / Math.max(1, y1 - y0))
    return { ...orig, x: x0, size: Math.max(10, Math.min(200, Math.round((orig.size ?? 28) * k))) }
  }
  let [x0, y0, x1, y1] = itemBox(orig)
  if (h === 'nw') { x0 = x; y0 = y } else if (h === 'ne') { x1 = x; y0 = y } else if (h === 'se') { x1 = x; y1 = y } else { x0 = x; y1 = y }
  return { ...orig, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}
/** Rectangles, circles and triangles store a positive box. */
export function normalise(it: InkItem): InkItem {
  if (isLineLike(it) || it.t === 'text' || it.t === 'verse') return it
  const [x0, y0, x1, y1] = itemBox(it)
  return { ...it, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/* ---------- moving and scaling (lasso) ---------- */
export type Xf = { dx: number; dy: number; k: number; ax: number; ay: number }   // scale k about (ax, ay), then move
export const xfPoint = (t: Xf, x: number, y: number): [number, number] => [t.ax + (x - t.ax) * t.k + t.dx, t.ay + (y - t.ay) * t.k + t.dy]
/** Apply a canvas-space transform to an item stored on a band whose top is `top`. */
export function xfItem(it: InkItem, t: Xf, top: number): InkItem {
  const [x, y] = xfPoint(t, it.x, it.y + top)
  const out: InkItem = { ...it, x, y: y - top }
  if (it.t === 'text') out.size = Math.max(8, Math.round((it.size ?? 28) * t.k))
  else if (it.t === 'verse') out.w = Math.max(VERSE.minW, it.w * t.k)
  else { out.w = it.w * t.k; out.h = it.h * t.k }
  return out
}
export function pointInPolygon(x: number, y: number, poly: number[]) {
  let inside = false
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
