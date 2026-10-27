// Run: node src/notes.check.js
import assert from 'node:assert/strict'
import { placeBlock, blk, normalize, isBackup, albumPage, applyLayout, LAYOUTS } from './notes.js'

const [a, b, c] = ['a', 'b', 'c'].map(id => ({ ...blk(), id }))
const ids = bs => bs.map(x => x.id).join('')

assert.equal(ids(placeBlock([a, b, c], a, 'c', 'below')), 'bca')
assert.equal(ids(placeBlock([a, b, c], c, 'a', 'above')), 'cab')

// side by side: a | b
let bs = placeBlock([a, b, c], b, 'a', 'right')
assert.equal(ids(bs), 'abc')
assert.ok(bs[0].group && bs[0].group === bs[1].group)
assert.deepEqual([bs[0].col, bs[1].col], [0, 1])

// c dropped below b joins b's column
bs = placeBlock(bs, c, 'b', 'below')
assert.deepEqual(bs.map(x => x.col), [0, 1, 1])

// third column on the left of a: c | a | b
bs = placeBlock(bs, c, 'a', 'left')
assert.equal(ids(bs), 'cab')
assert.deepEqual(bs.map(x => x.col), [0, 1, 2])

// pulling blocks out until one column is left dissolves the group
bs = placeBlock(bs, c, null, 'end')
bs = placeBlock(bs, b, null, 'end')
assert.ok(bs.every(x => !x.group), 'single-column group should dissolve')

// old flat-page saves become one book, staying on the page that was open
const old = { pages: [{ id: 'a', blocks: [a] }, { id: 'b', blocks: [b] }], current: 'b' }
assert.ok(isBackup(old))
let db = normalize(old)
assert.equal(db.books.length, 1)
assert.equal(ids(db.books[0].pages), 'ab')
assert.equal(db.current, db.books[0].id)
assert.equal(db.page, 'b')
assert.ok(isBackup(db))
// …and stands on a shelf; a book on a shelf that's gone moves to the first one
assert.equal(db.shelves.length, 1)
assert.equal(db.books[0].shelf, db.shelves[0].id)
const lost = normalize({ ...db, books: [...db.books, { ...db.books[0], id: 'x', shelf: 'gone' }] })
assert.equal(lost.books[1].shelf, db.shelves[0].id)
// a stale page id falls back to the cover, a stale book id to the first book
db = normalize({ ...db, current: 'gone', page: 'gone' })
assert.equal(db.current, db.books[0].id)
assert.equal(db.page, null)
assert.ok(!isBackup({ books: [] }) && !isBackup({ pages: [] }))

// album layouts: a new page is all empty frames; switching keeps photos (and captions) in order,
// leaves strips/stickers alone, and never loses a photo when the new layout has fewer frames
let pg = albumPage('Trip', 1) // Grid: 4 frames
assert.equal(pg.cards.length, 4)
assert.ok(pg.cards.every(c => c.kind === 'photo' && !c.img))
pg.cards[0] = { ...pg.cards[0], img: 'a', caption: 'beach' }
pg.cards[2] = { ...pg.cards[2], img: 'b' }
pg.cards.push({ id: 's', kind: 'sticker', emoji: '🌴', x: 1, y: 1, w: 9, h: 9 }, { id: 't', kind: 'photo', img: 'c', strip: true, x: 5, y: 5, w: 9, h: 9 })
const duo = applyLayout(pg, 3) // Duo: 2 frames
const framesOf = p => p.cards.filter(c => c.kind === 'photo' && !c.strip)
assert.deepEqual(framesOf(duo).map(c => c.img), ['a', 'b'])
assert.equal(framesOf(duo)[0].caption, 'beach')
assert.deepEqual([framesOf(duo)[0].x, framesOf(duo)[0].y], [LAYOUTS[3].slots[0].x, LAYOUTS[3].slots[0].y])
assert.ok(duo.cards.some(c => c.id === 's') && duo.cards.find(c => c.id === 't').x === 5)
pg.cards.push({ ...pg.cards[0], id: 'x', img: 'd' }, { ...pg.cards[0], id: 'y', img: 'e' }) // 4 photos now
const fewer = applyLayout(pg, 3) // only 2 frames: the extra photos stay on the page
assert.deepEqual(framesOf(fewer).map(c => c.img).sort(), ['a', 'b', 'd', 'e'])

console.log('notes.check: ok')
