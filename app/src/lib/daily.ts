// Daily reading (M'Cheyne's calendar and/or Spurgeon's Morning and Evening) and reminder times.
import { getState, saveDoc, type Daily, type PlanProgress } from './db'
import { loadSyncSettings } from './db'

export type PlanReading = { label: string; ranges: [number, number][] }
let plan: Promise<PlanReading[][]> | null = null
export function loadPlan() {
  plan ??= fetch('/data/plans/mcheyne.json').then(r => r.json()).then((days: (string | number)[][][]) =>
    days.map(d => d.map(([label, ...n]) => {
      const nums = n as number[]
      const ranges: [number, number][] = []
      for (let i = 0; i < nums.length; i += 2) ranges.push([nums[i], nums[i + 1]])
      return { label: label as string, ranges }
    })))
  return plan
}
/** The calendar has 365 days; 29 February repeats the 28th. */
export function planIndex(d: Date) {
  const start = new Date(d.getFullYear(), 0, 1)
  let n = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86_400_000)
  const leap = new Date(d.getFullYear(), 1, 29).getMonth() === 1
  if (leap && n >= 59) n -= 1
  return Math.min(n, 364)
}
export const mmdd = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const DEFAULT_DAILY: Omit<Daily, '_rev' | 'updatedAt'> = {
  _id: 'settings:daily', type: 'daily', plan: 'mcheyne', spurgeon: true,
  times: { reading: '', evening: '', memory: '' },
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
}
export const getDaily = (): Daily => (getState().daily ?? { ...DEFAULT_DAILY, updatedAt: '' }) as Daily
export function saveDaily(p: Partial<Omit<Daily, 'times'>> & { times?: Partial<Daily['times']> }) {
  const cur = getDaily()
  return saveDoc<Daily>({ ...cur, ...p, times: { ...cur.times, ...p.times }, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
}

export function doneOn(d: Date): number[] {
  return getState().progress[d.getFullYear()]?.done[mmdd(d)] ?? []
}
export function toggleDone(d: Date, i: number) {
  const y = d.getFullYear()
  const cur: PlanProgress = getState().progress[y] ?? { _id: `plan:${y}`, type: 'planprog', year: y, done: {}, updatedAt: '' }
  const k = mmdd(d), list = cur.done[k] ?? []
  const next = list.includes(i) ? list.filter(x => x !== i) : [...list, i].sort()
  return saveDoc<PlanProgress>({ ...cur, done: { ...cur.done, [k]: next } })
}

/* ---------- push notifications ---------- */
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  if (!('PushManager' in window)) return isIOS() && !standalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}
function authHeader(): Record<string, string> {
  const s = loadSyncSettings()
  return s.user ? { Authorization: 'Basic ' + btoa(`${s.user}:${s.password}`) } : {}
}
async function api(path: string, body?: unknown) {
  const r = await fetch(`/api/push/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.reason ?? `The PC answered ${r.status}`)
  return j
}
const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0))

/** Ask permission (must run from a tap), subscribe this device, and register it with the PC. */
export async function enablePush(): Promise<void> {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Turn them on in Settings › Notifications › YHWH.' : 'Permission was not given.')
  const { key } = await api('key')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) })
  await api('subscribe', { sub: sub.toJSON(), device: deviceName() })
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api('unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe()
}
export async function testPush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) throw new Error('This device is not subscribed.')
  // Re-register first, in case the PC lost it.
  await api('subscribe', { sub: sub.toJSON(), device: deviceName() })
  await api('test', { endpoint: sub.endpoint })
}
function deviceName() {
  const ua = navigator.userAgent
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || isIOS() ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Browser'
}
