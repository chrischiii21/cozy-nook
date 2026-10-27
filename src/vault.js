// Your notes, encrypted at rest. Password → PBKDF2 (SHA-256, 600k rounds, random salt) → AES-256-GCM key that can't be
// exported and lives only in memory while Nook is unlocked. localStorage only ever holds the sealed shelf.
// A wrong password can't decrypt (GCM's check fails), so there's no password hash stored anywhere.
const VAULT = 'nook.vault', PLAIN = 'mynotes.v1' // PLAIN: the pre-lock, unencrypted shelf (moved in on setup)
const ROUNDS = 600_000

const b64 = buf => { // chunked: spreading a big array into fromCharCode would overflow the stack
  const a = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes) }
}
export const unseal = (key, { iv, data }) => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)

async function writeVault(key, salt, db) {
  const { iv, data } = await seal(key, new TextEncoder().encode(JSON.stringify(db)))
  localStorage.setItem(VAULT, JSON.stringify({ v: 1, salt, iv: b64(iv), data: b64(data) }))
}

// Saves run one at a time, in order (an older save can never land after a newer one).
// rekey (change password) runs in the same line, so no save uses a half-changed key.
function makeVault(key, salt) {
  let line = Promise.resolve()
  const next = job => (line = line.catch(() => {}).then(job))
  const v = {
    key,
    save: db => next(() => writeVault(v.key, salt, db)),
    rekey: (password, db, reseal) => next(async () => {
      const s = b64(crypto.getRandomValues(new Uint8Array(16))), k = await deriveKey(password, unb64(s))
      await reseal(v.key, k) // photos first: if that fails, the shelf still opens with the old password
      await writeVault(k, s, db)
      v.key = k
      salt = s
    }),
  }
  return v
}

export const hasVault = () => { try { return !!localStorage.getItem(VAULT) } catch { return false } }
export const hasPlainShelf = () => { try { return !!localStorage.getItem(PLAIN) } catch { return false } }

// → { db, vault }; throws on a wrong password
export async function unlock(password) {
  const sealed = JSON.parse(localStorage.getItem(VAULT)), key = await deriveKey(password, unb64(sealed.salt))
  let bytes
  try { bytes = await unseal(key, { iv: unb64(sealed.iv), data: unb64(sealed.data) }) } catch { throw Error('Wrong password') }
  return { db: JSON.parse(new TextDecoder().decode(bytes)), vault: makeVault(key, sealed.salt) }
}

// First lock: seal the current shelf, and only then drop the unencrypted copy
export async function createVault(password, db) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16))), key = await deriveKey(password, unb64(salt))
  await writeVault(key, salt, db)
  localStorage.removeItem(PLAIN)
  return makeVault(key, salt)
}

// Forgot the password: there's no way back in, only starting over
export const eraseVault = () => { localStorage.removeItem(VAULT); localStorage.removeItem(PLAIN) }
