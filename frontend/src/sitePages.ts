// Build step: writes the indexable pages (landing DE/EN, legal, 404) and sitemap, llms.txt, robots.txt and
// _redirects from the built index.html, so crawlers get real text without running JavaScript.
import type { Plugin } from 'vite'
import type { Lang } from './i18n-core.ts'
import { COPY, LLMS_TXT, META, ORIGIN, esc, jsonLd, landingHtml, landingPath, legalPageHtml, type LegalPage } from './site.ts'

// Screens that only make sense in the running app. They get the app shell, kept out of the index.
const APP_ROUTES = ['/picks', '/trips', '/trips/*', '/trip/*', '/late', '/lookup']

// Search engines and the bots that fetch pages to answer a question are welcome. Bots that only collect
// training data are not. Based on Cloudflare's managed list; user-triggered fetchers fall under *.
const ALLOW_BOTS = [
  'Googlebot', 'Bingbot', 'Applebot', 'DuckAssistBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot',
  'Perplexity-User', 'Claude-SearchBot', 'Claude-User', 'Google-Extended', 'Applebot-Extended',
]
const BLOCK_BOTS = [
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'CCBot', 'Bytespider', 'meta-externalagent', 'Amazonbot',
  'cohere-ai', 'MistralAI-Training', 'Diffbot', 'omgili', 'GoogleOther', 'Google-CloudVertexBot', 'Baiduspider',
  'PetalBot', 'AwarioSmartBot', 'AwarioRssBot', 'QualifiedBot', 'Cotoyogi', 'ICC-Crawler', 'atlassian-bot',
  'FishBot', 'BorderxBot', 'NavuBot', 'SemrushBot-SWA', 'WARDBot', 'magpie-crawler', 'KimiBot',
  'CitibotSiteCrawler', 'FireCrawl', 'FirecrawlAgent', 'ChathiveCrawler',
]

const group = (bots: string[], rule: string) => bots.map((bot) => `User-agent: ${bot}`).join('\n') + `\n${rule}\n`

function robotsTxt() {
  return [group(ALLOW_BOTS, 'Allow: /'), group(BLOCK_BOTS, 'Disallow: /'), group(['*'], 'Allow: /'), `Sitemap: ${ORIGIN}/sitemap.xml\n`].join('\n')
}

interface Page { lang: Lang; title: string; description: string; path?: string; alternates?: boolean; body: string; ld?: object }

function render(shell: string, p: Page) {
  const url = p.path && ORIGIN + p.path
  const image = `${ORIGIN}/og${p.lang === 'de' ? '' : '-en'}.png`
  const head = [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    url ? `<link rel="canonical" href="${url}" />` : '<meta name="robots" content="noindex" />',
    ...(p.alternates
      ? (['de', 'en'] as Lang[]).map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN}${landingPath(l)}" />`)
        .concat(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/" />`)
      : []),
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Kurt" />',
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    ...(url ? [`<meta property="og:url" content="${url}" />`] : []),
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${esc(COPY[p.lang].h1)}" />`,
    `<meta property="og:locale" content="${p.lang === 'de' ? 'de_DE' : 'en_GB'}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    ...(p.ld ? [`<script type="application/ld+json">${JSON.stringify(p.ld).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('\n    ')
  return shell
    .replace(/<html lang="[^"]*">/, `<html lang="${p.lang}">`)
    .replace(/\s*<meta name="description"[^>]*>/, '')
    .replace('<title>Kurt</title>', () => head)
    .replace('<div id="root"></div>', () => `<div id="root">${p.body}</div>`)
}

export function sitePages(): Plugin {
  let env: Record<string, string> = {}
  return {
    name: 'site-pages',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      env = config.env
    },
    generateBundle(_, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') throw new Error('sitePages: index.html not in bundle')
      const shell = String(index.source)
      for (const marker of ['<title>Kurt</title>', '<div id="root"></div>', '<meta name="description"', '<html lang="'])
        if (!shell.includes(marker)) throw new Error(`sitePages: ${marker} missing from index.html`)
      const operator = {
        name: env.VITE_OPERATOR_NAME ?? '',
        address: (env.VITE_OPERATOR_ADDRESS ?? '').split(';').map((line) => line.trim()).filter(Boolean),
        email: env.VITE_OPERATOR_EMAIL ?? '',
      }
      const landing = (lang: Lang): Page => ({
        lang, ...META[lang], path: landingPath(lang), alternates: true, body: landingHtml(lang), ld: jsonLd(lang),
      })
      // Legal pages carry the operator's name, which the law requires there but nowhere else: no path, so noindex.
      const legal = (page: LegalPage, title: string, description: string): Page => ({
        lang: 'de', title, description, body: legalPageHtml(page, operator),
      })
      const notFound = '<div class="seo"><main><h1>Seite nicht gefunden</h1><p>Diese Seite gibt es nicht. <a href="/">Zu Kurt</a></p><p lang="en">This page doesn’t exist. <a href="/en/">Go to Kurt</a></p></main><footer><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></footer></div>'
      const files: Record<string, string> = {
        'index.html': render(shell, landing('de')),
        'en/index.html': render(shell, landing('en')),
        'impressum.html': render(shell, legal('impressum', 'Impressum – Kurt', 'Wer Kurt betreibt und woher die Daten kommen.')),
        'datenschutz.html': render(shell, legal('datenschutz', 'Datenschutzerklärung – Kurt', 'Welche Daten bei Kurt verarbeitet werden: keine Cookies, kein Konto, Fahrten bleiben in deinem Browser.')),
        '404.html': render(shell, { lang: 'de', title: 'Seite nicht gefunden – Kurt', description: META.de.description, body: notFound }),
        'app.html': render(shell, { lang: 'de', title: 'Kurt', description: META.de.description, body: '' }),
        'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${(['de', 'en'] as Lang[]).map((lang) => `  <url><loc>${ORIGIN}${landingPath(lang)}</loc>${(['de', 'en'] as Lang[]).map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN}${landingPath(l)}"/>`).join('')}</url>`).join('\n')}
</urlset>
`,
        'llms.txt': LLMS_TXT,
        'robots.txt': robotsTxt(),
        // Pages serves 404.html for unknown paths once it exists, so the app's own routes are rewritten to the shell.
        '_redirects': APP_ROUTES.map((route) => `${route} /app 200`).join('\n') + '\n',
      }
      index.source = files['index.html']
      for (const [fileName, source] of Object.entries(files))
        if (fileName !== 'index.html') this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
