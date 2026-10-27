// Confirmations, prompts and toasts all appear in the dynamic island (Island.jsx listens for these events).
// ask({ title, body, ok = 'OK', cancel = 'Cancel' (null = no cancel button), danger, input, secret (input hides what's typed) })
//   → true / false, or the typed text (null on cancel) when `input` is given.
export const ask = opts => new Promise(resolve => dispatchEvent(new CustomEvent('nook:ask', { detail: { ...opts, resolve } })))
// a short "done" message that pops out of the island for a moment
export const toast = (text, icon = '✓') => dispatchEvent(new CustomEvent('nook:toast', { detail: { text, icon } }))
