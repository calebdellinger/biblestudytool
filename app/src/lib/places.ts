// Biblical places (OpenBible.info geocoding, CC BY 4.0) and the base map (Natural Earth, public domain).
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { FeatureCollection, MultiLineString } from 'geojson'

export type Place = {
  id: string; name: string; raw: string; type: string; lon: number | null; lat: number | null
  confidence: number; today: string; near: { town: string; km: number } | null; country: string
  alts: string[]; verses: number[]
}
type Row = [string, string, string, number | null, number | null, number, string, [string, number] | null, string, string[], number[]]

let placesP: Promise<Place[]> | null = null
export function loadPlaces(): Promise<Place[]> {
  placesP ??= fetch('/data/map/places.json').then(r => r.json()).then((rows: Row[]) => rows.map(r => ({
    id: r[0], raw: r[1], name: r[1].replace(/\s+\d+$/, ''), type: r[2], lon: r[3], lat: r[4], confidence: r[5],
    today: r[6], near: r[7] ? { town: r[7][0], km: r[7][1] } : null, country: r[8], alts: r[9], verses: r[10],
  })))
  return placesP
}
export async function placesInVerse(v: number) { return (await loadPlaces()).filter(p => p.verses.includes(v)) }
export async function placesInChapter(v: number) {
  const ch = Math.floor(v / 1000)
  return (await loadPlaces()).filter(p => p.verses.some(x => Math.floor(x / 1000) === ch))
}

export const confidenceLabel = (c: number) => (c >= 800 ? 'Confident' : c >= 400 ? 'Likely' : 'Uncertain')
const TYPES: Record<string, string> = {
  settlement: 'Town or city', region: 'Region', mountain: 'Mountain', river: 'River', valley: 'Valley', campsite: 'Campsite',
  gate: 'Gate', island: 'Island', hill: 'Hill', 'body of water': 'Body of water', 'natural area': 'Natural area', structure: 'Structure',
}
export const typeLabel = (t: string) => TYPES[t] ?? t.charAt(0).toUpperCase() + t.slice(1)

/** "Tell Hum, 33 km from Nazareth, Israel" */
export function todayLine(p: Place) {
  // A region's ancient borders don't match any modern one; naming a single modern place would mislead.
  if (p.type === 'region') return p.country ? `Centered in today's ${p.country}; ancient borders differ` : ''
  const parts: string[] = []
  if (p.today && p.today !== p.name) parts.push(p.today)
  const site = ['settlement', 'structure', 'gate', 'campsite', 'hill', 'altar', 'tower', 'spring', 'well', 'pool', 'road'].includes(p.type)
  if (site && p.near?.town && p.near.town !== p.today) parts.push(p.near.km <= 3 ? `in ${p.near.town}` : `${p.near.km} km from ${p.near.town}`)
  if (p.country) parts.push(p.country)
  return parts.join(', ')
}

export type BaseMap = {
  land: FeatureCollection; lakes: FeatureCollection; rivers: FeatureCollection
  borders: MultiLineString; countries: FeatureCollection; cities: FeatureCollection
}
let baseP: Promise<BaseMap> | null = null
export function loadBaseMap(): Promise<BaseMap> {
  const get = (n: string) => fetch(`/data/map/${n}.json`).then(r => r.json() as Promise<Topology>)
  const fc = (t: Topology, k: string) => feature(t, t.objects[k] as GeometryCollection) as unknown as FeatureCollection
  baseP ??= Promise.all(['land', 'lakes', 'rivers', 'countries', 'cities'].map(get)).then(([land, lakes, rivers, countries, cities]) => ({
    land: fc(land, 'land'), lakes: fc(lakes, 'lakes'), rivers: fc(rivers, 'rivers'),
    borders: mesh(countries, countries.objects.countries as GeometryCollection, (a, b) => a !== b) as MultiLineString,
    countries: fc(countries, 'countries'), cities: fc(cities, 'cities'),
  }))
  return baseP
}
