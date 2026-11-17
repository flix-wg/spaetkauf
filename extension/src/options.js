'use strict';
  const msg = (key, fallback, ...values) => globalThis.chrome?.i18n?.getMessage(key, values.map(String)) || fallback.replace(/\$(\d+)/g, (_, n) => String(values[Number(n) - 1] ?? ''));
document.documentElement.lang = globalThis.chrome?.i18n?.getUILanguage?.()?.startsWith('de') ? 'de' : 'en';
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = msg(element.dataset.i18n, element.textContent);

const DEFAULT_SERVER = 'https://kurtfaehrt.de';
const input = document.getElementById('server');
const message = document.getElementById('message');
chrome.storage.sync.get({ server: DEFAULT_SERVER }).then(config => { input.value = config.server; });
async function save(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/\.+$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(msg("originRequired", "Enter an http(s) server origin without a path, credentials, query or fragment."));
    if (/(^|\.)(bahn\.de|db\.de|bahn\.com|deutschebahn\.com)$/i.test(hostname)) throw new Error(msg("noDB", "Use a Kurt server, not a Deutsche Bahn host."));
    const origin = url.origin + '/*';
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(hostname)) throw new Error(msg("httpLocal", "HTTP is supported only for localhost or 127.0.0.1. Use HTTPS for a custom server."));
    if (!await chrome.permissions.request({ origins: [origin] })) throw new Error(msg("accessDenied", "Server access was not granted."));
    await chrome.storage.sync.set({ server: url.origin });
    input.value = url.origin;
    message.textContent = msg("saved", "Saved");
  } catch (error) { message.textContent = error instanceof TypeError ? msg('invalidServer', 'Invalid Kurt server URL') : error.message; }
}
document.getElementById('settings').addEventListener('submit', event => { event.preventDefault(); save(input.value); });
document.getElementById('reset').addEventListener('click', () => save(DEFAULT_SERVER));
