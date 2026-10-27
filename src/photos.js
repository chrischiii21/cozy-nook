import { useEffect, useState } from 'react'
import { seal, unseal } from './vault'

// Photos live in IndexedDB: localStorage (where the notes are) holds ~5MB, a few pictures would fill it.
// Photo cards only keep the photo's id.
let opening
const store = mode => (opening ??= new Promise((res, rej) => {
  const r = indexedDB.open('nook-photos', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('photos')
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})).then(d => d.transaction('photos', mode).objectStore('photos'))
const done = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })

// Stored sealed with the shelf's key ({ iv, data }); a plain Blob is one from before the lock, sealed on unlock.
let key = null
export const setPhotoKey = k => {
  key = k
  if (!k) { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear() } // locked: forget the decrypted pictures too
}
const opened = async (v, k = key) => v instanceof Blob || !v ? v : new Blob([await unseal(k, v)], { type: 'image/jpeg' })
const put = async (id, v) => done((await store('readwrite')).put(v, id)) // one transaction per write: crypto awaits would end a shared one
export const putPhoto = async (id, blob) => put(id, await seal(key, await blob.arrayBuffer()))
export const getPhoto = async id => opened(await done((await store('readonly')).get(id)))
export const dropPhoto = async id => done((await store('readwrite')).delete(id))
export const photoIds = async () => done((await store('readonly')).getAllKeys())
export const clearPhotos = async () => done((await store('readwrite')).clear())
// every picture re-sealed: with the key for plain ones (after setup), or from an old key to a new one (password change)
export async function resealPhotos(from, to) {
  for (const id of await photoIds()) {
    const v = await done((await store('readonly')).get(id))
    if (from || v instanceof Blob) await put(id, await seal(to, await (await opened(v, from)).arrayBuffer()))
  }
}

// every photo id any card on the shelf points at
export const usedPhotos = db => new Set(db.books.flatMap(b => b.pages.flatMap(p => (p.cards ?? []).map(c => c.img).filter(Boolean))))

// object URLs, made once per photo per session
const urls = new Map()
export function usePhoto(id) {
  const [url, setUrl] = useState(() => urls.get(id))
  useEffect(() => {
    if (!id || urls.has(id)) return setUrl(urls.get(id))
    let live = true
    getPhoto(id).then(b => {
      if (!b) return
      urls.set(id, URL.createObjectURL(b))
      if (live) setUrl(urls.get(id))
    })
    return () => { live = false }
  }, [id])
  return url
}

// stored at a sensible size: longest side 1600px, JPEG
export async function shrink(blob, max = 1600) {
  const bmp = await createImageBitmap(blob), k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) })
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  return { blob: await new Promise(r => c.toBlob(r, 'image/jpeg', .86)), ratio: c.height / c.width }
}

export const toDataURL = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob) })
