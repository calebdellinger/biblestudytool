// The tool wheel: a small button in the bottom-right corner. Tap it and it opens into a three-quarter wheel with
// three rings: pens (inside), things to add (middle), colour and size (outside). Picking a tool closes it again,
// so the whole page stays clear for writing.
import { useEffect, useState } from 'react'
import { INK_COLORS } from '../lib/ink'
import type { ShapeKind } from './InkItems'

export type WheelTool = 'pen' | 'hl' | 'eraser' | 'select' | 'lasso' | 'text' | 'verse' | ShapeKind
type Color = 'ink' | 'blue' | 'red' | 'green'

const R_IN = [52, 104], R_MID = [108, 160], R_OUT = [164, 210]   // ring radii at full size
const START = 90, SPAN = 270                                       // from straight down, round through left and up, to the right

function rad(a: number) { return (a * Math.PI) / 180 }
function sector(r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(r * Math.cos(rad(a))).toFixed(2)} ${(r * Math.sin(rad(a))).toFixed(2)}`
  return `M${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`
}

/* ---------- icons, drawn on a 24-unit grid ---------- */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
export function ToolIcon({ t }: { t: WheelTool }) {
  return (
    <g transform="translate(-12 -12)">
      {t === 'pen' && <g {...S}><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z" /><path d="M14.5 6.5l3 3" /></g>}
      {t === 'hl' && <g {...S}><path d="M9 14l-2 6h6l-2-6" /><path d="M8 14h6l3-9-6-2-3 11z" /><path d="M4 21h16" strokeOpacity={0.5} /></g>}
      {t === 'eraser' && <g {...S}><path d="M7 20h12" /><path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H8.5z" /><path d="M10 11l5 5" /></g>}
      {t === 'select' && <g {...S}><path d="M6 4l12 7-5.5 1.5L10 18z" /></g>}
      {t === 'lasso' && <g {...S}><path d="M12 5c4.4 0 8 2 8 4.5S16.4 14 12 14s-8-2-8-4.5S7.6 5 12 5z" strokeDasharray="2.6 2.4" /><path d="M7 13c-1.5 1.5-1 4 1.5 4.5S11 20 10 21" /></g>}
      {t === 'text' && <g {...S}><path d="M5 6V4.5h14V6M12 4.5V20M9 20h6" /></g>}
      {t === 'verse' && <g {...S}><rect x={4} y={5} width={16} height={14} rx={2.5} /><path d="M7 5v14" /><path d="M10 10h7M10 14h5" /></g>}
      {t === 'rect' && <rect x={4} y={6} width={16} height={12} rx={1.5} {...S} />}
      {t === 'ellipse' && <circle cx={12} cy={12} r={7.5} {...S} />}
      {t === 'tri' && <path d="M12 4.5l8 14H4z" {...S} />}
      {t === 'line' && <path d="M5 19L19 5" {...S} />}
      {t === 'arrow' && <g {...S}><path d="M5 19L18 6" /><path d="M10 5.5h8.5V14" /></g>}
    </g>
  )
}
const LABEL: Record<WheelTool, string> = {
  pen: 'Pen', hl: 'Highlighter', eraser: 'Eraser', select: 'Select', lasso: 'Lasso', text: 'Text', verse: 'Verse card',
  rect: 'Rectangle', ellipse: 'Circle', tri: 'Triangle', line: 'Line', arrow: 'Arrow',
}

export function InkWheel({ tool, color, width, onTool, onColor, onWidth }: {
  tool: WheelTool; color: Color; width: number
  onTool: (t: WheelTool) => void; onColor: (c: Color) => void; onWidth: (w: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [k, setK] = useState(1)
  useEffect(() => {
    const fit = () => setK(Math.min(1, (Math.min(innerWidth, innerHeight - 120) - 28) / (2 * R_OUT[1])))
    fit(); addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [open])

  const inner: WheelTool[] = ['pen', 'hl', 'eraser', 'lasso', 'select']
  const middle: WheelTool[] = ['text', 'verse', 'rect', 'ellipse', 'tri', 'line', 'arrow']
  const outer: ({ c: Color } | { w: number })[] = [{ c: 'ink' }, { c: 'blue' }, { c: 'red' }, { c: 'green' }, { w: 1 }, { w: 2 }, { w: 3 }]
  const pick = (t: WheelTool) => { onTool(t); setOpen(false) }

  const ring = <T,>(list: T[], [r0, r1]: number[], render: (item: T, mid: number, rr: number) => React.ReactNode, key: (item: T) => string, on: (item: T) => boolean, act: (item: T) => void, label: (item: T) => string) => {
    const step = SPAN / list.length
    return list.map((item, i) => {
      const a0 = START + i * step + 0.8, a1 = START + (i + 1) * step - 0.8, mid = (a0 + a1) / 2, rr = (r0 + r1) / 2
      return (
        <g key={key(item)} className={`wheel-seg ${on(item) ? 'is-on' : ''}`} role="button" aria-label={label(item)} aria-pressed={on(item)} tabIndex={0}
          onClick={() => act(item)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(item) } }}>
          <path className="wheel-bg" d={sector(r0, r1, a0, a1)} />
          <g className="wheel-ic" style={{ color: on(item) ? 'var(--lapis-ink)' : 'var(--ink)' }} transform={`translate(${(rr * Math.cos(rad(mid))).toFixed(1)} ${(rr * Math.sin(rad(mid))).toFixed(1)})`}>{render(item, mid, rr)}</g>
        </g>
      )
    })
  }
  const size = 2 * R_OUT[1] + 16
  const c = R_OUT[1] * k + 14   // distance of the open wheel's centre from the right and bottom edges
  const swatch = tool === 'hl' ? INK_COLORS.yellow : INK_COLORS[color]

  return (
    <>
      {open && <div className="wheel-backdrop" onPointerDown={e => { e.stopPropagation(); setOpen(false) }} />}
      <div className={`wheel ${open ? 'is-open' : ''}`}>
        {open && (
          <svg className="wheel-svg" style={{ right: c - (size * k) / 2, bottom: c - (size * k) / 2 }} onPointerDown={e => e.stopPropagation()} width={size * k} height={size * k} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-label="Tools">
            <g className="wheel-ring ring-out">
              {ring(outer, R_OUT, item => ('c' in item
                ? <circle r={13} fill={item.c === 'ink' ? 'var(--ink)' : INK_COLORS[item.c]} className="wheel-swatch" />
                : <circle r={2.5 + item.w * 2.5} className="wheel-dot" />),
              item => ('c' in item ? item.c : `w${item.w}`),
              item => ('c' in item ? item.c === color : item.w === width),
              item => ('c' in item ? onColor(item.c) : onWidth(item.w)),
              item => ('c' in item ? `${item.c === 'ink' ? 'Black' : item.c} ink` : ['Fine', 'Medium', 'Bold'][item.w - 1]))}
            </g>
            <g className="wheel-ring ring-mid">
              {ring(middle, R_MID, t => <ToolIcon t={t} />, t => t, t => t === tool, pick, t => LABEL[t])}
            </g>
            <g className="wheel-ring ring-in">
              {ring(inner, R_IN, t => <ToolIcon t={t} />, t => t, t => t === tool, pick, t => LABEL[t])}
            </g>
          </svg>
        )}
        <button className="wheel-hub" style={open ? { right: c - 28, bottom: c - 28 } : undefined} onPointerDown={e => e.stopPropagation()} aria-label={open ? 'Close tools' : `Tools: ${LABEL[tool]}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width={30} height={30} viewBox="-15 -15 30 30" aria-hidden="true"><ToolIcon t={tool} /></svg>
          <span className="wheel-hub-ring" style={{ borderColor: swatch }} />
        </button>
      </div>
    </>
  )
}
export const toolLabel = (t: WheelTool) => LABEL[t]
