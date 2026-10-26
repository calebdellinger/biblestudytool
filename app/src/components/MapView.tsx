// A quiet, hand-styled map of the biblical world, with a Then/Now slider that fades in today's borders and cities.
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoConicConformal, geoPath } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { loadBaseMap, type Place } from '../lib/places'
import { useAsync } from '../lib/hooks'
import { IconPlus } from './Icons'

type Props = {
  highlight: Place[]           // places to show and label
  dim?: Place[]                // other places, shown faintly
  focus?: string | null        // the place to emphasise
  onPick?: (id: string) => void
  height: number
  now: number; setNow: (n: number) => void
}

const NOW_KEY = 'margin.mapNow'
export function useNow(): [number, (n: number) => void] {
  const [n, setN] = useState(() => { try { return Number(localStorage.getItem(NOW_KEY) ?? 0) } catch { return 0 } })
  return [n, (v: number) => { setN(v); try { localStorage.setItem(NOW_KEY, String(v)) } catch { /* ignore */ } }]
}

export function MapView({ highlight, dim = [], focus, onPick, height, now, setNow }: Props) {
  const base = useAsync(loadBaseMap, [])
  const wrap = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [w, setW] = useState(600)
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)
  const zb = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const located = highlight.filter(p => p.lon != null && p.lat != null)
  const key = located.map(p => p.id).join(',')
  const projection = useMemo(() => {
    const pts = located.map(p => [p.lon!, p.lat!] as [number, number])
    let [x0, y0, x1, y1] = pts.length
      ? [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]
      : [28, 27, 46, 38]
    // Always show enough of the surrounding land and sea to orient yourself.
    const minLon = 4.5, minLat = 3.2
    if (x1 - x0 < minLon) { const c = (x0 + x1) / 2; x0 = c - minLon / 2; x1 = c + minLon / 2 }
    if (y1 - y0 < minLat) { const c = (y0 + y1) / 2; y0 = c - minLat / 2; y1 = c + minLat / 2 }
    const padX = (x1 - x0) * 0.18, padY = (y1 - y0) * 0.18
    const box = { type: 'MultiPoint' as const, coordinates: [[x0 - padX, y0 - padY], [x1 + padX, y1 + padY]] }
    return geoConicConformal().parallels([30, 40]).rotate([-35, 0]).fitExtent([[16, 16], [w - 16, height - 56]], box)
  }, [key, w, height]) // eslint-disable-line react-hooks/exhaustive-deps

  const path = useMemo(() => geoPath(projection), [projection])
  const paths = useMemo(() => base && ({
    land: path(base.land) ?? '', lakes: path(base.lakes) ?? '', rivers: path(base.rivers) ?? '', borders: path(base.borders) ?? '',
  }), [base, path])

  // Pan and zoom; reset whenever the set of places or the size changes.
  useEffect(() => {
    if (!svg.current) return
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([0.4, 40]).on('zoom', e => setT(e.transform))
    zb.current = z
    const s = select(svg.current)
    s.call(z).on('dblclick.zoom', null)
    s.call(z.transform, zoomIdentity)
    return () => { s.on('.zoom', null) }
  }, [projection])

  const zoomBy = (k: number) => { if (svg.current && zb.current) select(svg.current).call(zb.current.scaleBy, k) }
  const reset = () => { if (svg.current && zb.current) select(svg.current).call(zb.current.transform, zoomIdentity) }
  const at = (lon: number, lat: number) => { const p = projection([lon, lat]); return p ? t.apply(p) : null }
  const inView = (x: number, y: number) => x > -40 && x < w + 40 && y > -20 && y < height + 20

  // Place labels without overlaps: focus first, then towns by confidence, then regions. A label that can't fit is
  // left off (its dot keeps a tooltip, and zooming in makes room).
  type Box = [number, number, number, number]
  const boxes: Box[] = []
  const hits = (b: Box) => boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])
  const order = [...located].sort((a, b) =>
    (b.id === focus ? 1 : 0) - (a.id === focus ? 1 : 0) || (a.type === 'region' ? 1 : 0) - (b.type === 'region' ? 1 : 0) || b.confidence - a.confidence)
  for (const p of located) if (p.type !== 'region') { const q = at(p.lon!, p.lat!); if (q) boxes.push([q[0] - 5, q[1] - 5, q[0] + 5, q[1] + 5]) }
  const labels = order.map(p => {
    const q = at(p.lon!, p.lat!)!
    const region = p.type === 'region'
    const tw = p.name.length * (region ? 8.4 : 7.6) + 4, th = region ? 16 : 17
    const withToday = !region && now > 0.4 && p.today && p.today !== p.name ? 14 : 0
    const tries: [number, number, 'start' | 'end' | 'middle'][] = region
      ? [[q[0], q[1] + 5, 'middle'], [q[0], q[1] - 12, 'middle'], [q[0], q[1] + 22, 'middle']]
      : [[q[0] + 10, q[1] + 5, 'start'], [q[0] - 10, q[1] + 5, 'end'], [q[0] + 8, q[1] - 7, 'start'], [q[0] + 8, q[1] + 18, 'start'], [q[0], q[1] - 11, 'middle'], [q[0], q[1] + 21, 'middle']]
    for (const [lx, ly, anchor] of tries) {
      const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - tw : lx - tw / 2
      const box: Box = [x0, ly - th + 4, x0 + tw, ly + 4 + withToday]
      if (!hits(box)) { boxes.push(box); if (!region) boxes.push([q[0] - 6, q[1] - 6, q[0] + 6, q[1] + 6]); return { p, q, lx, ly, anchor, show: true } }
    }
    if (!region) boxes.push([q[0] - 6, q[1] - 6, q[0] + 6, q[1] + 6])
    return { p, q, lx: q[0], ly: q[1], anchor: 'start' as const, show: false }
  })

  const cityLimit = 2 + Math.log2(Math.max(1, t.k * projection.scale() / 2500)) * 1.6
  return (
    <div className="map" ref={wrap} style={{ height }}>
      <svg ref={svg} width={w} height={height} role="img" aria-label="Map of the places in this passage">
        <rect className="map-sea" width={w} height={height} />
        {paths && (
          <g transform={t.toString()}>
            <path className="map-land" d={paths.land} />
            <path className="map-lake" d={paths.lakes} />
            <path className="map-river" d={paths.rivers} />
            <path className="map-border" d={paths.borders} style={{ opacity: now }} />
          </g>
        )}
        {base && now > 0.02 && (
          <g className="map-modern" style={{ opacity: now }} aria-hidden="true">
            {base.countries.features.map((f, i) => {
              const pr = f.properties as { name: string; lx: number; ly: number; rank: number }
              const p = at(pr.lx, pr.ly)
              if (!p || !inView(p[0], p[1]) || pr.rank > 3 + Math.floor(Math.log2(Math.max(1, t.k))) || / Base Area|Sovereign/.test(pr.name)) return null
              const cw = pr.name.length * 7.2; if (hits([p[0] - cw / 2, p[1] - 12, p[0] + cw / 2, p[1] + 4])) return null
              return <text key={i} x={p[0]} y={p[1]} className="map-country">{pr.name}</text>
            })}
            {base.cities.features.map((f, i) => {
              const pr = f.properties as { name: string; scalerank: number }
              const [lon, lat] = (f.geometry as unknown as { coordinates: [number, number] }).coordinates
              const p = at(lon, lat)
              if (!p || !inView(p[0], p[1]) || pr.scalerank > cityLimit) return null
              if (hits([p[0] - 3, p[1] - 10, p[0] + 8 + pr.name.length * 6.2, p[1] + 5])) return null
              return <g key={i}><rect x={p[0] - 2} y={p[1] - 2} width={4} height={4} className="map-city-dot" /><text x={p[0] + 6} y={p[1] + 4} className="map-city">{pr.name}</text></g>
            })}
          </g>
        )}
        <g>
          {dim.filter(p => p.lon != null && !located.some(h => h.id === p.id)).map(p => {
            const q = at(p.lon!, p.lat!)
            if (!q || !inView(q[0], q[1])) return null
            return <circle key={p.id} cx={q[0]} cy={q[1]} r={p.type === 'region' ? 0 : 2} className="map-dim" onClick={() => onPick?.(p.id)}><title>{p.name}</title></circle>
          })}
          {labels.map(({ p, q, lx, ly, anchor, show }) => {
            const on = focus === p.id
            const region = p.type === 'region'
            return (
              <g key={p.id} className={`map-place ${on ? 'is-focus' : ''} ${p.confidence < 400 ? 'is-uncertain' : ''} ${region ? 'is-region' : ''}`}
                onClick={() => onPick?.(p.id)} style={{ cursor: onPick ? 'pointer' : undefined }}>
                {!region && <circle cx={q[0]} cy={q[1]} r={on ? 7 : 5} />}
                {region && <circle cx={q[0]} cy={q[1]} r={14} className="map-hit" />}
                {show && <text x={lx} y={ly} textAnchor={anchor} className={region ? 'map-region' : 'map-label'}>{p.name}</text>}
                {show && !region && now > 0.4 && p.today && p.today !== p.name && (
                  <text x={lx} y={ly + 14} textAnchor={anchor} className="map-today" style={{ opacity: Math.min(1, (now - 0.4) / 0.4) }}>{p.today}</text>
                )}
                {!show && <title>{p.name}</title>}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="map-zoom">
        <button onClick={() => zoomBy(1.6)} aria-label="Zoom in"><IconPlus size={16} /></button>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out"><span aria-hidden="true">−</span></button>
        <button onClick={reset} aria-label="Fit the places" className="fit">Fit</button>
      </div>
      <label className="map-now">
        <span>Then</span>
        <input type="range" min={0} max={1} step={0.01} value={now} onChange={e => setNow(Number(e.target.value))} aria-label="Fade in today's borders and cities" />
        <span>Now</span>
      </label>
      <p className="map-credit">Places: OpenBible.info (CC BY). Map: Natural Earth.</p>
    </div>
  )
}
