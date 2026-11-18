// The Chrome add-on for bahn.de: where to get it and whether this device can install it.
export const ADDON_STORE = "https://chromewebstore.google.com/detail/hkoaajnnlmdnbnmkllghpnbidcjffppd"
export const ADDON_ZIP = '/kurt-extension.zip'
export const ADDON_SOURCE = 'https://github.com/flix-wg/spaetkauf/tree/main/extension'

const KEY = 'spaetkauf.addonCard'

// Phones and tablets cannot install Chrome extensions. iPadOS reports a Mac, so touch decides there.
export function isPhone(ua: string, touchPoints = 0) {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
}

export function onPhone() {
  return typeof navigator !== 'undefined' && isPhone(navigator.userAgent, navigator.maxTouchPoints)
}

export function cardHidden() {
  try {
    return localStorage.getItem(KEY) === 'hidden'
  } catch {
    return false
  }
}

export function hideCard() {
  try {
    localStorage.setItem(KEY, 'hidden')
  } catch {
    /* storage blocked: the card comes back next visit */
  }
}
