// Today: the day's Bible reading, Spurgeon's Morning or Evening, and what's due in Memory.
import { useEffect, useMemo, useState } from 'react'
import { splitVid } from '../lib/bible'
import { go, useAsync, useStore } from '../lib/hooks'
import { dateKey, loadReadings } from '../lib/spurgeon'
import { doneOn, getDaily, loadPlan, planIndex, saveDaily, toggleDone, enablePush, disablePush, testPush, pushState, type PushState } from '../lib/daily'
import { dueQueue, passageById } from '../lib/memory'
import { formatRef } from '../lib/bible'
import { ReadingCard } from './Spurgeon'
import { FromYourNotes } from './Resurface'
import { IconCheck, IconLeft, IconRight } from './Icons'

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

export function TodayPage() {
  const store = useStore()
  const daily = getDaily()
  const [day, setDay] = useState(() => new Date())
  const [period, setPeriod] = useState<'morning' | 'evening'>(() => (new Date().getHours() < 15 ? 'morning' : 'evening'))
  const plan = useAsync(loadPlan, [])
  const readings = useAsync(loadReadings, [])
  const todays = plan?.[planIndex(day)] ?? []
  const done = useMemo(() => doneOn(day), [day, store.progress]) // eslint-disable-line react-hooks/exhaustive-deps
  const due = useMemo(() => dueQueue().map(k => {
    if (k.startsWith('run:')) { const p = passageById(k.slice(4)); return p ? `${formatRef(p.s, p.e, true)} (all)` : '' }
    const m = store.mems.find(x => x._id === k); return m ? formatRef(m.s, m.e, true) : ''
  }).filter(Boolean), [store.mems, store.passages]) // eslint-disable-line react-hooks/exhaustive-deps
  const anyMem = store.mems.some(m => !m.deleted) || store.passages.some(p => !p.deleted)
  const sp = readings?.find(r => r.date === dateKey(day) && r.period === period)
  const isToday = sameDay(day, new Date())
  const shift = (n: number) => setDay(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))

  return (
    <main className="page today">
      <header className="page-head today-head">
        <div>
          <h1>{isToday ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'long' })}</h1>
          <p>{day.toLocaleDateString(undefined, { weekday: isToday ? 'long' : undefined, month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="day-nav">
          <button className="text-btn small print-btn" onClick={() => go({ page: 'paper', date: isoDay(day), edition: 'full' })} title="Print today as a newspaper">Print</button>
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous day"><IconLeft /></button>
          {!isToday && <button className="text-btn small" onClick={() => setDay(new Date())}>Today</button>}
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Next day"><IconRight /></button>
        </div>
      </header>

      {anyMem || due.length ? (
        <section className="today-mem">
          <div>
            <h2>Memory</h2>
            <p>{due.length ? `${due.length} ${due.length === 1 ? 'thing' : 'things'} to practise: ${due.slice(0, 3).join(', ')}${due.length > 3 ? '…' : ''}` : 'All caught up.'}</p>
          </div>
          <span className="today-mem-actions">
            <a className="text-btn" href="#/memory">{due.length ? 'All passages' : 'Open Memory'}</a>
            {due.length > 0 && <button className="primary-btn" onClick={() => go({ page: 'practice' })}>Practise</button>}
          </span>
        </section>
      ) : (
        <section className="today-mem is-empty">
          <div><h2>Memory</h2><p>Pick a few verses for the week, or a whole passage to learn a little at a time.</p></div>
          <a className="text-btn" href="#/memory">Start</a>
        </section>
      )}

      {daily.plan === 'mcheyne' && (
        <section className="today-plan">
          <div className="today-sec-head">
            <h2>Bible reading</h2>
            <span className="muted">M'Cheyne · {done.length} of {todays.length || 4}</span>
          </div>
          <ol className="plan-list">
            {todays.map((r, i) => {
              const [s] = r.ranges[0]; const { b, c, v } = splitVid(s)
              const on = done.includes(i)
              return (
                <li key={i} className={on ? 'is-done' : ''}>
                  <button className="plan-check" aria-pressed={on} aria-label={on ? `Mark ${r.label} unread` : `Mark ${r.label} read`} onClick={() => toggleDone(day, i)}>
                    {on && <IconCheck size={14} />}
                  </button>
                  <a className="plan-ref" href={`#/read/${b}/${c}${v > 1 ? `/${v}` : ''}`}>{r.label}</a>
                  <span className="plan-kind">{i < 2 ? 'Family' : 'Secret'}</span>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <FromYourNotes day={day} todays={todays} />

      {daily.spurgeon && (
        <section className="sp-today today-sp">
          <div className="sp-today-head">
            <h2>Morning and Evening</h2>
            <div className="seg small">
              <button className={period === 'morning' ? 'is-on' : ''} onClick={() => setPeriod('morning')}>Morning</button>
              <button className={period === 'evening' ? 'is-on' : ''} onClick={() => setPeriod('evening')}>Evening</button>
            </div>
          </div>
          {sp ? <ReadingCard key={`${sp.date}-${sp.period}`} r={sp} collapsed /> : <div className="loading-lines"><span /><span /><span /></div>}
        </section>
      )}

      {daily.plan === 'none' && !daily.spurgeon && (
        <p className="hint">No daily reading is turned on. Choose one in <a className="text-btn" href="#/settings">Settings</a>.</p>
      )}
      <a className="today-reading-link" href="#/reading">Where your reading time has gone<IconRight size={16} /></a>
    </main>
  )
}

/* ---------- Settings: daily reading and notifications ---------- */
export function DailySettings() {
  useStore()
  const d = getDaily()
  const [push, setPush] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { pushState().then(setPush) }, [])
  async function run(f: () => Promise<void>, ok: string) {
    setBusy(true); setMsg('')
    try { await f(); setMsg(ok) } catch (e) { setMsg((e as Error).message) }
    setPush(await pushState()); setBusy(false)
  }
  const time = (k: keyof typeof d.times, label: string, hint: string, show = true) => show && (
    <label className="time-row">
      <span><b>{label}</b><small>{hint}</small></span>
      <span className="time-ctl">
        <input type="time" value={d.times[k]} onChange={e => saveDaily({ times: { [k]: e.target.value } })} aria-label={`${label} time`} />
        {d.times[k] && <button className="text-btn small muted-btn" onClick={e => { e.preventDefault(); saveDaily({ times: { [k]: '' } }) }}>Off</button>}
      </span>
    </label>
  )
  return (
    <>
      <section className="setting-group">
        <h2>Daily reading</h2>
        <div className="setting">
          <span className="label">Bible reading plan</span>
          <div className="seg">
            <button className={d.plan === 'mcheyne' ? 'is-on' : ''} onClick={() => saveDaily({ plan: 'mcheyne' })}>M'Cheyne</button>
            <button className={d.plan === 'none' ? 'is-on' : ''} onClick={() => saveDaily({ plan: 'none' })}>None</button>
          </div>
        </div>
        <div className="setting">
          <span className="label">Spurgeon's Morning and Evening</span>
          <div className="seg">
            <button className={d.spurgeon ? 'is-on' : ''} onClick={() => saveDaily({ spurgeon: true })}>On</button>
            <button className={!d.spurgeon ? 'is-on' : ''} onClick={() => saveDaily({ spurgeon: false })}>Off</button>
          </div>
        </div>
        <p className="hint small">M'Cheyne's calendar is four chapters a day: the Old Testament once and the New Testament and Psalms twice in a year. It follows the date, so a missed day doesn't pile up. If four is too many, read the first two (Family) and leave the others.</p>
      </section>

      <section className="setting-group">
        <h2>Notifications</h2>
        {push === 'needs-install' && (
          <p className="hint">On iPhone, notifications only work from the Home Screen app. In Safari tap Share, then <b>Add to Home Screen</b>, open YHWH from there and come back to this page.</p>
        )}
        {push === 'unsupported' && <p className="hint">This browser can't receive notifications.</p>}
        {push === 'denied' && <p className="hint">Notifications are blocked for this app. On iPhone: Settings › Notifications › YHWH.</p>}
        {(push === 'off' || push === 'on') && (
          <div className="push-row">
            <span>{push === 'on' ? 'On for this device' : 'Off on this device'}</span>
            <span className="push-actions">
              {push === 'on' && <button className="text-btn" disabled={busy} onClick={() => run(testPush, 'Sent. It should arrive in a few seconds.')}>Send a test</button>}
              {push === 'on'
                ? <button className="text-btn muted-btn" disabled={busy} onClick={() => run(disablePush, '')}>Turn off</button>
                : <button className="primary-btn" disabled={busy} onClick={() => run(enablePush, 'Done. Choose times below.')}>Turn on</button>}
            </span>
          </div>
        )}
        {msg && <p className="hint small">{msg}</p>}
        <div className="time-list">
          {time('reading', 'Daily reading', d.spurgeon ? "Today's chapters and Spurgeon's Morning" : "Today's chapters", d.plan !== 'none' || d.spurgeon)}
          {time('evening', 'Evening', "Spurgeon's Evening reading", d.spurgeon)}
          {time('memory', 'Memory', 'Only when something is due')}
        </div>
        <p className="hint small">Your PC sends these, so they only arrive while it's on and connected. If it was asleep, a reminder up to three hours late is still sent when it wakes; after that it's skipped.</p>
      </section>
    </>
  )
}
