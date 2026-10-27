import { useRef, useState } from 'react'
import App from './App'
import { load } from './notes'
import { hasVault, hasPlainShelf, unlock, createVault, eraseVault } from './vault'
import { setPhotoKey, resealPhotos, clearPhotos } from './photos'

// Nook stays shut until the shelf is decrypted. Locking unmounts the whole app, so nothing readable is left in memory.
export default function Gate() {
  const [open, setOpen] = useState(null) // { db, vault, at }
  if (open) return <App key={open.at} initial={open.db} vault={open.vault} onLock={() => { setPhotoKey(null); setOpen(null) }} />
  return <Lock onOpen={(db, vault) => {
    setPhotoKey(vault.key)
    resealPhotos(null, vault.key).catch(() => {}) // pictures from before the lock get sealed too
    setOpen({ db, vault, at: Date.now() })
  }} />
}

function Lock({ onOpen }) {
  const [setup, setSetup] = useState(() => !hasVault())
  const [pw, setPw] = useState(''), [again, setAgain] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false) // the padlock pops open just before the shelf shows
  const [erase, setErase] = useState(false)
  const existing = setup && hasPlainShelf() // notes from before there was a lock
  const card = useRef(null)
  const fail = msg => { setError(msg); card.current.animate([{ translate: '0' }, { translate: '-8px' }, { translate: '8px' }, { translate: '0' }], 300) }

  const submit = async e => {
    e.preventDefault()
    setError(null)
    if (setup && pw.length < 8) return fail('Use at least 8 characters.')
    if (setup && pw !== again) return fail('Those two don’t match.')
    setBusy(true)
    try {
      const { db, vault } = setup ? { db: load(), vault: null } : await unlock(pw)
      const v = vault ?? await createVault(pw, db)
      setPw('')
      setAgain('')
      setOpening(true)
      setTimeout(() => onOpen(db, v), 420)
    } catch (err) {
      fail(err.message === 'Wrong password' ? 'That’s not it. Try again?' : `Couldn’t open: ${err.message}`)
      setBusy(false)
    }
  }
  const startOver = async () => {
    eraseVault()
    await clearPhotos().catch(() => {})
    setErase(false)
    setSetup(true)
    setError(null)
  }

  return (
    <div className="lock">
      <div className="lock-brand"><img src="/nook.svg" alt="" />Nook</div>
      <div className="lock-card" ref={card}>
        <div className={'lock-book' + (opening ? ' opening' : '')} aria-hidden="true">
          <div className="lock-strap" /><div className="lock-pad">{opening ? '🔓' : '🔒'}</div>
        </div>
        <h1>{setup ? 'Lock your Nook' : 'Welcome back'}</h1>
        <p className="lock-sub">
          {!setup ? 'Your shelf is locked. Enter your password to open it.'
            : existing ? 'Choose a password. Your notes and photos will be encrypted with it on this device.'
            : 'Choose a password. Everything you write and every photo is encrypted with it on this device.'}
        </p>
        <form onSubmit={submit}>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder={setup ? 'New password' : 'Password'}
            autoComplete={setup ? 'new-password' : 'current-password'} autoFocus disabled={busy} aria-label="Password" />
          {setup && <input type="password" value={again} onChange={e => setAgain(e.target.value)} placeholder="Repeat it"
            autoComplete="new-password" disabled={busy} aria-label="Repeat the password" />}
          {error && <div className="lock-error" role="alert">{error}</div>}
          <button className="lock-go" disabled={busy || !pw}>{busy ? (setup ? 'Locking…' : 'Unlocking…') : setup ? 'Lock it up' : 'Unlock'}</button>
        </form>
        {setup ? <p className="lock-note">There’s no “forgot password”: without it, your notes can’t be decrypted. Export a backup now and then.</p>
          : erase ? <div className="lock-erase">
              <p>Erase every book and photo on this device and start fresh? This can’t be undone.</p>
              <button className="danger" onClick={startOver}>Erase everything</button>
              <button onClick={() => setErase(false)}>Keep them</button>
            </div>
          : <button className="lock-forgot" onClick={() => setErase(true)}>Forgot your password?</button>}
      </div>
    </div>
  )
}
