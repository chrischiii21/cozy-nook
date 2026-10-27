// Data model + storage. Same format as the old MyNotes.html, so its backups import here.

const KEY = 'mynotes.v1' // the shelf from before the lock; read once to move it into the vault (vault.js), never written
export const PALETTE_MIME = 'application/x-note-block'
export const CARD_MIME = 'application/x-note-card'

export const uid = () => Math.random().toString(36).slice(2, 10)
export const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export const textLen = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.length }

export const TYPES = {
  text: ['Text', 'Aa'], h1: ['Heading 1', 'H1'], h2: ['Heading 2', 'H2'], h3: ['Heading 3', 'H3'],
  bullet: ['Bulleted list', '•'], number: ['Numbered list', '1.'], todo: ['To-do', '☐'],
  quote: ['Quote', '❝'], callout: ['Callout', '💡'], divider: ['Divider', '—'],
}
export const SHORTCUTS = [
  [/^#\s/, 'h1'], [/^##\s/, 'h2'], [/^###\s/, 'h3'], [/^[-*]\s/, 'bullet'], [/^1[.)]\s/, 'number'],
  [/^\[ ?\]\s/, 'todo'], [/^>\s/, 'quote'], [/^---$/, 'divider'],
]
export const CONTINUE = ['bullet', 'number', 'todo']

// group/col: blocks sharing a group sit side by side, col picks the column
export const blk = (type = 'text', html = '', extra) => ({ id: uid(), type, html, ...extra })
export const emptyPage = (title = '') => ({ id: uid(), icon: '📄', title, blocks: [blk()] })

// page.cards float freely over the page: a 'box' (container) holds blocks, a 'sticky' holds text.
// x, y, w, h in px relative to the page column; z = stacking order.
export const BOX_COLORS = ['blue', 'yellow', 'green', 'pink', 'purple', 'brown', 'gray']
export const STICKY_COLORS = ['lemon', 'peach', 'mint', 'sky', 'lilac']
// photo: img = id of the picture in IndexedDB (photos.js), strip = a photo-booth strip (has its own frame)
// sticker: one big emoji
// (cx, y) = where the card's top-center lands; extra overrides the defaults (size, img, emoji…)
const tilt = () => Math.round(Math.random() * 6 - 3)
export function newCard(kind, cx, y, extra) {
  const c = {
    box: { kind, w: 380, h: 240, color: 'blue', title: '', blocks: [blk('todo')] },
    sticky: { kind, w: 210, h: 190, color: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)], html: '', tilt: tilt() },
    photo: { kind, w: 230, h: 230, img: '', caption: '', tilt: tilt() },
    sticker: { kind, w: 110, h: 110, emoji: '⭐', tilt: tilt() * 3 },
  }[kind]
  Object.assign(c, extra)
  return { id: uid(), x: Math.round(cx - c.w / 2), y: Math.max(0, Math.round(y)), ...c }
}
export const withCard = (p, c) => ({ ...p, cards: [...p.cards ?? [], c] })

const welcome = () => {
  const g = uid()
  return {
    id: uid(), icon: '👋', title: 'Getting started', blocks: [
      blk('text', 'Click anywhere and start typing. Everything saves automatically in this browser.'),
      blk('callout', 'Type <b>/</b> on an empty line to pick a block type.', { group: g, col: 0 }),
      blk('callout', 'Or drag one out of the <b>toolbox</b> at the bottom of the screen.', { group: g, col: 1 }),
      blk('h3', 'Customize the layout'),
      blk('bullet', 'Drag <b>⋮⋮</b> above or below another block to reorder'),
      blk('bullet', 'Drop on the <b>left or right edge</b> of a block to put them side by side in columns'),
      blk('bullet', 'Click <b>⋮⋮</b> to align, duplicate, delete or turn a block into another type'),
      blk('bullet', 'Add a <b>Container</b> or <b>Sticky note</b> from the toolbox, drag its top bar to move it, its corner to resize, the rainbow dot to recolor'),
      blk('h3', 'Shortcuts'),
      blk('bullet', '<b>#</b>, <b>##</b>, <b>###</b> + space → headings · <b>-</b> bullets · <b>1.</b> numbered · <b>[]</b> to-do · <b>&gt;</b> quote · <b>---</b> divider'),
      blk('bullet', '<b>Ctrl+B / I / U</b> bold, italic, underline · <b>Ctrl+\\</b> toggle sidebar'),
      blk('bullet', '<b>‹ ›</b> on the sides or <b>Alt+← / Alt+→</b> turn pages · <b>›</b> on the last page adds a new one'),
      blk('bullet', 'Click a book on your shelf to see and design its <b>cover</b> · <b>＋ Notebook</b> or <b>＋ Album</b> on a shelf starts another'),
      blk('bullet', '<b>Photo</b>, <b>Photobooth</b> and <b>Sticker</b> in the toolbox scrapbook any page; or drag pictures in from your computer'),
      blk('bullet', '<b>Ctrl+K</b> jump to any page in any book · click the black island at the top for the Pomodoro timer'),
      blk('todo', 'Check me off'),
      blk('divider'),
      blk('quote', 'Use <b>Export backup</b> in the sidebar now and then. Clearing browser data clears your notes.'),
    ],
  }
}

// Renumber columns to 0..n per group; a group left with one column becomes plain blocks again.
export function tidy(bs) {
  const cols = {}
  for (const x of bs) if (x.group) (cols[x.group] ??= new Set()).add(x.col)
  return bs.map(x => {
    if (!x.group) return x
    const sorted = [...cols[x.group]].sort((a, b) => a - b)
    if (sorted.length > 1) return { ...x, col: sorted.indexOf(x.col) }
    const { group, col, ...plain } = x
    return plain
  })
}

// Move (or insert) block m relative to target. zone: above | below | left | right | end
export function placeBlock(bs, m, targetId, zone) {
  const rest = bs.filter(x => x.id !== m.id)
  const { group, col, ...plain } = m
  if (zone === 'end') return tidy([...rest, plain])
  const i = rest.findIndex(x => x.id === targetId), t = rest[i]
  if (zone === 'above' || zone === 'below') {
    rest.splice(zone === 'below' ? i + 1 : i, 0, t.group ? { ...plain, group: t.group, col: t.col } : plain)
    return tidy(rest)
  }
  const g = t.group ?? uid(), c = t.group ? t.col : 0
  rest[i] = { ...t, group: g, col: c }
  rest.splice(zone === 'left' ? i : i + 1, 0, { ...plain, group: g, col: c + (zone === 'left' ? -0.5 : 0.5) })
  return tidy(rest)
}

// db = { shelves: [{ id, name }], books: [{ id, title, shelf, cover, pages }], current: book id, page: page id | null (null = the cover) }
// A book's place on its shelf is its order in db.books.
export const COVER_COLORS = ['#ff5a36', '#ffd23f', '#7cc6fe', '#6ee7b7', '#c4b5fd', '#ff8fc7', '#2f6f4f', '#23395d', '#c9a46a', '#1d1b18']
export const PATTERNS = ['plain', 'dots', 'stripes', 'grid', 'checker']
export const STICKERS = ['📓', '🌷', '⭐', '🍓', '🐻', '🌙', '☕', '🚀', '💼', '🎧', '🌈', '🍀']
// Album pages start laid out: empty photo frames (photo cards with no img yet) in one of these arrangements.
// Coordinates are on the 525×700 paper, below the page title. Everything stays movable afterwards.
export const LAYOUTS = [
  { name: 'Hero', slots: [{ x: 58, y: 168, w: 410, h: 290, tilt: -1 }, { x: 58, y: 472, w: 190, h: 200, tilt: -3 }, { x: 276, y: 476, w: 190, h: 200, tilt: 2 }] },
  { name: 'Grid', slots: [{ x: 52, y: 170, w: 205, h: 240, tilt: -2 }, { x: 270, y: 174, w: 205, h: 240, tilt: 2 }, { x: 56, y: 426, w: 205, h: 240, tilt: 1 }, { x: 266, y: 430, w: 205, h: 240, tilt: -1 }] },
  { name: 'Scattered', slots: [{ x: 40, y: 172, w: 240, h: 260, tilt: -5 }, { x: 250, y: 232, w: 225, h: 250, tilt: 4 }, { x: 96, y: 440, w: 260, h: 236, tilt: -2 }] },
  { name: 'Duo', slots: [{ x: 60, y: 175, w: 405, h: 240, tilt: 1 }, { x: 60, y: 430, w: 405, h: 240, tilt: -1 }] },
]
const frame = s => ({ id: uid(), kind: 'photo', img: '', caption: '', ...s })
export const albumPage = (title = '', layout = 0) => ({ ...emptyPage(title), icon: '📷', layout, cards: LAYOUTS[layout].slots.map(frame) })

// Switch a page to another layout: its photos move into the new frames in order (captions kept), empty frames
// are redrawn for the rest; photos beyond the frames, booth strips and everything else stay where they are.
export function applyLayout(page, layout) {
  const slots = LAYOUTS[layout].slots, cards = page.cards ?? []
  const isFrame = c => c.kind === 'photo' && !c.strip, photos = cards.filter(c => isFrame(c) && c.img)
  return {
    ...page, layout,
    cards: [...cards.filter(c => !isFrame(c)), ...slots.map((s, i) => photos[i] ? { ...photos[i], ...s } : frame(s)), ...photos.slice(slots.length)],
  }
}

// kind: 'album' = photo album / scrapbook (warm scrapbook paper, laid-out photo frames); otherwise a notebook
export const emptyBook = (title = '', shelf, kind) => ({
  id: uid(), title, shelf, ...(kind === 'album' && { kind }), pages: [kind === 'album' ? albumPage() : emptyPage()],
  cover: { color: COVER_COLORS[Math.floor(Math.random() * 6)], pattern: kind === 'album' ? 'plain' : 'dots', sticker: kind === 'album' ? '📷' : '📓', subtitle: '', band: kind !== 'album' },
})

// Old saves/backups were one flat page list (+ current page id): it becomes the "My Notebook" book.
// Every book stands on a real shelf (books from before shelves go on "My shelf").
// Then make sure current points at a real book, and page at one of its pages or the cover.
export function normalize(d) {
  if (!d.books) {
    const b = { ...emptyBook('My Notebook'), pages: d.pages }
    d = { books: [b], current: b.id, page: d.current }
  }
  const shelves = d.shelves?.length ? d.shelves : [{ id: uid(), name: 'My shelf' }], ids = new Set(shelves.map(s => s.id))
  const books = d.books.map(x => ids.has(x.shelf) ? x : { ...x, shelf: shelves[0].id })
  const b = books.find(x => x.id === d.current) ?? books[0]
  return { ...d, shelves, books, current: b.id, page: b.pages.some(p => p.id === d.page) ? d.page : null }
}

export function load() {
  try {
    const db = JSON.parse(localStorage.getItem(KEY))
    if (isBackup(db)) return normalize(db)
  } catch { /* corrupt storage: start fresh */ }
  const shelf = { id: uid(), name: 'My shelf' }, b = { ...emptyBook('Getting started', shelf.id), pages: [welcome()] }
  b.cover = { ...b.cover, sticker: '👋', subtitle: 'open me ✿' }
  return { shelves: [shelf], books: [b], current: b.id, page: null }
}
const isPages = ps => Array.isArray(ps) && ps.length > 0 && ps.every(p => p.id && Array.isArray(p.blocks))
export const isBackup = d => Array.isArray(d?.books) ? d.books.length > 0 && d.books.every(b => b.id && isPages(b.pages)) : isPages(d?.pages)
