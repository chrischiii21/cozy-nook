import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TYPES, SHORTCUTS, CONTINUE, PALETTE_MIME, CARD_MIME, BOX_COLORS, STICKY_COLORS, blk, esc, textLen, uid, tidy, placeBlock, newCard, withCard, LAYOUTS, applyLayout } from './notes'
import { ask, toast } from './ask'
import { usePhoto, dropPhoto } from './photos'

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function caretAt(el, edge) {
  const s = getSelection()
  if (!s.rangeCount || !s.isCollapsed) return false
  const r = s.getRangeAt(0), x = document.createRange()
  x.selectNodeContents(el)
  if (edge === 'start') x.setEnd(r.startContainer, r.startOffset)
  else x.setStart(r.endContainer, r.endOffset)
  return x.toString() === ''
}

// Cut everything after the caret out of el and return it as html.
function splitAtCaret(el) {
  const r = getSelection().getRangeAt(0)
  r.deleteContents()
  const x = document.createRange()
  x.selectNodeContents(el)
  x.setStart(r.endContainer, r.endOffset)
  const d = document.createElement('div')
  d.append(x.extractContents())
  if (!el.textContent) el.innerHTML = ''
  return d.textContent ? d.innerHTML : ''
}

// pos: 'start' | 'end' | character offset
export function placeCaret(el, pos = 'end') {
  el.focus()
  const r = document.createRange()
  let n = null
  if (typeof pos === 'number') {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    while ((n = w.nextNode())) {
      if (pos <= n.length) { r.setStart(n, pos); r.collapse(true); break }
      pos -= n.length
    }
  }
  if (!n) { r.selectNodeContents(el); r.collapse(pos === 'start') }
  const s = getSelection()
  s.removeAllRanges()
  s.addRange(r)
}

// contentEditable that React never re-renders over: html is only pushed in when it differs
// from what's on screen, so typing doesn't lose the caret.
function Editable({ html, ...props }) {
  const ref = useRef(null)
  useLayoutEffect(() => { if (ref.current.innerHTML !== html) ref.current.innerHTML = html }) // every render: html may stay '' while the DOM changed
  return <div ref={ref} className="content" contentEditable suppressContentEditableWarning {...props} />
}

// innerHTML of an edited field, emptied when no text is left so the placeholder shows
const cleanHtml = e => { const el = e.currentTarget; if (!el.textContent) el.innerHTML = ''; return el.innerHTML }
const pastePlain = e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) }

// confetti pop from a just-checked to-do
const CONFETTI = ['#ff5a36', '#ffd23f', '#6ee7b7', '#7cc6fe', '#ff8fc7']
function burst(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const r = el.getBoundingClientRect()
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 26 + Math.random() * 34
    s.className = 'confetti'
    s.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 12}px;background:${CONFETTI[i % 5]}`
    s.addEventListener('animationend', () => s.remove())
    document.body.append(s)
  }
}

function Menu({ menu, setMenu }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current, r = menu.rect, h = el.offsetHeight
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - 230)) + 'px'
    el.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px'
  }, [menu.rect, menu.items.length])
  useEffect(() => { ref.current.children[menu.sel]?.scrollIntoView({ block: 'nearest' }) }, [menu.sel])
  useEffect(() => {
    const n = menu.items.length
    const onKey = e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setMenu({ ...menu, sel: (menu.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n })
      else if (e.key === 'Enter') { setMenu(null); menu.items[menu.sel].run() }
      else if (e.key === 'Escape') setMenu(null)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    const onDown = e => { if (!ref.current.contains(e.target)) setMenu(null) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menu, setMenu])
  // portal: a menu opened inside a card must not be trapped in the card's stacking context
  return createPortal(
    <div id="menu" ref={ref}>
      {menu.items.map((it, k) => (
        <div key={it.label} className={'mi' + (k === menu.sel ? ' on' : '')}
          onMouseDown={e => { e.preventDefault(); setMenu(null); it.run() }}
          onMouseMove={() => k !== menu.sel && setMenu({ ...menu, sel: k })}>
          <span className="ic">{it.icon}</span><span>{it.label}</span>
        </div>
      ))}
    </div>, document.body)
}

// The block editor: the page body, and the inside of every container card.
function Blocks({ blocks, setBlocks }) {
  const root = useRef(null)
  const pending = useRef(null), dragId = useRef(null), dropRef = useRef(null)
  const [menu, setMenu] = useState(null)
  const [drop, setDrop] = useState(null) // { id, zone } — mirrored in dropRef for the drop handler

  const update = (fn, focusId, pos = 'end') => { setBlocks(fn); if (focusId) pending.current = [focusId, pos] }
  const editable = id => root.current.querySelector(`[data-id="${id}"] .content`)
  const focusBlock = (id, pos) => { const el = editable(id); if (el) placeCaret(el, pos) }

  useLayoutEffect(() => {
    if (!pending.current) return
    focusBlock(...pending.current)
    pending.current = null
  })

  // ---- block operations ----
  const patch = (id, props) => setBlocks(bs => bs.map(x => x.id === id ? { ...x, ...props } : x))
  const setType = (id, type, html, pos = 'end') => {
    const nb = type === 'divider' ? blk() : null
    update(bs => bs.flatMap(x => x.id !== id ? [x]
      : [{ ...x, type, html: type === 'divider' ? '' : html ?? x.html }, ...(nb ? [{ ...nb, group: x.group, col: x.col }] : [])]),
    nb ? nb.id : id, pos)
  }
  // new blocks inherit the column of the block they come from
  const insertAfter = (b, nbs, pos = 'end', html) => {
    const inherit = nbs.map(nb => ({ ...nb, group: b.group, col: b.col }))
    update(bs => bs.flatMap(x => x.id === b.id ? [html === undefined ? x : { ...x, html }, ...inherit] : [x]), nbs.at(-1).id, pos)
  }
  const remove = id => setBlocks(bs => { const n = tidy(bs.filter(x => x.id !== id)); return n.length ? n : [blk()] })

  const slashItems = id => Object.entries(TYPES).map(([t, [label, icon]]) => ({
    key: t, label, icon,
    run: () => setType(id, t, editable(id).innerHTML.replace(/^\/[^\s<]*/, '')),
  }))
  const blockItems = b => [
    { label: 'Delete', icon: '🗑', run: async () => {
      if (!textLen(b.html) || await ask({ title: 'Delete this block?', body: 'Its text will be gone for good.', ok: 'Delete', danger: true })) remove(b.id)
    } },
    { label: 'Duplicate', icon: '⧉', run: () => insertAfter(b, [{ ...b, id: uid() }]) },
    ...[['left', '⇤'], ['center', '↔'], ['right', '⇥']].map(([a, icon]) => (
      { label: 'Align ' + a, icon, run: () => patch(b.id, { align: a === 'left' ? undefined : a }) })),
    ...Object.entries(TYPES).map(([t, [label, icon]]) => ({ label: 'Turn into ' + label, icon, run: () => setType(b.id, t) })),
  ]

  // ---- typing ----
  const onInput = (b, e) => {
    const el = e.currentTarget, txt = el.textContent
    if (!txt) el.innerHTML = ''
    const s = b.type === 'text' && SHORTCUTS.find(([re]) => re.test(txt))
    if (s) return setType(b.id, s[1], esc(txt.replace(s[0], '')))
    const html = el.innerHTML
    patch(b.id, { html })
    if (txt.startsWith('/')) {
      const q = norm(txt.slice(1)), items = slashItems(b.id).filter(it => norm(it.key + it.label).includes(q))
      setMenu(items.length ? { items, sel: 0, rect: el.getBoundingClientRect(), slash: true } : null)
    } else if (menu?.slash) setMenu(null)
  }

  const onKeyDown = (b, i, e) => {
    const el = e.currentTarget
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!el.textContent && CONTINUE.includes(b.type)) return setType(b.id, 'text')
      const rest = splitAtCaret(el)
      insertAfter(b, [blk(CONTINUE.includes(b.type) ? b.type : 'text', rest)], 'start', el.innerHTML)
    } else if (e.key === 'Backspace' && caretAt(el, 'start')) {
      if (b.type !== 'text') { e.preventDefault(); return setType(b.id, 'text', undefined, 'start') }
      if (i === 0) return
      e.preventDefault()
      const prev = blocks[i - 1], html = el.innerHTML
      if (prev.type === 'divider') return update(bs => tidy(bs.filter(x => x.id !== prev.id)), b.id, 'start')
      update(bs => tidy(bs.filter(x => x.id !== b.id).map(x => x.id === prev.id ? { ...x, html: x.html + html } : x)), prev.id, textLen(prev.html))
    } else if ((e.key === 'ArrowUp' && caretAt(el, 'start')) || (e.key === 'ArrowDown' && caretAt(el, 'end'))) {
      const up = e.key === 'ArrowUp', dir = up ? -1 : 1
      for (let k = i + dir; k >= 0 && k < blocks.length; k += dir) {
        if (blocks[k].type !== 'divider') { e.preventDefault(); return focusBlock(blocks[k].id, up ? 'end' : 'start') }
      }
    }
  }

  const onPaste = (b, e) => {
    e.preventDefault()
    const lines = e.clipboardData.getData('text/plain').replace(/\r/g, '').split('\n')
    document.execCommand('insertText', false, lines.shift())
    if (lines.length) insertAfter(b, lines.map(l => blk('text', esc(l))), 'end', e.currentTarget.innerHTML)
  }

  // ---- drag & drop: reorder, columns, and new blocks from the sidebar palette ----
  const isDrag = e => dragId.current || e.dataTransfer.types.includes(PALETTE_MIME)
  const onDragOver = (id, e) => {
    if (!isDrag(e)) return
    e.preventDefault()
    let zone = 'end'
    if (id) {
      const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width
      zone = x < 0.15 ? 'left' : x > 0.85 ? 'right' : e.clientY < r.top + r.height / 2 ? 'above' : 'below'
    }
    if (dropRef.current?.id !== id || dropRef.current?.zone !== zone) setDrop(dropRef.current = { id, zone })
  }
  const onDrop = e => {
    if (!isDrag(e)) return
    e.preventDefault()
    const type = e.dataTransfer.getData(PALETTE_MIME), from = dragId.current, d = dropRef.current
    endDrag()
    if (!d || (from && d.id === from)) return
    const nb = type ? blk(type) : null
    update(bs => placeBlock(bs, nb ?? bs.find(x => x.id === from), d.id, d.zone), nb?.id)
  }
  const endDrag = () => { dragId.current = dropRef.current = null; setDrop(null) }

  // ---- render ----
  let n = 0
  const numbers = Object.fromEntries(blocks.map(b => [b.id, n = b.type === 'number' ? n + 1 : 0]))

  const renderBlock = b => {
    const i = blocks.indexOf(b)
    const mark = { bullet: '•', number: numbers[b.id] + '.', callout: '💡' }[b.type]
    const cls = ['block', b.type, b.checked && 'done', dragId.current === b.id && 'dragging',
      drop?.id === b.id && 'drop-' + drop.zone].filter(Boolean).join(' ')
    return (
      <div key={b.id} data-id={b.id} className={cls} onDragOver={e => onDragOver(b.id, e)} onDrop={onDrop}>
        <div className="tools">
          <button className="add" title="Add block below" onClick={() => insertAfter(b, [blk()])}>+</button>
          <button className="grip" draggable title="Drag to move · click for options"
            onClick={e => setMenu({ items: blockItems(b), sel: 0, rect: e.currentTarget.getBoundingClientRect() })}
            onDragStart={e => {
              dragId.current = b.id
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', '')
              e.dataTransfer.setDragImage(e.currentTarget.closest('.block'), 0, 0)
            }}
            onDragEnd={endDrag}>⋮⋮</button>
        </div>
        {b.type === 'divider' ? <hr /> : <>
          {b.type === 'todo' && <input type="checkbox" checked={!!b.checked} onChange={e => { patch(b.id, { checked: e.target.checked }); if (e.target.checked) burst(e.target) }} />}
          {mark && <span className="mark">{mark}</span>}
          <Editable html={b.html || ''} data-ph={b.type === 'text' ? "Type '/' for commands" : TYPES[b.type][0]}
            style={b.align ? { textAlign: b.align } : undefined}
            onInput={e => onInput(b, e)} onKeyDown={e => onKeyDown(b, i, e)} onPaste={e => onPaste(b, e)} />
        </>}
      </div>
    )
  }

  // consecutive blocks sharing a group render as one row of columns
  const rows = []
  for (const b of blocks) {
    const last = rows.at(-1)
    if (b.group && last?.group === b.group) last.items.push(b)
    else rows.push({ group: b.group, items: [b] })
  }

  const clickBelow = () => {
    const last = blocks.at(-1)
    if (last.type !== 'text' || last.group || textLen(last.html)) { const nb = blk(); update(bs => [...bs, nb], nb.id) }
    else focusBlock(last.id)
  }

  return <>
    <div ref={root}>
      {rows.map(row => row.group
        ? <div key={row.group} className="cols">
            {[...new Set(row.items.map(b => b.col))].sort((a, b) => a - b).map(c => (
              <div key={c} className="col">{row.items.filter(b => b.col === c).map(renderBlock)}</div>
            ))}
          </div>
        : renderBlock(row.items[0]))}
    </div>
    <div className={'filler' + (drop?.zone === 'end' ? ' drop-end' : '')}
      onClick={clickBelow} onDragOver={e => onDragOver(null, e)} onDrop={onDrop} />
    {menu && <Menu menu={menu} setMenu={setMenu} />}
  </>
}

// A container or sticky note stuck on the page: drag its top bar, resize from its corner. It stays on its page.
function Card({ card: c, top, set, remove, onFill }) {
  const ref = useRef(null)
  const patch = props => set(x => ({ ...x, ...props }))
  const box = c.kind === 'box', colors = box ? BOX_COLORS : STICKY_COLORS
  const name = { box: 'container', sticky: 'sticky note', photo: c.img ? 'photo' : 'photo frame', sticker: 'sticker' }[c.kind]
  const free = c.kind === 'photo' || c.kind === 'sticker' // grabbed anywhere, not just by a top bar
  const photo = usePhoto(c.img)

  // the corner handle is native CSS resize; persist whatever size it leaves behind
  useEffect(() => {
    const el = ref.current
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth, h = el.offsetHeight
      set(x => x.w === w && x.h === h ? x : { ...x, w, h })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startMove = e => {
    if (e.button || e.target.closest('button, [contenteditable]')) return
    const el = ref.current, br = el.getBoundingClientRect()
    if (e.clientX > br.right - 18 && e.clientY > br.bottom - 18) return // that's the resize corner
    e.preventDefault()
    const sheet = el.parentNode, pw = sheet.clientWidth, ph = sheet.clientHeight
    const s = sheet.getBoundingClientRect().width / sheet.offsetWidth // pointer moves on screen, the book is scaled
    const x0 = el.offsetLeft, y0 = el.offsetTop, cx = e.clientX, cy = e.clientY
    el.style.zIndex = top + 1
    el.classList.add('lifted')
    el.setPointerCapture(e.pointerId)
    const move = ev => {
      el.style.left = Math.max(0, Math.min(pw - el.offsetWidth, x0 + (ev.clientX - cx) / s)) + 'px'
      el.style.top = Math.max(0, Math.min(ph - el.offsetHeight, y0 + (ev.clientY - cy) / s)) + 'px'
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('lostpointercapture', () => {
      el.removeEventListener('pointermove', move)
      el.classList.remove('lifted')
      patch({ x: el.offsetLeft, y: el.offsetTop, z: top + 1 })
    }, { once: true })
  }

  const del = async () => {
    const empty = c.kind === 'sticker' || (c.kind === 'photo' ? !c.img : !c.title && !c.html && !(c.blocks ?? []).some(b => textLen(b.html)))
    if (!empty && !await ask({ title: `Delete this ${name}?`, body: c.img ? 'The picture will be gone for good.' : 'Everything in it will be gone for good.', ok: 'Delete', danger: true })) return
    remove()
    if (c.img) dropPhoto(c.img)
    toast(`${name[0].toUpperCase() + name.slice(1)} removed`, '🗑')
  }

  return (
    <div ref={ref} className={`card ${c.kind} c-${c.color}` + (c.strip ? ' strip' : '') + (c.kind === 'photo' && !c.img ? ' empty' : '')}
      data-card={c.id} onPointerDown={free ? startMove : undefined}
      // clamp(): cards saved further out, or grown by a resize, are pulled back inside the page
      style={{ left: `clamp(0px, ${c.x}px, 100% - ${c.w}px)`, top: `clamp(0px, ${c.y}px, 100% - ${c.h}px)`,
        width: c.w, height: c.h, zIndex: c.z, rotate: box ? undefined : c.tilt + 'deg' }}>
      <div className="card-bar" onPointerDown={free ? undefined : startMove} title="Drag to move">
        {box && <>
          <span className="grip">⋮⋮</span>
          <Editable className="content card-title" html={c.title} data-ph="Untitled" onPaste={pastePlain}
            onKeyDown={e => e.key === 'Enter' && e.preventDefault()} onInput={e => patch({ title: cleanHtml(e) })} />
        </>}
        {!free && <button className="card-btn swatch" title="Change color" aria-label="Change color"
          onClick={() => patch({ color: colors[(colors.indexOf(c.color) + 1) % colors.length] })} />}
        <button className="card-btn" title={`Delete ${name}`} aria-label={`Delete ${name}`} onClick={del}>×</button>
      </div>
      {box ? <div className="card-body"><Blocks blocks={c.blocks} setBlocks={fn => set(x => ({ ...x, blocks: fn(x.blocks) }))} /></div>
        : c.kind === 'sticky' ? <Editable className="content sticky-text" html={c.html} data-ph="Jot something…" onPaste={pastePlain}
            onInput={e => patch({ html: cleanHtml(e) })} />
        : c.kind === 'photo' ? <>
            {/* a background, not an <img>: the browser's own image dragging would fight moving the card */}
            {c.img ? <div className="photo-img" style={photo ? { backgroundImage: `url(${photo})` } : undefined} />
              : <div className="photo-slot">{/* an empty frame from the album layout */}
                  <span>Add a photo</span>
                  <div className="slot-btns">
                    <button onClick={() => onFill('upload')}>🖼 Upload</button>
                    <button onClick={() => onFill('booth')}>📸 Booth</button>
                  </div>
                </div>}
            {!c.strip && <Editable className="content photo-cap" html={c.caption} data-ph="caption…" onPaste={pastePlain}
              onKeyDown={e => e.key === 'Enter' && e.preventDefault()} onInput={e => patch({ caption: cleanHtml(e) })} />}
          </>
        : <span className="sticker-emoji">{c.emoji}</span>}
    </div>
  )
}

// Rows that don't fit on the paper any more: from the first block poking past the bottom margin to the end.
// A row of columns moves as a whole. Empty = it all fits; null = even the first row is too tall to move on.
function overflowing(doc, blocks) {
  const r = doc.getBoundingClientRect(), s = r.height / doc.offsetHeight // on-screen rects are scaled with the book
  if (!s) return null // not shown (one-page phone layout hides the left page)
  const limit = r.top + (doc.clientTop + doc.clientHeight - parseFloat(getComputedStyle(doc).paddingBottom)) * s
  let i = blocks.findIndex(b => doc.querySelector(`[data-id="${b.id}"]`)?.getBoundingClientRect().bottom > limit + 1)
  if (i < 0) return []
  while (i > 0 && blocks[i].group && blocks[i - 1].group === blocks[i].group) i--
  return i === 0 ? null : blocks.slice(i).map(b => b.id)
}

export default function Page({ page, onChange, focusTitle, onFull, onPhotoFile, onFillSlot, album }) {
  const { blocks } = page, cards = page.cards ?? []
  const titleRef = useRef(null), docRef = useRef(null)

  // a real page doesn't scroll: what doesn't fit carries on onto the next page
  useLayoutEffect(() => {
    const doc = docRef.current, ids = overflowing(doc, blocks)
    doc.classList.toggle('tall', !ids) // one block taller than a whole page: only then may the page scroll
    if (ids?.length) onFull(ids)
  })
  const setBlocks = fn => onChange(p => ({ ...p, blocks: fn(p.blocks) }))
  const setCard = (id, fn) => onChange(p => ({ ...p, cards: p.cards.map(c => c.id === id ? fn(c) : c) }))
  const removeCard = id => onChange(p => ({ ...p, cards: p.cards.filter(c => c.id !== id) }))
  const top = cards.reduce((m, c) => Math.max(m, c.z ?? 1), 1) // CSS default z-index is 1

  useLayoutEffect(() => { if (titleRef.current.textContent !== page.title) titleRef.current.textContent = page.title }, [page.title])
  useLayoutEffect(() => { if (focusTitle && !page.title) titleRef.current.focus() }, []) // new page: start at the title

  const editIcon = async () => {
    const v = (await ask({ title: 'Page icon', body: 'An emoji or a few characters.', input: page.icon, ok: 'Save' }))?.trim()
    if (v) onChange(p => ({ ...p, icon: [...v].slice(0, 8).join('') }))
  }

  return (
    // a book page: the paper (.doc) is a fixed size; cards sit on the sheet over it
    <div className={'page' + (album ? ' album' : '')} data-page={page.id}
      onDragOver={e => (e.dataTransfer.types.includes(CARD_MIME) || e.dataTransfer.types.includes('Files')) && e.preventDefault()}
      onDrop={e => {
        // a card from the toolbox, or picture files dragged in from the computer
        const kind = e.dataTransfer.getData(CARD_MIME), pics = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))
        if (!kind && !pics.length) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect(), s = r.width / e.currentTarget.offsetWidth
        const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s
        if (kind) onChange(p => withCard(p, newCard(kind, x, y)))
        const slot = e.target.closest?.('.photo.empty')?.dataset.card // dropped onto an empty frame: fill it
        pics.forEach((f, i) => onPhotoFile(f, x + i * 24, y + i * 24, i ? null : slot))
      }}>
      <div className="doc" ref={docRef}>
      <div className="page-head">
        <span className="page-icon" title="Change icon" onClick={editIcon}>{page.icon}</span>
        <span className="dateline">{new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</span>
        {album && <button className="layout-btn" title="Rearrange this page's photos into the next layout"
          onClick={() => onChange(p => applyLayout(p, ((p.layout ?? -1) + 1) % LAYOUTS.length))}>
          ⊞ {page.layout === undefined ? 'Layout' : LAYOUTS[page.layout].name}
        </button>}
      </div>
      <h1 ref={titleRef} className="title" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
        onInput={e => {
          const el = e.currentTarget
          if (!el.textContent) el.innerHTML = ''
          const title = el.textContent
          onChange(p => ({ ...p, title }))
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const focus = id => placeCaret(titleRef.current.parentNode.querySelector(`[data-id="${id}"] .content`), 'start')
          const first = blocks.find(b => b.type !== 'divider')
          if (first) return focus(first.id)
          const nb = blk()
          setBlocks(bs => [nb, ...bs])
          requestAnimationFrame(() => focus(nb.id))
        }} />
      <Blocks blocks={blocks} setBlocks={setBlocks} />
      </div>
      {cards.map(c => <Card key={c.id} card={c} top={top} set={fn => setCard(c.id, fn)} remove={() => removeCard(c.id)}
        onFill={how => onFillSlot(page.id, c.id, how)} />)}
    </div>
  )
}
