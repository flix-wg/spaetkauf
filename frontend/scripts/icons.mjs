// Renders public/*.png from the Kurt SVG. Run once: node scripts/icons.mjs
import { chromium } from 'playwright'

const kurt = `<g transform="translate(SX SY) scale(SC)"><rect x="4" y="44" width="68" height="10" rx="5" fill="#14161A"/><path d="M11 46 C9 37 11 29 17 25" stroke="#14161A" stroke-width="6" stroke-linecap="round" fill="none"/><line x1="16" y1="25" x2="10" y2="11" stroke="#14161A" stroke-width="2.5" stroke-linecap="round"/><line x1="19" y1="25" x2="23" y2="10" stroke="#14161A" stroke-width="2.5" stroke-linecap="round"/><circle cx="10" cy="10" r="3.2" fill="#14161A"/><circle cx="23" cy="9" r="3.2" fill="#14161A"/><circle cx="47" cy="27" r="19" fill="#fff" stroke="#14161A" stroke-width="2.5"/><path d="M44 27 a3 3 0 1 1 6 0 a6 6 0 1 1 -12 0 a9 9 0 1 1 18 0 a12 12 0 1 1 -24 0" stroke="#14161A" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>`

const icons = [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['icon-maskable-512.png', 512, 0.58],
  ['apple-touch-icon.png', 180, 0.8],
]
const browser = await chromium.launch()
for (const [name, size, fill] of icons) {
  const sc = (size * fill) / 80
  const sx = (size - 80 * sc) / 2
  const sy = (size - 60 * sc) / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#FD4F00"/>${kurt.replace('SX', sx).replace('SY', sy).replace('SC', sc)}</svg>`
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<body style="margin:0">${svg}</body>`)
  await page.screenshot({ path: `public/${name}` })
  await page.close()
}
await browser.close()
