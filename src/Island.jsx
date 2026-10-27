import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ask } from './ask'

// A question asked through ask(): the island grows into a little card for it.
function Question({ q, answer }) {
  const typed = q.input !== undefined, cancel = q.cancel === undefined ? 'Cancel' : q.cancel
  const [val, setVal] = useState(q.input ?? '')
  const okRef = useRef(null), noRef = useRef(null), inRef = useRef(null)
  useLayoutEffect(() => { // where Enter goes: the text box, or for destructive questions the safe button
    if (typed) inRef.current.select()
    else (q.danger && noRef.current ? noRef.current : okRef.current).focus()
  }, [q])
  return (
    <form className="isl-ask" onSubmit={e => { e.preventDefault(); answer(typed ? val : true) }}>
      <div className="isl-ask-title">{q.title}</div>
      {q.body && <p>{q.body}</p>}
      {typed && <input ref={inRef} value={val} onChange={e => setVal(e.target.value)}
        type={q.secret ? 'password' : 'text'} autoComplete={q.secret ? 'new-password' : 'off'} />}
      <div className="isl-ask-row">
        {cancel !== null && <button ref={noRef} type="button" className="isl-btn" onClick={() => answer(typed ? null : false)}>{cancel}</button>}
        <button ref={okRef} type="submit" className={'isl-btn ' + (q.danger ? 'danger' : 'on')}>{q.ok ?? 'OK'}</button>
      </div>
    </form>
  )
}

const POMO_KEY = 'mynotes.pomo'
const DEFAULT_MINS = { work: 25, short: 5, long: 15 }
const MODES = [['work', 'Focus'], ['short', 'Short break'], ['long', 'Long break']]

const fmt = ms => {
  const s = Math.ceil(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const loadMins = () => {
  try { return { ...DEFAULT_MINS, ...JSON.parse(localStorage.getItem(POMO_KEY)) } } catch { return DEFAULT_MINS }
}

function beep(audio) {
  if (!audio) return
  for (const t of [0, 0.35, 0.7]) {
    const o = audio.createOscillator(), g = audio.createGain(), at = audio.currentTime + t
    o.frequency.value = 880
    g.gain.setValueAtTime(0.2, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.3)
    o.connect(g).connect(audio.destination)
    o.start(at)
    o.stop(at + 0.3)
  }
}

export default function Island({ pages, title, openPage, newPage }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('focus')
  const [query, setQuery] = useState('')
  const [mins, setMins] = useState(loadMins)
  const [mode, setMode] = useState('work')
  const [left, setLeft] = useState(null) // ms left while paused; null = full length
  const [endAt, setEndAt] = useState(0) // timestamp, so it stays accurate in background tabs
  const [done, setDone] = useState(0)
  const [now, setNow] = useState(Date.now)
  const ref = useRef(null), audio = useRef(null), jumpRef = useRef(null)
  const questions = useRef([]) // asked and waiting; the first is on show
  const [asked, setAsked] = useState(null)
  const [note, setNote] = useState(null) // toast on show

  const running = !!endAt

  useEffect(() => {
    const onAsk = e => { questions.current.push({ ...e.detail, id: Math.random() }); setAsked(questions.current[0]) }
    const onToast = e => setNote({ ...e.detail, at: Date.now() })
    addEventListener('nook:ask', onAsk)
    addEventListener('nook:toast', onToast)
    return () => { removeEventListener('nook:ask', onAsk); removeEventListener('nook:toast', onToast) }
  }, [])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 2400)
    return () => clearTimeout(t)
  }, [note])
  const answer = v => {
    questions.current.shift().resolve(v)
    setAsked(questions.current[0] ?? null)
  }
  const qRef = useRef(null)
  qRef.current = asked && answer // for the key handler below
  const remaining = running ? Math.max(0, endAt - now) : left ?? mins[mode] * 6e4

  const switchMode = m => { setMode(m); setEndAt(0); setLeft(null) }

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [])
  // one-shot timeout: background tabs throttle the interval, this still fires on time
  useEffect(() => {
    if (!endAt) return
    const t = setTimeout(() => setNow(Date.now()), endAt - Date.now() + 50)
    return () => clearTimeout(t)
  }, [endAt])

  useEffect(() => {
    if (!running || remaining > 0) return
    const d = mode === 'work' ? done + 1 : done
    setDone(d)
    beep(audio.current)
    try {
      if (Notification.permission === 'granted') new Notification(mode === 'work' ? 'Focus session done, take a break ☕' : 'Break over, back to it 💪')
    } catch { /* notifications unavailable */ }
    switchMode(mode === 'work' ? (d % 4 ? 'short' : 'long') : 'work')
    setOpen(true)
    setTab('focus')
  }, [running, remaining]) // only react to the countdown hitting zero

  useEffect(() => { document.title = (running ? `${fmt(remaining)} · ` : '') + `${title} · Nook` })

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape' && qRef.current) { e.preventDefault(); qRef.current(questions.current[0].input !== undefined ? null : false) }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); setTab('jump'); setQuery('') }
      else if (e.key === 'Escape') setOpen(false)
    }
    const onDown = e => { if (!ref.current.contains(e.target) && !qRef.current) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])
  useEffect(() => { if (open && tab === 'jump') jumpRef.current.focus() }, [open, tab])

  const toggle = () => {
    audio.current ??= new AudioContext() // created on a click so the browser lets it play later
    if (running) { setLeft(endAt - Date.now()); setEndAt(0); return }
    setEndAt(Date.now() + remaining)
    setNow(Date.now())
    try { if (Notification.permission === 'default') Notification.requestPermission() } catch { /* unavailable */ }
  }
  const reset = async () => {
    if (running && !await ask({ title: 'Reset the timer?', body: `${fmt(remaining)} is still left on this session.`, ok: 'Reset', danger: true })) return
    switchMode(mode)
  }
  const editMinutes = async () => {
    if (running) return
    const label = MODES.find(([m]) => m === mode)[1].toLowerCase()
    const v = parseFloat(await ask({ title: `Minutes for ${label}`, input: String(mins[mode]), ok: 'Save' }))
    if (!(v > 0)) return
    const next = { ...mins, [mode]: v }
    setMins(next)
    setLeft(null)
    try { localStorage.setItem(POMO_KEY, JSON.stringify(next)) } catch { /* not critical */ }
  }

  const q = query.trim(), ql = q.toLowerCase()
  const text = p => [p.title, ...p.blocks.map(b => b.html), ...(p.cards ?? []).flatMap(c => [c.title, c.html, ...(c.blocks ?? []).map(b => b.html)])]
    .join(' ').replace(/<[^>]+>/g, '')
  const hits = pages.filter(p => text(p).toLowerCase().includes(ql))
  const rows = hits.map(p => [p.id, `${p.icon}  ${p.title || 'Untitled'}  · ${p.book}`, () => openPage(p.id)])
  if (q && !hits.some(p => p.title.toLowerCase() === ql)) rows.push(['new', `＋ Create “${q}”`, () => newPage(q)])
  const go = run => { setOpen(false); run() }

  return <>
    {/* while a question is up, the rest of the app waits behind a scrim; clicking it = cancel */}
    {asked && <div className="island-scrim" onMouseDown={() => answer(asked.input !== undefined ? null : false)} />}
    <div id="island" ref={ref} data-mode={mode}
      className={[open && !asked && 'open', running && 'running', asked && 'asking', note && !asked && !open && 'toasting'].filter(Boolean).join(' ')}>
      {asked ? <Question key={asked.id} q={asked} answer={answer} /> : <>
      <div className="pill" onClick={() => setOpen(o => !o)} role="status">
        {note && !open
          ? <span className="isl-toast" key={note.at}><span className="isl-toast-ic">{note.icon}</span>{note.text}</span>
          : <>
            <span>{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            {running && <><span className="dot" /><span>{fmt(remaining)}</span></>}
          </>}
      </div>
      <div className="panel">
        <div className="tabs">
          {[['focus', '⏱ Focus'], ['jump', '🔍 Jump']].map(([t, label]) => (
            <button key={t} className={'isl-btn' + (tab === t ? ' on' : '')} onClick={() => { setTab(t); setQuery('') }}>{label}</button>
          ))}
        </div>
        {tab === 'focus' ? <>
          <div className="row">
            {MODES.map(([m, label]) => (
              <button key={m} className={'isl-btn' + (mode === m ? ' on' : '')} onClick={() => switchMode(m)}>{label}</button>
            ))}
          </div>
          <div className="pomo-time" title="Click to change minutes" onClick={editMinutes}>{fmt(remaining)}</div>
          <div className="row">
            <button className="isl-btn" onClick={toggle}>{running ? 'Pause' : left != null ? 'Resume' : 'Start'}</button>
            <button className="isl-btn" onClick={reset}>Reset</button>
          </div>
          <div className="pomo-count">🍅 {done} focus session{done === 1 ? '' : 's'} done</div>
        </> : <>
          <input ref={jumpRef} className="jump-q" placeholder="Search pages…" autoComplete="off" value={query}
            onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && rows[0] && go(rows[0][2])} />
          <div className="jump-list">
            {rows.map(([k, label, run]) => <div key={k} onClick={() => go(run)}>{label}</div>)}
          </div>
        </>}
      </div>
      </>}
    </div>
  </>
}
