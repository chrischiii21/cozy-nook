import { Field } from './Cover'

const BOOK_MIME = 'application/x-nook-book'

// A book's spine: its cover color and pattern, a height that's its own (from its id, so it never jumps),
// thicker the more pages it has, and title ink that stays readable on dark covers.
function spineStyle(b) {
  const h = [...b.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)
  const [r, g, bl] = [1, 3, 5].map(i => parseInt(b.cover.color.slice(i, i + 2), 16))
  return {
    '--cover': b.cover.color, '--sh': 172 + Math.abs(h) % 44 + 'px', // albums are chunkier
    '--sw': (b.kind === 'album' ? 50 : 38) + Math.min(b.pages.length, 20) * 1.4 + 'px',
    color: r * .299 + g * .587 + bl * .114 > 150 ? '#1f1d1a' : '#fff',
  }
}

// Home: the bookcase you see when Nook opens. Shelves of books; drag a book to move it, click to open it.
export default function Shelves({ db, onOpen, onNewBook, onMove, onAddShelf, onRenameShelf, onDeleteShelf, actions }) {
  const hour = new Date().getHours(), n = db.books.length, s = db.shelves.length
  const drop = (e, shelf, before) => {
    const id = e.dataTransfer.getData(BOOK_MIME)
    if (!id || id === before) return
    e.preventDefault()
    e.stopPropagation()
    onMove(id, shelf, before)
  }
  return (
    <div className="home">
      <header className="home-head">
        <div className="home-actions">{actions}</div>
        <h1>{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</h1>
        <p>{n} book{n === 1 ? '' : 's'} on {s} shel{s === 1 ? 'f' : 'ves'} · pick one to open it, drag one to move it</p>
      </header>
      {db.shelves.map(shelf => {
        const books = db.books.filter(b => b.shelf === shelf.id)
        return (
          <section key={shelf.id} className="shelf-unit"
            onDragOver={e => e.dataTransfer.types.includes(BOOK_MIME) && e.preventDefault()} onDrop={e => drop(e, shelf.id, null)}>
            <div className="shelf-name">
              <Field className="shelf-title" value={shelf.name} ph="Name this shelf" autoFocus={!shelf.name}
                onText={name => onRenameShelf(shelf.id, name)} />
              <span className="shelf-count">{books.length}</span>
              {s > 1 && <button className="del" title="Remove shelf" aria-label="Remove shelf" onClick={() => onDeleteShelf(shelf)}>×</button>}
            </div>
            <div className="shelf-row">
              {books.map(b => (
                <div key={b.id} className="spine-slot">
                  <button className={`spine pat-${b.cover.pattern}`} style={spineStyle(b)} draggable
                    title={`${b.title || 'Untitled book'} · ${b.pages.length} page${b.pages.length === 1 ? '' : 's'}`}
                    aria-label={`Open ${b.title || 'Untitled book'}`} onClick={() => onOpen(b.id)}
                    onDragStart={e => { e.dataTransfer.setData(BOOK_MIME, b.id); e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={e => e.dataTransfer.types.includes(BOOK_MIME) && e.preventDefault()}
                    onDrop={e => drop(e, shelf.id, b.id)}>
                    <span className="st">{b.cover.sticker}</span><span className="tt">{b.title || 'Untitled'}</span>
                  </button>
                </div>
              ))}
              {[['notebook', 'Notebook'], ['album', 'Album']].map(([kind, label]) => (
                <div key={kind} className="spine-slot">
                  <button className="spine add" onClick={() => onNewBook(shelf.id, kind)} title={`New ${label.toLowerCase()} on this shelf`}>
                    <span className="st">＋</span><span className="tt">{label}</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )
      })}
      <button className="chunky add-shelf" onClick={onAddShelf}>＋ Add a shelf</button>
    </div>
  )
}
