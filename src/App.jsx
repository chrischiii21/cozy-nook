import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Page, { placeCaret } from './Page'
import { CoverFace, CoverTools, InsideCover } from './Cover'
import Island from './Island'
import Shelves from './Shelves'
import Photobooth from './Photobooth'
import { putPhoto, getPhoto, dropPhoto, photoIds, usedPhotos, shrink, toDataURL, resealPhotos } from './photos'
import { ask, toast } from './ask'
import { TYPES, PALETTE_MIME, CARD_MIME, emptyPage, emptyBook, normalize, isBackup, newCard, withCard, uid, STICKERS, albumPage, LAYOUTS } from './notes'

const CARDS = [['box', '▣', 'Container'], ['sticky', '🗒', 'Sticky note']]
const PHOTO_TOOLS = [['photo', '🖼', 'Photo'], ['booth', '📸', 'Photobooth'], ['sticker', '⭐', 'Sticker']]
const LEFT = '.slot.left > :last-child', RIGHT = '.slot.right > :last-child' // last: a turn's frozen copy may sit before it
// A turn hinges on the spine (between the two slots). The sheet leaving lifts until it's edge-on (LIFT),
// then the sheet arriving on the other side comes down from edge-on (LAND). Both run on the same clock.
const kf = (deg, origin, dim = 1, offset) => ({
  transform: `perspective(2400px) rotateY(${deg}deg)`, transformOrigin: origin, backfaceVisibility: 'hidden', filter: `brightness(${dim})`,
  ...(offset === undefined ? {} : { offset }),
})
const LIFT = {
  next: [kf(0, 'left center'), kf(-180, 'left center', .6)], // right page over to the left
  back: [kf(0, 'right center'), kf(180, 'right center', .6)], // left page back over to the right
}
const LAND = {
  next: [kf(90, 'right center', .6), kf(90, 'right center', .6, .5), kf(0, 'right center')],
  back: [kf(-90, 'left center', .6), kf(-90, 'left center', .6, .5), kf(0, 'left center')],
}
const FLIP_TIME = { duration: 760, easing: 'cubic-bezier(.45, .05, .35, 1)' }
const ARRIVE = [{ opacity: 0, transform: 'translateY(28px) scale(.96)' }, { opacity: 1, transform: 'none' }]
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
// play a turn, then clean up; a tab that stops painting mid-turn (backgrounded) snaps to the end instead of freezing
function play(el, frames, done) {
  const a = el.animate(frames, FLIP_TIME)
  a.finished.then(done, done)
  setTimeout(() => a.finish(), FLIP_TIME.duration + 300)
}
// Frozen copies for a turn to play with.
// liftCopy: the whole slot (so `.slot.left …` styles still apply), floating over everything.
// stayCopy: the sheet itself, left in its own slot behind whatever React puts there next,
// so the arriving sheet lands on top of it (and the cover board can't hide it).
function keepScroll(from, to) { // pages scroll their writing inside themselves; cloning doesn't keep that
  const a = from.querySelector('.doc'), b = to.querySelector('.doc')
  if (a && b) b.scrollTop = a.scrollTop
}
function liftCopy(slot) {
  // the book is scaled: copy at paper size with the same scale, placed so that scaling about its spine edge
  // (the turn's transform-origin) lands it exactly over the original
  const r = slot.getBoundingClientRect(), w = slot.offsetWidth, h = slot.offsetHeight, copy = slot.cloneNode(true)
  copy.inert = true
  Object.assign(copy.style, {
    position: 'fixed', left: (slot.classList.contains('right') ? r.left : r.right - w) + 'px', top: r.top + r.height / 2 - h / 2 + 'px',
    width: w + 'px', height: h + 'px', scale: String(r.width / w), margin: 0, zIndex: 30,
  })
  copy.style.setProperty('--cover', slot.parentNode.style.getPropertyValue('--cover'))
  document.body.append(copy)
  keepScroll(slot, copy)
  return copy
}
function stayCopy(sheet) {
  const copy = sheet.cloneNode(true)
  copy.inert = true
  Object.assign(copy.style, { position: 'absolute', inset: 0 })
  sheet.parentNode.prepend(copy)
  keepScroll(sheet, copy)
  return copy
}
const inBook = (d, fn) => ({ ...d, books: d.books.map(b => b.id === d.current ? fn(b) : b) })
const PAGE_W = 525, PAGE_H = 700, GAP = 14 // paper size (px at scale 1); keep in step with .spread in index.css

// Only ever shown unlocked (Lock.jsx): initial = the decrypted shelf, vault = where it's saved back, sealed.
export default function App({ initial, vault, onLock }) {
  const [db, setDb] = useState(initial)
  const [side, setSide] = useState(() => innerWidth >= 700)
  const [saveError, setSaveError] = useState(null)
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme)
  const changePassword = async () => {
    const a = await ask({ title: 'Choose a new password', body: 'At least 8 characters. There’s no way to recover it, so pick one you’ll remember.', input: '', secret: true, ok: 'Next' })
    if (a === null) return
    if (a.length < 8) return ask({ title: 'That’s too short', body: 'Use at least 8 characters.', cancel: null })
    const b = await ask({ title: 'Repeat the new password', input: '', secret: true, ok: 'Change password' })
    if (b === null) return
    if (a !== b) return ask({ title: 'Those didn’t match', body: 'Your password is unchanged.', cancel: null })
    try { await vault.rekey(a, db, resealPhotos) } catch (e) { return ask({ title: 'Couldn’t change the password', body: `${e.message}. Your old one still works.`, cancel: null }) }
    toast('Password changed', '🔒')
  }
  const flipTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('nook.theme', t) } catch { /* just won't be remembered */ }
    setTheme(t)
  }
  const main = useRef(null), fileRef = useRef(null), warned = useRef(false), keys = useRef(null)
  const turning = useRef(null), shownBook = useRef(db.current) // turning: { dir, under } until the new sheet lands
  const sizer = useRef(null), spreadRef = useRef(null), follow = useRef(null)
  const [scale, setScale] = useState(1)
  const [home, setHome] = useState(true) // Nook opens on the bookcase
  const [booth, setBooth] = useState(false)
  const photoIn = useRef(null)
  const arrive = useRef(false)
  // scale the fixed-size book to fit the desk (one page at a time on a phone)
  useLayoutEffect(() => {
    const m = main.current, fit = () => {
      const cs = getComputedStyle(m), one = innerWidth <= 700
      const w = m.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const h = m.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      setScale(Math.min(1.15, (h - 28) / PAGE_H, (w - (one ? 0 : 110)) / (one ? PAGE_W : 2 * PAGE_W + GAP)))
    }
    const ro = new ResizeObserver(fit)
    ro.observe(m)
    return () => ro.disconnect()
  }, [])
  // the sizer takes up the book's on-screen size in the layout (a transform doesn't)
  useLayoutEffect(() => {
    const s = spreadRef.current
    if (!s) return // on the bookcase
    Object.assign(sizer.current.style, { width: s.offsetWidth * scale + 'px', height: s.offsetHeight * scale + 'px' })
  })
  const book = db.books.find(b => b.id === db.current)
  const page = book.pages.find(p => p.id === db.page) // none = looking at the cover
  const at = page ? book.pages.indexOf(page) : -1, last = book.pages.length - 1

  useEffect(() => {
    vault.save(db).then(() => setSaveError(null), e => {
      setSaveError(e.message)
      if (!warned.current) {
        warned.current = true
        ask({ title: 'Your latest changes are not saved', body: `${e.message}. Export a backup now so nothing is lost.`, cancel: null })
      }
    })
  }, [db])
  // the browser's own "leave site?" prompt, only while something failed to save
  useEffect(() => {
    if (!saveError) return
    const onLeave = e => e.preventDefault()
    addEventListener('beforeunload', onLeave)
    return () => removeEventListener('beforeunload', onLeave)
  }, [saveError])
  useLayoutEffect(() => {
    const m = main.current, t = turning.current
    turning.current = null
    if (t) { // second half of a turn: the arriving sheet comes down on the far side of the spine
      const land = m.querySelector(t.dir === 'next' ? LEFT : RIGHT), done = () => { t.under?.remove(); m.classList.remove('turning') }
      land ? play(land, LAND[t.dir], done) : done()
    } else if ((shownBook.current !== db.current || arrive.current) && !home && !still()) {
      for (const s of m.querySelectorAll(`${LEFT}, ${RIGHT}`)) s.animate(ARRIVE, { duration: 320, easing: 'cubic-bezier(.3, 1.4, .5, 1)' })
    }
    shownBook.current = db.current
    arrive.current = false
  }, [db.current, db.page, home])
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); setSide(s => !s) }
      else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !document.querySelector('dialog[open]')) {
        e.preventDefault()
        keys.current[e.key === 'ArrowRight' ? 'next' : 'prev']()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  // swipe on touch, or a two-finger sideways swipe on a trackpad, turns pages (never adds one)
  useEffect(() => {
    const m = main.current
    let sum = 0, lastWheel = 0, quietUntil = 0, start = null
    const swipe = dir => { if (Date.now() > quietUntil) { quietUntil = Date.now() + 800; keys.current.swipe(dir) } }
    const onWheel = e => {
      const own = e.target.closest?.('.doc')
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5 || (own && own.scrollWidth > own.clientWidth)) return // vertical, or the page itself scrolls sideways
      if (e.timeStamp - lastWheel > 300) sum = 0 // a new gesture
      lastWheel = e.timeStamp
      sum += e.deltaX
      if (Math.abs(sum) > 140) { swipe(Math.sign(sum)); sum = 0 }
    }
    const onStart = e => { start = e.touches.length === 1 && !e.target.closest('.card') ? [e.touches[0].clientX, e.touches[0].clientY, e.timeStamp] : null }
    const onEnd = e => {
      if (!start) return
      const t = e.changedTouches[0], dx = t.clientX - start[0], dy = t.clientY - start[1]
      if (e.timeStamp - start[2] < 600 && Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) / 2) swipe(dx < 0 ? 1 : -1)
      start = null
    }
    m.addEventListener('wheel', onWheel, { passive: true })
    m.addEventListener('touchstart', onStart, { passive: true })
    m.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      m.removeEventListener('wheel', onWheel)
      m.removeEventListener('touchstart', onStart)
      m.removeEventListener('touchend', onEnd)
    }
  }, [])

  const updateBook = fn => setDb(d => inBook(d, fn))
  const updatePage = id => fn => setDb(d => inBook(d, b => ({ ...b, pages: b.pages.map(p => p.id === id ? fn(p) : p) })))
  const closeSideOnPhone = () => { if (innerWidth < 700) setSide(false) }

  // First half of a turn, before the spread changes: a copy of the leaving sheet lifts off the spine,
  // and a copy of the sheet on the other side stays put until the arriving one lands on it (layout effect).
  const turn = (fn, dir) => {
    const m = main.current, from = m.querySelector(dir === 'next' ? '.slot.right' : '.slot.left')
    if (dir && from && !still()) {
      turning.current?.under?.remove() // still mid-turn from a fast double click
      const stay = m.querySelector(dir === 'next' ? LEFT : RIGHT), lift = liftCopy(from)
      play(lift, LIFT[dir], () => lift.remove())
      turning.current = { dir, under: stay && stayCopy(stay) }
      m.classList.add('turning') // swinging sheets mustn't flash scrollbars
    }
    setDb(fn)
  }
  const goTo = i => { // -1 = cover
    turn(d => ({ ...d, page: i < 0 ? null : book.pages[i].id }), i > at ? 'next' : i < at ? 'back' : null)
    closeSideOnPhone()
  }
  const addPage = (title = '') => {
    const p = book.kind === 'album' ? albumPage(title, book.pages.length % LAYOUTS.length) : emptyPage(title)
    turn(d => ({ ...inBook(d, b => ({ ...b, pages: [...b.pages, p] })), page: p.id }), 'next')
  }
  // A full page carries its last rows over, like writing on in a real notebook. They go to the page's
  // continuation ("… (cont.)", marked `of`), made right after it if there isn't one yet, so they never
  // land on an unrelated page. If you were typing in them, the book follows you there.
  const spill = (fromId, ids) => {
    const i = book.pages.findIndex(p => p.id === fromId), from = book.pages[i]
    const base = from.title.replace(/ \(cont\.\)$/, '')
    const fresh = { ...emptyPage(base && `${base} (cont.)`), icon: from.icon, of: fromId, blocks: [] }
    const typing = ids.includes(document.activeElement?.closest('.doc [data-id]')?.dataset.id)
    // works from the latest state and does nothing if the rows already moved (effects may run twice)
    const move = d => inBook(d, b => {
      const k = b.pages.findIndex(p => p.id === fromId), f = b.pages[k], moved = f.blocks.filter(x => ids.includes(x.id))
      if (!moved.length) return b
      const c = b.pages[k + 1]?.of === fromId ? b.pages[k + 1] : fresh, pages = [...b.pages]
      pages.splice(k, c === fresh ? 1 : 2, { ...f, blocks: f.blocks.filter(x => !ids.includes(x.id)) }, { ...c, blocks: [...moved, ...c.blocks] })
      return { ...b, pages }
    })
    const toCont = d => { // move, and open the book at the continuation
      const n = move(d), ps = n.books.find(b => b.id === n.current).pages
      return { ...n, page: ps[ps.findIndex(p => p.id === fromId) + 1].id }
    }
    if (i === at - 1) setDb(toCont) // left page spilled: its continuation opens on the right
    else if (typing) turn(toCont, 'next') // wrote past the right page: turn over, keep going
    else setDb(move)
    if (typing) follow.current = { id: ids.at(-1), from: fromId }
  }
  // the caret follows writing that carried over, as soon as it shows up on its new page
  useLayoutEffect(() => {
    const f = follow.current
    const el = f && main.current.querySelector(`.page:not([data-page="${f.from}"]) [data-id="${f.id}"] .content`)
    if (!el) return
    follow.current = null
    placeCaret(el, 'end')
  })

  const next = () => at < last ? goTo(at + 1) : addPage()
  const prev = () => at >= 0 && goTo(at - 1)
  keys.current = home ? { next() {}, prev() {}, swipe() {} } : { next, prev, swipe: dir => dir > 0 ? at < last && goTo(at + 1) : prev() }

  const openBook = id => {
    if (home) { arrive.current = true; setHome(false); setDb(d => ({ ...d, current: id, page: null })); return }
    if (id === book.id) return goTo(-1)
    setDb(d => ({ ...d, current: id, page: null }))
    closeSideOnPhone()
  }
  // straight to a page anywhere on the shelf (search)
  const openPage = id => {
    const b = db.books.find(x => x.pages.some(p => p.id === id))
    if (home) { arrive.current = true; setHome(false); setDb(d => ({ ...d, current: b.id, page: id })); return }
    if (b.id === book.id) return goTo(b.pages.findIndex(p => p.id === id))
    setDb(d => ({ ...d, current: b.id, page: id }))
    closeSideOnPhone()
  }
  const newBook = (shelf, kind) => {
    const b = emptyBook('', shelf, kind)
    arrive.current = true
    setHome(false)
    setDb(d => ({ ...d, books: [...d.books, b], current: b.id, page: null }))
    closeSideOnPhone()
  }
  const deleteBook = async b => {
    const n = b.pages.length
    if (!await ask({ title: 'Delete this book?', body: `“${b.title || 'Untitled book'}” and its ${n} page${n === 1 ? '' : 's'} will be gone for good.`, ok: 'Delete book', danger: true })) return
    setDb(d => {
      const books = d.books.filter(x => x.id !== b.id)
      if (!books.length) books.push(emptyBook('My Notebook', b.shelf))
      return books.some(x => x.id === d.current) ? { ...d, books } : { ...d, books, current: books[0].id, page: null }
    })
    toast(`“${b.title || 'Untitled book'}” taken off the shelf`, '🗑')
  }
  const deletePage = async p => {
    if (!await ask({ title: 'Tear out this page?', body: `“${p.title || 'Untitled'}” and everything on it will be gone for good.`, ok: 'Delete page', danger: true })) return
    setDb(d => {
      const b = d.books.find(x => x.id === d.current), i = b.pages.findIndex(x => x.id === p.id)
      const pages = b.pages.filter(x => x.id !== p.id)
      if (!pages.length) pages.push(emptyPage())
      // the open page went away: land on the one before it
      return { ...inBook(d, x => ({ ...x, pages })), page: d.page === p.id ? pages[Math.max(0, i - 1)].id : d.page }
    })
    toast('Page torn out', '✂')
  }
  // photos nobody points at any more (a deleted page or book, a crash mid-add) are cleared out once per visit
  useEffect(() => {
    const used = usedPhotos(db)
    photoIds().then(ids => ids.filter(id => !used.has(id)).forEach(dropPhoto)).catch(() => {})
  }, [])

  // a picture onto a page: stored in IndexedDB, shown as a polaroid (or a booth strip, which has its own frame)
  // slot = an empty frame from the album layout to fill (it keeps its place and size; a booth strip takes strip shape)
  const addPhoto = async (pageId, { blob, ratio, strip }, at, slot) => {
    const id = uid()
    try { await putPhoto(id, blob) } catch (e) { return ask({ title: 'Couldn’t save the photo', body: e.message, cancel: null }) }
    if (slot) return updatePage(pageId)(p => ({
      ...p, cards: p.cards.map(c => c.id !== slot ? c : { ...c, img: id, ...(strip && { strip: true, w: 160, h: Math.round(160 * ratio) }) }),
    }))
    const sheet = main.current.querySelector(`.page[data-page="${pageId}"]`)
    const w = strip ? 150 : 230, h = Math.round(strip ? w * ratio : (w - 20) * ratio + 58) // polaroid: 10px border + caption strip
    updatePage(pageId)(p => {
      const k = (p.cards?.length ?? 0) % 6 * 28
      return withCard(p, newCard('photo', at?.x ?? (sheet?.clientWidth ?? 400) / 2 + k, at?.y ?? 60 + k, { w, h, img: id, strip: !!strip }))
    })
  }
  const photoFile = (pageId, at, slot) => async file => {
    try { await addPhoto(pageId, await shrink(file), at, slot) } catch { ask({ title: 'That picture couldn’t be opened', body: file.name, cancel: null }) }
  }
  const addSticker = async () => {
    const emoji = (await ask({ title: 'Add a sticker', body: 'Any emoji (Win + . opens the emoji picker).', input: STICKERS[Math.floor(Math.random() * STICKERS.length)], ok: 'Stick it' }))?.trim()
    if (emoji) addCard('sticker', { emoji: [...emoji].slice(0, 3).join('') })
  }
  const photoTool = k => k === 'photo' ? photoIn.current.click() : k === 'booth' ? setBooth({ pageId: page.id }) : addSticker()
  // the Upload / Booth buttons on an empty album frame
  const fillTarget = useRef(null)
  const fillSlot = (pageId, slot, how) => {
    if (how === 'booth') return setBooth({ pageId, slot })
    fillTarget.current = { pageId, slot }
    photoIn.current.click()
  }

  // the bookcase: move a book (before another, or to the end of a shelf), add / rename / remove shelves
  const moveBook = (id, shelf, before) => setDb(d => {
    const b = d.books.find(x => x.id === id), books = d.books.filter(x => x.id !== id)
    books.splice(before ? books.findIndex(x => x.id === before) : books.length, 0, { ...b, shelf })
    return { ...d, books }
  })
  const addShelf = () => setDb(d => ({ ...d, shelves: [...d.shelves, { id: uid(), name: '' }] }))
  const renameShelf = (id, name) => setDb(d => ({ ...d, shelves: d.shelves.map(x => x.id === id ? { ...x, name } : x) }))
  const deleteShelf = async s => {
    const n = db.books.filter(b => b.shelf === s.id).length, to = db.shelves.find(x => x.id !== s.id)
    if (n && !await ask({ title: 'Remove this shelf?', body: `Its ${n} book${n === 1 ? '' : 's'} will move to “${to.name || 'Untitled shelf'}”.`, ok: 'Remove shelf', danger: true })) return
    setDb(d => ({ ...d, shelves: d.shelves.filter(x => x.id !== s.id), books: d.books.map(b => b.shelf === s.id ? { ...b, shelf: to.id } : b) }))
    toast('Shelf removed', '🗑')
  }

  // click-to-add sticks the card on the right-hand page, staggered so repeats don't stack exactly
  const addCard = (kind, extra) => {
    const s = main.current.querySelector('.slot.right .page')
    updatePage(page.id)(p => {
      const k = (p.cards?.length ?? 0) % 6 * 32
      return withCard(p, newCard(kind, s.clientWidth / 2 + k, s.clientHeight / 5 + k, extra))
    })
    closeSideOnPhone()
  }

  const count = d => `${d.books.length} book${d.books.length === 1 ? '' : 's'} (${d.books.reduce((s, b) => s + b.pages.length, 0)} pages)`
  const exportBackup = async () => {
    if (!await ask({ title: 'Export a backup?', body: `Downloads your whole shelf, ${count(db)} and photos, as one .json file you can import later. The file itself isn’t password-protected, so keep it somewhere safe.`, ok: 'Download' })) return
    // photos live outside the notes (IndexedDB), so they're packed in as data URLs
    const photos = {}
    for (const id of usedPhotos(db)) { const b = await getPhoto(id).catch(() => null); if (b) photos[id] = await toDataURL(b) }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...db, photos }, null, 1)], { type: 'application/json' }))
    a.download = `nook-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast('Backup downloaded', '⤓')
  }
  const importBackup = async e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    try {
      const raw = JSON.parse(await f.text())
      if (!isBackup(raw)) throw Error('this is not a Nook backup')
      const { photos = {}, ...rest } = raw, d = normalize(rest)
      if (!await ask({
        title: 'Replace your shelf?',
        body: `Your current ${count(db)} will be replaced with ${count(d)} from “${f.name}”. Export a backup first if you might want them back.`,
        ok: 'Replace', danger: true,
      })) return
      for (const [id, url] of Object.entries(photos)) await putPhoto(id, await (await fetch(url)).blob())
      setDb(d)
      toast(`Shelf restored · ${count(d)}`, '⤒')
    } catch (err) { ask({ title: 'Import failed', body: err.message, cancel: null }) }
  }

  return <>
    <aside className={side && !home ? '' : 'hidden'}>
      <div className="side-head">
        <img src="/nook.svg" alt="" />Nook
        <button className="chunky theme-btn" onClick={onLock} title="Lock Nook" aria-label="Lock Nook">🔒</button>
        <button className="chunky theme-btn" onClick={flipTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? '☀️' : '🌙'}</button>
      </div>
      <button className="btn back-home" onClick={() => setHome(true)}>← All shelves</button>
      <nav className="pages">
        <div className="book-row" onClick={() => openBook(book.id)}>
          <span className={`mini-cover pat-${book.cover.pattern}`} style={{ '--cover': book.cover.color }}>{book.cover.sticker}</span>
          <span className="t">{book.title || 'Untitled book'}</span>
          <button className="del" title="Delete book" onClick={e => { e.stopPropagation(); deleteBook(book) }}>×</button>
        </div>
        <div className="toc">
          <div className={'page-item' + (at < 0 ? ' active' : '')} onClick={() => goTo(-1)}>
            <span className="pno">✦</span><span className="t">Cover</span>
          </div>
          {book.pages.map((p, i) => (
            <div key={p.id} className={'page-item' + (i === at || (page && i === at - 1) ? ' active' : '')} onClick={() => goTo(i)}>
              <span className="pno">{i + 1}</span><span>{p.icon}</span>
              <span className="t">{p.title || 'Untitled'}</span>
              <button className="del" title="Delete page" onClick={e => { e.stopPropagation(); deletePage(p) }}>×</button>
            </div>
          ))}
          <button className="btn new-page" onClick={() => addPage()}>＋ New page</button>
        </div>
      </nav>
      <div className="side-actions">
        <button className="chunky" title="Download a backup of your whole shelf" onClick={exportBackup}>⤓ Export</button>
        <button className="chunky" title="Restore your shelf from a backup file" onClick={() => fileRef.current.click()}>⤒ Import</button>
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importBackup} />
      <div className={'save-state' + (saveError ? ' bad' : '')} role="status" title={saveError ?? 'Saved in this browser'}>
        {saveError ? '⚠ Not saved!' : '✓ All saved'}
      </div>
    </aside>
    {!home && <button className="chunky toggle-side" title="Toggle sidebar (Ctrl+\)" aria-label="Toggle sidebar" onClick={() => setSide(s => !s)}>☰</button>}
    <main ref={main} className={home ? 'at-home' : ''}>
      {home ? <Shelves db={db} onOpen={openBook} onNewBook={newBook} onMove={moveBook}
        onAddShelf={addShelf} onRenameShelf={renameShelf} onDeleteShelf={deleteShelf}
        actions={<>
          <button className="chunky" onClick={flipTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="chunky" onClick={exportBackup}>⤓ Export</button>
          <button className="chunky" onClick={() => fileRef.current.click()}>⤒ Import</button>
          <button className="chunky" onClick={changePassword}>Change password</button>
          <button className="chunky" onClick={onLock}>🔒 Lock</button>
        </>} /> : <>
      {/* the book, open on a spread: closed = design panel | cover, page 1 = inside cover | page 1, then page n-1 | page n */}
      <div className="sizer" ref={sizer}>
      <div ref={spreadRef} className={'spread' + (page ? '' : ' closed')} style={{ '--cover': book.cover.color, scale: String(scale) }}>
        {page && <div className={`board pat-${book.cover.pattern}`} />}
        {/* index tabs: out of the left edge when open, out of the cover's right edge when closed */}
        <div className="tab-rail">
          {book.pages.map((p, i) => (
            <button key={p.id} className={'tab' + (page && (i === at || i === at - 1) ? ' on' : '')} title={`${i + 1}. ${p.title || 'Untitled'}`}
              aria-label={`Go to page ${i + 1}: ${p.title || 'Untitled'}`} onClick={() => goTo(i)}>{i + 1}</button>
          ))}
        </div>
        <div className="slot left">
          {!page ? <CoverTools key={'tools' + book.id} book={book} onChange={updateBook} onOpen={() => goTo(0)} />
            : at === 0 ? <InsideCover key={'inside' + book.id} book={book} onChange={updateBook} />
            : <Page key={book.pages[at - 1].id} page={book.pages[at - 1]} onChange={updatePage(book.pages[at - 1].id)}
                onFull={ids => spill(book.pages[at - 1].id, ids)} album={book.kind === 'album'}
                onPhotoFile={(f, x, y, slot) => photoFile(book.pages[at - 1].id, { x, y }, slot)(f)} onFillSlot={fillSlot} />}
        </div>
        <div className="slot right">
          {page ? <Page key={page.id} page={page} onChange={updatePage(page.id)} onFull={ids => spill(page.id, ids)} focusTitle
              album={book.kind === 'album'} onPhotoFile={(f, x, y, slot) => photoFile(page.id, { x, y }, slot)(f)} onFillSlot={fillSlot} />
            : <CoverFace key={'cover' + book.id} book={book} onChange={updateBook} />}
        </div>
        <div className="coil" />
      </div>
      </div>
      </>}
    </main>
    {!home && at >= 0 && <button className="chunky turn prev" title={(at ? 'Previous page' : 'Back to the cover') + ' (Alt+←)'}
      aria-label={at ? 'Previous page' : 'Back to the cover'} onClick={prev}>‹</button>}
    {!home && <button className="chunky turn next" title={(at < 0 ? 'Open the book' : at < last ? 'Next page' : 'Add a page') + ' (Alt+→)'}
      aria-label={at < 0 ? 'Open the book' : at < last ? 'Next page' : 'Add a page'} onClick={next}>{at === last ? '＋' : '›'}</button>}
    {!home && page && <div className="folio">{book.title || 'Untitled book'} · {at ? `pp. ${at}–${at + 1}` : 'p. 1'} of {last + 1}</div>}
    {!home && page && <div className="dock" role="toolbar" aria-label="Drag onto the page">
      {PHOTO_TOOLS.map(([k, icon, label]) => (
        <div key={k} className={`chip card-chip ${k}-tool`} role="button" tabIndex={0} title={label} draggable={k === 'sticker'}
          onClick={() => photoTool(k)} onKeyDown={e => e.key === 'Enter' && photoTool(k)}
          onDragStart={e => e.dataTransfer.setData(CARD_MIME, k)}>
          <span className="ic">{icon}</span>{label}
        </div>
      ))}
      <span className="dock-sep" />
      {CARDS.map(([k, icon, label]) => (
        <div key={k} className={`chip card-chip ${k}-chip`} draggable role="button" tabIndex={0} title={`Click or drag to add a ${label.toLowerCase()}`}
          onClick={() => addCard(k)} onKeyDown={e => e.key === 'Enter' && addCard(k)} onDragStart={e => e.dataTransfer.setData(CARD_MIME, k)}>
          <span className="ic">{icon}</span>{label}
        </div>
      ))}
      <span className="dock-sep" />
      {Object.entries(TYPES).map(([t, [label, icon]]) => (
        <div key={t} className="chip" draggable title={`Drag a ${label.toLowerCase()} block onto the page`}
          onDragStart={e => { e.dataTransfer.setData(PALETTE_MIME, t); e.dataTransfer.effectAllowed = 'copyMove' }}>
          <span className="ic">{icon}</span>{label}
        </div>
      ))}
    </div>}
    <input ref={photoIn} type="file" accept="image/*" multiple hidden
      onChange={e => { // into the frame that asked for it (first picture), anything else onto the page
        const t = fillTarget.current, files = [...e.target.files]
        fillTarget.current = null
        files.forEach((f, i) => photoFile(t?.pageId ?? page.id, null, i ? null : t?.slot)(f))
        e.target.value = ''
      }} />
    {booth && <Photobooth onClose={() => setBooth(false)}
      onDone={async shot => { setBooth(false); await addPhoto(booth.pageId, shot, null, booth.slot); toast('Stuck in!', '📸') }} />}
    <Island pages={db.books.flatMap(b => b.pages.map(p => ({ ...p, book: b.title || 'Untitled book' })))}
      title={home ? 'Shelves' : page ? page.title || 'Untitled' : book.title || 'Untitled book'} openPage={openPage}
      newPage={q => { if (home) { arrive.current = true; setHome(false) } addPage(q) }} />
  </>
}
