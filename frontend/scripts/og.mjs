// Renders the share images public/og.png (German) and public/og-en.png, 1200×630, plus public/favicon.ico.
// Run once: node scripts/og.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`).toString('base64')}`
const css = `
@font-face { font-family: Display; font-weight: 700; src: url(${font('space-grotesk', 'space-grotesk-latin-700-normal.woff2')}); }
@font-face { font-family: Text; font-weight: 600; src: url(${font('inter', 'inter-latin-600-normal.woff2')}); }
body { margin: 0; }
.card { position: relative; width: 1200px; height: 630px; overflow: hidden; background: #FD4F00; color: #14161A; font-family: Text; }
.word { position: absolute; left: 80px; top: 64px; font: 700 132px/1 Display; letter-spacing: -0.02em; }
.line { position: absolute; left: 84px; top: 236px; width: 600px; font-size: 44px; line-height: 1.18; letter-spacing: -0.01em; }
.url { position: absolute; left: 84px; bottom: 60px; font-size: 30px; padding: 10px 22px; border-radius: 999px; background: #14161A; color: #fff; }
.trail { position: absolute; left: 640px; right: 0; bottom: 118px; height: 14px; border-radius: 7px 0 0 7px; background: rgba(255,255,255,.45); }
svg { position: absolute; right: 70px; bottom: 96px; width: 420px; }
`
// Kurt from index.html, with a white shell so it reads on orange.
const kurt = `<svg viewBox="0 0 80 60"><path fill="#14161a" d="M14 54 C8 54 4.5 51.5 4.5 47 L4.5 33 C4.5 24 19 24 19 33 L19 40 C19 43.5 21 45 24 45 L64 45 C70 45 74 47 77 52.5 C75.5 53.5 73.5 54 70 54 Z"/><path d="M9 26 L7.2 14.5 M15 26 L21.5 13.5" stroke="#14161a" stroke-width="2.6" stroke-linecap="round"/><circle cx="7.2" cy="10.5" r="4.4" fill="#14161a"/><circle cx="6" cy="9.2" r="1.4" fill="#fff"/><circle cx="21.5" cy="9.5" r="4.4" fill="#14161a"/><circle cx="20.3" cy="8.2" r="1.4" fill="#fff"/><path d="M7.5 33.5 q2.4 2.4 5 0.6" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="46" cy="27" r="19" fill="#fff" stroke="#14161a" stroke-width="2.6"/><path d="M47.5 28 a2.3 2.3 0 0 0 -4.6 0 a4.6 4.6 0 0 0 9.2 0 a6.9 6.9 0 0 0 -13.8 0 a9.2 9.2 0 0 0 18.4 0 a11.5 11.5 0 0 0 -23 0" stroke="#14161a" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`

const cards = [
  ['og.png', 'Buch den günstigen Zug, der meistens zu spät kommt. Fahr mit dem besseren.'],
  ['og-en.png', 'Buy the cheap ticket for the train that’s usually late. Ride the better one.'],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
for (const [name, line] of cards) {
  await page.setContent(`<style>${css}</style><div class="card"><div class="word">Kurt</div><div class="line">${line}</div><div class="url">kurtfaehrt.de</div><div class="trail"></div>${kurt}</div>`)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `public/${name}` })
}
// favicon.ico for clients that ask for it by name: one 32px PNG inside an ICO container.
await page.setViewportSize({ width: 32, height: 32 })
await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${readFileSync('public/icon-192.png').toString('base64')}" width="32" height="32"></body>`)
const png = await page.screenshot()
const head = Buffer.alloc(22)
head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); head.writeUInt8(32, 6); head.writeUInt8(32, 7)
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18)
writeFileSync('public/favicon.ico', Buffer.concat([head, png]))
await browser.close()
