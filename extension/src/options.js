'use strict';
  const msg = (key, fallback, ...values) => globalThis.chrome?.i18n?.getMessage(key, values.map(String)) || fallback.replace(/\$(\d+)/g, (_, n) => String(values[Number(n) - 1] ?? ''));
document.documentElement.lang = globalThis.chrome?.i18n?.getUILanguage?.()?.startsWith('de') ? 'de' : 'en';
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = msg(element.dataset.i18n, element.textContent);

const DEFAULT_SERVER = 'https://kurtfaehrt.de';
const input = document.getElementById('server');
const message = document.getElementById('message');
const onTime = document.getElementById('onTime');
const scope = document.getElementById('scope');
const scopes = scope.querySelectorAll('input[name=scope]');

// The figure: made-up minutes late of one train over three weeks, Monday first, counted the way Kurt counts.
const RUNS = [2, 0, 12, 3, 24, 18, 1, 7, 1, 0, 16, 35, 26, 4, 3, 9, 2, 0, 21, 3, 6];
const SATURDAY = 5;
const BUCKETS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const yAt = minutes => 112 - Math.min(minutes, 40) * 2.4;
const figure = document.getElementById('runs');
const shape = (tag, attributes, text = '') => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.textContent = text;
  return figure.appendChild(node);
};
const band = shape('rect', { class: 'band', x: 30, width: 404 });
shape('line', { class: 'threshold', x1: 30, x2: 434, y1: yAt(5), y2: yAt(5) });
shape('text', { x: 24, y: yAt(5) + 4, 'text-anchor': 'end' }, '5');
const [lowLabel, highLabel] = [0, 1].map(() => shape('text', { x: 24, 'text-anchor': 'end' }));
const letters = [...msg('weekLetters', 'MTWTFSS')];
const bars = RUNS.map((minutes, i) => {
  const x = 32 + i * 18 + Math.floor(i / 7) * 10;
  shape('text', { x: x + 6, y: 130, 'text-anchor': 'middle', class: i % 7 === SATURDAY ? 'saturday' : '' }, letters[i % 7]);
  return shape('rect', { x, width: 12, rx: 2, y: yAt(minutes) - (minutes ? 0 : 2), height: Math.max(2, 112 - yAt(minutes)), class: minutes < 5 ? 'ok' : 'late' });
});
function render(value) {
  const weekday = value === 'weekday';
  const runs = RUNS.filter((_, i) => !weekday || i % 7 === SATURDAY);
  const late = runs.filter(minutes => minutes >= 5).sort((a, b) => a - b);
  const half = late.length / 2;
  const middle = late.length % 2 ? late[Math.floor(half)] : (late[half - 1] + late[half]) / 2;
  const high = BUCKETS.find(bucket => bucket > middle);
  const low = BUCKETS[BUCKETS.indexOf(high) - 1];
  bars.forEach((bar, i) => bar.classList.toggle('faded', weekday && i % 7 !== SATURDAY));
  figure.querySelectorAll('.saturday').forEach(letter => letter.classList.toggle('today', weekday));
  band.style.y = `${yAt(high)}px`;
  band.style.height = `${yAt(low) - yAt(high)}px`;
  lowLabel.setAttribute('y', yAt(low) + 4);
  lowLabel.textContent = low;
  highLabel.setAttribute('y', yAt(high) + 4);
  highLabel.textContent = high;
  document.getElementById('preview').textContent = msg('onTime', '$1 % on time', Math.round((runs.length - late.length) / runs.length * 100)) + ' · ' + msg('lateBand', 'if late, typically $1–$2 min', low, high);
  document.getElementById('scopeNote').textContent = weekday
    ? msg('scopeNoteWeekday', 'A Saturday trip counts only Saturdays: closer to your trip, but fewer runs. With too few late runs, the typical delay counts all days.')
    : value === 'route'
      ? msg('scopeNoteRoute', 'Counts every long-distance train from where you board to your stop: the most runs, but not only your train. Without enough runs on the route, it counts this train on all days.')
      : msg('scopeNoteAll', 'Counts every run of this train at your stop. More runs, steadier numbers.');
}
function showOnTime(on) {
  scope.disabled = !on;
  document.getElementById('onTimePanel').classList.toggle('off', !on);
}
render('all');
chrome.storage.sync.get({ server: DEFAULT_SERVER, showOnTime: false, onTimeScope: 'all' }).then(config => {
  input.value = config.server;
  if (config.server !== DEFAULT_SERVER) document.getElementById('advanced').open = true;
  onTime.checked = config.showOnTime === true;
  showOnTime(onTime.checked);
  const value = ['weekday', 'route'].includes(config.onTimeScope) ? config.onTimeScope : 'all';
  for (const radio of scopes) radio.checked = radio.value === value;
  render(value);
});
onTime.addEventListener('change', () => { showOnTime(onTime.checked); chrome.storage.sync.set({ showOnTime: onTime.checked }); });
for (const radio of scopes) radio.addEventListener('change', () => { render(radio.value); chrome.storage.sync.set({ onTimeScope: radio.value }); });
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
