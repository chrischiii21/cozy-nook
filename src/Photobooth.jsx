import { useEffect, useRef, useState } from 'react'

const FILTERS = [
  ['Natural', 'none'], ['B&W', 'grayscale(1) contrast(1.15)'], ['Warm', 'sepia(.3) saturate(1.35) contrast(1.05)'],
  ['Retro', 'sepia(.55) contrast(1.15) brightness(.96) saturate(.85)'], ['Cool', 'saturate(1.1) hue-rotate(-10deg) brightness(1.05)'],
]
const W = 640, H = 480, M = 28 // one frame; strip margin
const wait = ms => new Promise(r => setTimeout(r, ms))

// The photo booth: live camera, pick a filter, then one shot or a classic strip of four with a countdown and
// a flash. Hands back { blob, ratio, strip } for a photo card.
export default function Photobooth({ onDone, onClose }) {
  const video = useRef(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState(0)
  const [strip, setStrip] = useState(true)
  const [count, setCount] = useState(0) // countdown on screen
  const [flash, setFlash] = useState(0) // bumped per shot to replay the flash
  const [busy, setBusy] = useState(false)
  const [shot, setShot] = useState(null) // { blob, url, ratio, strip }

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setError('This browser can’t use a camera here.'); return }
    let stream, live = true
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then(s => {
        stream = s
        if (live) video.current.srcObject = s
        else s.getTracks().forEach(t => t.stop())
      })
      .catch(e => setError(e.name === 'NotAllowedError' ? 'Nook needs your permission to use the camera. Allow it in the address bar, then open the booth again.' : 'No camera found.'))
    const onKey = e => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => { live = false; stream?.getTracks().forEach(t => t.stop()); removeEventListener('keydown', onKey) }
  }, [])

  // one frame of the camera: 4:3, center-cropped, mirrored like the preview, with the filter baked in
  const frame = () => {
    const v = video.current, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = c.getContext('2d')
    const k = Math.max(W / v.videoWidth, H / v.videoHeight)
    x.filter = FILTERS[filter][1]
    x.translate(W, 0)
    x.scale(-1, 1)
    x.drawImage(v, (W - v.videoWidth * k) / 2, (H - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k)
    return c
  }

  const take = async () => {
    if (!video.current.videoWidth) return // camera not ready yet
    setBusy(true)
    const frames = []
    for (let i = 0; i < (strip ? 4 : 1); i++) {
      for (let n = 3; n > 0; n--) { setCount(n); await wait(i ? 450 : 750) } // quicker between strip shots
      setCount(0)
      setFlash(f => f + 1)
      frames.push(frame())
      await wait(300)
    }
    const c = document.createElement('canvas'), x = c.getContext('2d')
    if (strip) { // paper strip: four frames and a little handwritten date at the bottom
      Object.assign(c, { width: W + 2 * M, height: M + 4 * (H + M) + 64 })
      x.fillStyle = '#fffdf7'
      x.fillRect(0, 0, c.width, c.height)
      frames.forEach((f, i) => x.drawImage(f, M, M + i * (H + M)))
      x.fillStyle = '#3b3a36'
      x.font = '600 44px Caveat, "Segoe Print", cursive'
      x.textAlign = 'center'
      x.fillText(`nook ✿ ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`, c.width / 2, c.height - 36)
    } else {
      Object.assign(c, { width: W, height: H })
      x.drawImage(frames[0], 0, 0)
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9))
    setShot({ blob, url: URL.createObjectURL(blob), ratio: c.height / c.width, strip })
    setBusy(false)
  }

  return (
    <div className="booth-scrim" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="booth" role="dialog" aria-label="Photo booth">
        <div className="booth-curtain" />
        <button className="booth-x" onClick={onClose} aria-label="Close photo booth" disabled={busy}>×</button>
        <h2>Photo booth</h2>
        {error && <div className="booth-error"><p>{error}</p><button className="chunky" onClick={onClose}>OK</button></div>}
        {/* the camera stays on while you look at a shot, so Retake is instant */}
        <div className="booth-view" hidden={!!error || !!shot}>
          <video ref={video} autoPlay playsInline muted style={{ filter: FILTERS[filter][1] }} />
          {count > 0 && <div className="booth-count" key={count}>{count}</div>}
          {flash > 0 && <div className="booth-flash" key={'f' + flash} />}
        </div>
        {shot ? <>
          <div className="booth-result"><img src={shot.url} alt="Your photo" className={shot.strip ? 'strip' : ''} /></div>
          <div className="booth-row">
            <button className="chunky" onClick={() => setShot(null)}>Retake</button>
            <button className="chunky booth-go" onClick={() => onDone(shot)}>Stick it in ✓</button>
          </div>
        </> : !error && <>
          <div className="booth-row">
            {FILTERS.map(([name], i) => (
              <button key={name} className={'booth-chip' + (i === filter ? ' on' : '')} onClick={() => setFilter(i)} disabled={busy}>{name}</button>
            ))}
          </div>
          <div className="booth-row">
            <div className="booth-mode">
              <button className={strip ? '' : 'on'} onClick={() => setStrip(false)} disabled={busy}>Single</button>
              <button className={strip ? 'on' : ''} onClick={() => setStrip(true)} disabled={busy}>Strip ×4</button>
            </div>
            <button className="booth-shutter" onClick={take} disabled={busy} aria-label="Take photo" title="Take photo" />
          </div>
        </>}
      </div>
    </div>
  )
}
