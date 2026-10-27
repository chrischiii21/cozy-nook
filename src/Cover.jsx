import { useEffect, useLayoutEffect, useRef } from 'react'
import { ask } from './ask'
import { COVER_COLORS, PATTERNS, STICKERS } from './notes'

// one-line plain-text field; text only pushed in when it differs, so typing keeps the caret
export function Field({ value, onText, className, ph, autoFocus }) {
  const ref = useRef(null)
  useLayoutEffect(() => { if (ref.current.textContent !== value) ref.current.textContent = value }, [value])
  useEffect(() => { if (autoFocus) ref.current.focus() }, [])
  return <div ref={ref} className={className} data-ph={ph} contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
    onInput={e => { const el = e.currentTarget; if (!el.textContent) el.innerHTML = ''; onText(el.textContent) }}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
}

const setCover = (onChange, props) => onChange(b => ({ ...b, cover: { ...b.cover, ...props } }))
async function ownSticker(book, onChange) {
  const v = (await ask({ title: 'Cover sticker', body: 'Any emoji or a few characters.', input: book.cover.sticker, ok: 'Stick it' }))?.trim()
  if (v) setCover(onChange, { sticker: [...v].slice(0, 4).join('') })
}

// the closed book, sitting in the right-hand slot of the spread
export function CoverFace({ book, onChange }) {
  const c = book.cover, n = book.pages.length
  return (
    <div className={`cover pat-${c.pattern}`} style={{ '--cover': c.color }}>
      {c.band && <div className="band" />}
      <button className="cover-sticker" title="Change sticker" onClick={() => ownSticker(book, onChange)}>{c.sticker}</button>
      <div className="label">
        <Field className="cover-title" value={book.title} ph="Name your book" autoFocus={!book.title}
          onText={title => onChange(b => ({ ...b, title }))} />
        <Field className="cover-sub" value={c.subtitle} ph="a little subtitle…" onText={subtitle => setCover(onChange, { subtitle })} />
      </div>
      <div className="cover-foot">{n} page{n === 1 ? '' : 's'} · Nook</div>
    </div>
  )
}

// left-hand slot while the book is closed: where the cover will land when it opens
export function CoverTools({ book, onChange, onOpen }) {
  const c = book.cover, set = props => setCover(onChange, props), on = yes => yes ? ' on' : ''
  return (
    <div className="tools-slot">
      <div className="cover-tools">
        <h2>Design your cover</h2>
        <div className="tool-label">Color</div>
        <div className="swatches">
          {COVER_COLORS.map(col => <button key={col} className={'swatch-btn' + on(c.color === col)} style={{ background: col }}
            aria-label={`Cover color ${col}`} onClick={() => set({ color: col })} />)}
        </div>
        <div className="tool-label">Pattern</div>
        <div className="swatches">
          {PATTERNS.map(p => <button key={p} className={`swatch-btn pat pat-${p}` + on(c.pattern === p)} style={{ '--cover': c.color }}
            title={p} aria-label={`${p} pattern`} onClick={() => set({ pattern: p })} />)}
        </div>
        <div className="tool-label">Sticker</div>
        <div className="swatches">
          {STICKERS.map(s => <button key={s} className={'swatch-btn sticker-btn' + on(c.sticker === s)} onClick={() => set({ sticker: s })}>{s}</button>)}
          <button className={'swatch-btn sticker-btn' + on(!STICKERS.includes(c.sticker))} title="Your own sticker" aria-label="Your own sticker"
            onClick={() => ownSticker(book, onChange)}>✎</button>
        </div>
        <label className="tool-check"><input type="checkbox" checked={!!c.band} onChange={e => set({ band: e.target.checked })} /> Elastic band</label>
        <button className="chunky open-book" onClick={onOpen}>Open the book →</button>
      </div>
    </div>
  )
}

// back of the cover, on the left once the book is open at page 1
export function InsideCover({ book, onChange }) {
  const c = book.cover
  return (
    <div className={`endpaper pat-${c.pattern}`} style={{ '--cover': c.color }}>
      <div className="bookplate">
        <div className="bp-small">this book belongs to</div>
        <Field className="bp-name" value={c.owner ?? ''} ph="your name" onText={owner => setCover(onChange, { owner })} />
        <div className="bp-title">{book.title || 'Untitled book'}</div>
        <div className="bp-sticker">{c.sticker}</div>
      </div>
    </div>
  )
}
