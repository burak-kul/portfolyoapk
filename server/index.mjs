// Dependency-free backend: public content API, password-protected admin API (Cookie + Bearer token for mobile APK),
// image & PDF uploads, direct messages inbox, dynamic SEO (sitemap.xml, robots.txt, RSS feed.xml, server-side meta/JSON-LD),
// built-in privacy-friendly analytics, and static hosting of the built site.
import http from 'node:http'
import fs from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'server', 'data')
const uploadDir = path.join(root, 'server', 'uploads')
const distDir = path.join(root, 'dist')
const contentFile = path.join(dataDir, 'content.json')
const passwordFile = path.join(dataDir, 'admin-password.txt')
const analyticsFile = path.join(dataDir, 'analytics.json')
const messagesFile = path.join(dataDir, 'messages.json')

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_JSON = 2 * 1024 * 1024
const MAX_UPLOAD = 20 * 1024 * 1024 // 20 MB (supports images + PDF files)
const MAX_HITS = 10000
const MAX_MESSAGES = 500

await fs.mkdir(dataDir, { recursive: true })
await fs.mkdir(uploadDir, { recursive: true })

const defaults = JSON.parse(await fs.readFile(path.join(root, 'server', 'default-content.json'), 'utf8'))

// ---------- storage ----------
async function writeAtomic(file, text, mode) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, text, { mode })
  await fs.rename(tmp, file)
}

// ---------- content normalisation (whitelist fields, cap sizes, validate URLs) ----------
const str = (value, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '')
const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : [])
const imageUrl = (value) => {
  const url = str(value, 300)
  return url === '' || /^\/uploads\/[A-Za-z0-9._-]+\.(png|jpg|gif|webp)$/i.test(url) ? url : ''
}
const pdfUrl = (value) => {
  const url = str(value, 300)
  return url === '' || /^\/uploads\/[A-Za-z0-9._-]+\.pdf$/i.test(url) ? url : ''
}
const statusVal = (value) => (value === 'draft' ? 'draft' : 'published')
const linkUrl = (value) => {
  const url = str(value, 300)
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : ''
}
const id = (value) => {
  const clean = str(value, 80).replace(/[^A-Za-z0-9_-]/g, '')
  return clean || crypto.randomBytes(5).toString('hex')
}
const date = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(str(value, 10)) ? value : new Date().toISOString().slice(0, 10))
const page = (value, fallback) => ({
  kicker: str(value?.kicker, 80) || fallback.kicker,
  titleMain: str(value?.titleMain, 80),
  titleAccent: str(value?.titleAccent, 80),
  intro: str(value?.intro, 600),
})

function normalize(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid content')
  const { landing = {}, work = {}, notes = {}, about = {}, contact = {} } = input

  const categories = [...new Set(list(notes.categories, 50).map((c) => str(c, 60).trim()).filter(Boolean))]
  const projectIds = new Set()
  const noteIds = new Set()
  const unique = (seen, value) => {
    let next = id(value)
    while (seen.has(next)) next = crypto.randomBytes(5).toString('hex')
    seen.add(next)
    return next
  }

  return {
    landing: {
      firstName: str(landing.firstName, 60),
      lastName: str(landing.lastName, 60),
      statement: str(landing.statement, 200),
      sideNote: str(landing.sideNote, 300),
      latestCardLabel: str(landing.latestCardLabel, 60),
      noNoteText: str(landing.noNoteText, 120),
      tableKicker: str(landing.tableKicker, 60),
    },
    work: {
      ...page(work, defaults.work),
      emptyText: str(work.emptyText, 200),
      projects: list(work.projects, 200).map((p) => ({
        id: unique(projectIds, p?.id),
        title: str(p?.title, 150),
        summary: str(p?.summary, 400),
        description: str(p?.description, 40000),
        cover: imageUrl(p?.cover),
        images: list(p?.images, 40).map(imageUrl).filter(Boolean),
        status: statusVal(p?.status),
      })),
    },
    notes: {
      ...page(notes, defaults.notes),
      categories,
      items: list(notes.items, 2000).map((n) => ({
        id: unique(noteIds, n?.id),
        title: str(n?.title, 200),
        date: date(n?.date),
        categories: [...new Set(list(n?.categories, 20).map((c) => str(c, 60)).filter((c) => categories.includes(c)))],
        cover: imageUrl(n?.cover),
        body: str(n?.body, 150000),
        pdf: pdfUrl(n?.pdf),
        references: list(n?.references, 50).map((r) => str(r, 500).trim()).filter(Boolean),
        status: statusVal(n?.status),
      })),
    },
    about: {
      ...page(about, defaults.about),
      body: str(about.body, 40000),
      interests: list(about.interests, 30).map((i) => str(i, 80).trim()).filter(Boolean),
    },
    contact: {
      ...page(contact, defaults.contact),
      text: str(contact.text, 600),
      links: list(contact.links, 20)
        .map((l) => ({ label: str(l?.label, 60), value: str(l?.value, 120), href: linkUrl(l?.href) }))
        .filter((l) => l.label && l.href),
    },
  }
}

async function readContent() {
  try {
    return normalize(JSON.parse(await fs.readFile(contentFile, 'utf8')))
  } catch {
    return normalize(defaults)
  }
}
if (!existsSync(contentFile)) await writeAtomic(contentFile, JSON.stringify(normalize(defaults), null, 2))

/** Strip draft projects and notes for public visitors. */
function publicContent(content) {
  return {
    ...content,
    work: { ...content.work, projects: content.work.projects.filter((p) => p.status !== 'draft') },
    notes: { ...content.notes, items: content.notes.items.filter((n) => n.status !== 'draft') },
  }
}

// ---------- messages inbox ----------
async function readMessages() {
  try {
    const parsed = JSON.parse(await fs.readFile(messagesFile, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ---------- analytics ----------
const tzCountry = {
  'Europe/Istanbul': 'TR (Turkey)',
  'Europe/Berlin': 'DE (Germany)',
  'Europe/London': 'GB (United Kingdom)',
  'Europe/Paris': 'FR (France)',
  'Europe/Amsterdam': 'NL (Netherlands)',
  'America/New_York': 'US (United States)',
  'America/Chicago': 'US (United States)',
  'America/Los_Angeles': 'US (United States)',
  'Asia/Tokyo': 'JP (Japan)',
  'Asia/Seoul': 'KR (South Korea)',
}

async function readHits() {
  try {
    const parsed = JSON.parse(await fs.readFile(analyticsFile, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function detectCountry(req, body) {
  const headerCountry =
    req.headers['cf-ipcountry'] ||
    req.headers['x-vercel-ip-country'] ||
    req.headers['x-country-code'] ||
    req.headers['cloudfront-viewer-country']
  if (typeof headerCountry === 'string' && headerCountry.trim() && headerCountry !== 'XX') {
    return headerCountry.trim().toUpperCase()
  }
  const tz = str(body?.tz, 60)
  if (tz && tzCountry[tz]) return tzCountry[tz]
  if (tz && tz.includes('/')) return tz
  const lang = str(body?.lang, 20)
  if (lang) return lang.toUpperCase()
  return 'Local / Unknown'
}

function detectDevice(ua = '') {
  if (/bot|crawl|spider|slurp|bingpreview/i.test(ua)) return 'Bot'
  if (/ipad|tablet/i.test(ua)) return 'Tablet'
  if (/mobi|android|iphone/i.test(ua)) return 'Mobile'
  return 'Desktop'
}

async function recordHit(req, body) {
  const ua = String(req.headers['user-agent'] || '')
  const device = detectDevice(ua)
  if (device === 'Bot') return
  const rawPath = str(body?.path, 160) || '/'
  if (rawPath.startsWith('/admin')) return
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim()
  const day = new Date().toISOString().slice(0, 10)
  const visitor = crypto.createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 12)
  const country = detectCountry(req, body)
  let referrer = 'Direct'
  const refRaw = str(body?.referrer, 300)
  if (refRaw) {
    try {
      const refHost = new URL(refRaw).hostname.replace(/^www\./, '')
      const curHost = String(req.headers.host || '').split(':')[0].replace(/^www\./, '')
      if (refHost && refHost !== curHost) referrer = refHost
    } catch {
      referrer = 'Direct'
    }
  }
  const hits = await readHits()
  hits.push({ ts: new Date().toISOString(), path: rawPath, country, device, referrer, visitor })
  while (hits.length > MAX_HITS) hits.shift()
  await writeAtomic(analyticsFile, JSON.stringify(hits))
}

function summarizeHits(hits) {
  const now = Date.now()
  const dayMs = 86400000
  const uniqueVisitors = new Set(hits.map((h) => h.visitor)).size
  const viewsLast7Days = hits.filter((h) => now - Date.parse(h.ts) <= 7 * dayMs).length
  const viewsLast30Days = hits.filter((h) => now - Date.parse(h.ts) <= 30 * dayMs).length

  const byDayMap = new Map()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * dayMs).toISOString().slice(0, 10)
    byDayMap.set(d, 0)
  }
  const pages = new Map()
  const countries = new Map()
  const devices = new Map()
  const referrers = new Map()

  for (const h of hits) {
    const d = String(h.ts).slice(0, 10)
    if (byDayMap.has(d)) byDayMap.set(d, byDayMap.get(d) + 1)
    pages.set(h.path, (pages.get(h.path) || 0) + 1)
    countries.set(h.country, (countries.get(h.country) || 0) + 1)
    devices.set(h.device, (devices.get(h.device) || 0) + 1)
    referrers.set(h.referrer || 'Direct', (referrers.get(h.referrer || 'Direct') || 0) + 1)
  }

  const top = (map, keyName, max = 10) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([k, views]) => ({ [keyName]: k, views }))

  return {
    totalViews: hits.length,
    uniqueVisitors,
    viewsLast7Days,
    viewsLast30Days,
    byDay: [...byDayMap.entries()].map(([date, views]) => ({ date, views })),
    topPages: top(pages, 'path', 10),
    countries: top(countries, 'country', 10),
    devices: top(devices, 'device', 6),
    referrers: top(referrers, 'referrer', 10),
    recent: hits.slice(-25).reverse().map(({ ts, path: p, country, device, referrer }) => ({ ts, path: p, country, device, referrer })),
  }
}

// ---------- auth ----------
async function loadPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD
  try {
    return (await fs.readFile(passwordFile, 'utf8')).trim()
  } catch {
    const generated = crypto.randomBytes(9).toString('base64url')
    await writeAtomic(passwordFile, `${generated}\n`, 0o600)
    console.log(`\n  Generated admin password: ${generated}\n  (saved to server/data/admin-password.txt — delete the file to regenerate)\n`)
    return generated
  }
}
const initialPassword = await loadPassword()
const hashFile = path.join(dataDir, 'admin-hash.json')

async function readHash() {
  try {
    return JSON.parse(await fs.readFile(hashFile, 'utf8'))
  } catch {
    return null
  }
}
const scrypt = (password, salt) => crypto.scryptSync(password, salt, 64)
async function verifyPassword(password) {
  if (typeof password !== 'string' || password.length > 200) return false
  const stored = await readHash()
  if (!stored) return safeEqual(password, initialPassword)
  const expected = Buffer.from(stored.hash, 'hex')
  return crypto.timingSafeEqual(scrypt(password, Buffer.from(stored.salt, 'hex')), expected)
}
async function storePassword(password) {
  const salt = crypto.randomBytes(16)
  await writeAtomic(hashFile, JSON.stringify({ salt: salt.toString('hex'), hash: scrypt(password, salt).toString('hex') }), 0o600)
}
const sessions = new Map()
const failures = new Map()
const msgRate = new Map()

const isLocked = (ip) => {
  const record = failures.get(ip)
  return Boolean(record && record.count >= 5 && record.until > Date.now())
}
const recordFailure = (ip) => {
  const record = failures.get(ip)
  failures.set(ip, { count: (record && record.until > Date.now() ? record.count : 0) + 1, until: Date.now() + 15 * 60 * 1000 })
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}
const secureFlag = (req) => (process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '')

/** Extract session token from Cookie (web) or Authorization: Bearer <token> (Tauri mobile app). */
function authToken(req) {
  const bearer = /^Bearer\s+([A-Za-z0-9_-]+)$/i.exec(String(req.headers.authorization || ''))
  if (bearer) return bearer[1]
  return /(?:^|;\s*)session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1]
}
function isAuthed(req) {
  const token = authToken(req)
  const expires = token && sessions.get(token)
  if (!expires) return false
  if (expires < Date.now()) {
    sessions.delete(token)
    return false
  }
  return true
}

// ---------- helpers ----------
const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
}
const csp = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "font-src https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src 'self' data: https:",
  "connect-src 'self' https://api.wheretheiss.at",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body)
  res.writeHead(status, {
    ...securityHeaders,
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(isJson ? JSON.stringify(body) : body)
}
async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
const readJson = async (req) => {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'))
  } catch (error) {
    throw error.status ? error : Object.assign(new Error('Invalid JSON'), { status: 400 })
  }
}
function sameOriginOrBearer(req) {
  if (/^Bearer\s+/i.test(String(req.headers.authorization || ''))) return true
  const origin = req.headers.origin
  return !origin || origin.startsWith('tauri://') || origin === 'http://tauri.localhost' || new URL(origin).host === req.headers.host
}

const uploadTypes = {
  'image/png': { ext: '.png', magic: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/gif': { ext: '.gif', magic: (b) => b.subarray(0, 3).toString() === 'GIF' },
  'image/webp': { ext: '.webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'application/pdf': { ext: '.pdf', magic: (b) => b.subarray(0, 5).toString() === '%PDF-' },
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

// ---------- SEO helpers ----------
const escXml = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const baseOrigin = (req) => {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '')
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`
}

async function buildSitemap(req) {
  const origin = baseOrigin(req)
  const content = publicContent(await readContent())
  const staticPaths = ['/', '/work', '/notes', '/about', '/contact']
  const urls = [
    ...staticPaths.map((p) => `  <url><loc>${escXml(origin + p)}</loc></url>`),
    ...content.work.projects.map((p) => `  <url><loc>${escXml(`${origin}/work/${p.id}`)}</loc></url>`),
    ...content.notes.items.map((n) => `  <url><loc>${escXml(`${origin}/notes/${n.id}`)}</loc><lastmod>${escXml(n.date)}</lastmod></url>`),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

async function buildRss(req) {
  const origin = baseOrigin(req)
  const content = publicContent(await readContent())
  const site = `${content.landing.firstName} ${content.landing.lastName}`.trim() || 'Burak Kül'
  const items = [...content.notes.items]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)
    .map((n) => {
      const url = `${origin}/notes/${n.id}`
      const plain = n.body.replace(/[#>*_`~$-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 400)
      return `    <item>
      <title>${escXml(n.title)}</title>
      <link>${escXml(url)}</link>
      <guid>${escXml(url)}</guid>
      <pubDate>${new Date(n.date + 'T12:00:00Z').toUTCString()}</pubDate>
      <description>${escXml(plain)}</description>
    </item>`
    })
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escXml(site)} — Notes</title>
    <link>${escXml(origin + '/notes')}</link>
    <description>${escXml(content.notes.intro || content.landing.statement)}</description>
${items.join('\n')}
  </channel>
</rss>\n`
}

async function renderSpaHtml(req, rawHtml, pathname) {
  const origin = baseOrigin(req)
  const content = publicContent(await readContent())
  const site = `${content.landing.firstName} ${content.landing.lastName}`.trim() || 'Burak Kül'
  const [pageKey, itemId = ''] = pathname.replace(/^\/+|\/+$/g, '').split('/')

  let title = `${site} — ${content.landing.statement}`
  let description = content.about.intro || content.landing.statement
  let image = `${origin}/favicon.svg`
  let ogType = 'website'
  let ld = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: site,
    url: origin,
    description,
    knowsAbout: content.about.interests,
  }

  if (pageKey === 'notes' && itemId) {
    const note = content.notes.items.find((n) => n.id === itemId)
    if (note) {
      title = `${note.title} — ${site}`
      description = note.body.replace(/[#>*_`~$-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) || note.title
      if (note.cover) image = `${origin}${note.cover}`
      ogType = 'article'
      ld = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: note.title,
        datePublished: note.date,
        keywords: note.categories.join(', '),
        description,
        image,
        author: { '@type': 'Person', name: site },
        url: `${origin}/notes/${note.id}`,
      }
    }
  } else if (pageKey === 'work' && itemId) {
    const project = content.work.projects.find((p) => p.id === itemId)
    if (project) {
      title = `${project.title} — ${site}`
      description = project.summary || project.description.slice(0, 160)
      if (project.cover) image = `${origin}${project.cover}`
      ogType = 'article'
      ld = {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        name: project.title,
        description,
        image,
        author: { '@type': 'Person', name: site },
        url: `${origin}/work/${project.id}`,
      }
    }
  } else if (pageKey === 'work') {
    title = `Work — ${site}`
    description = content.work.intro
  } else if (pageKey === 'notes') {
    title = `Notes — ${site}`
    description = content.notes.intro
  } else if (pageKey === 'about') {
    title = `About — ${site}`
    description = content.about.intro
  } else if (pageKey === 'contact') {
    title = `Contact — ${site}`
    description = content.contact.intro
  }

  const canonicalUrl = `${origin}${pathname === '/' ? '/' : pathname}`
  const extraHead = [
    `<link rel="canonical" href="${escXml(canonicalUrl)}" />`,
    `<link rel="alternate" type="application/rss+xml" title="${escXml(site)} RSS" href="${escXml(origin + '/feed.xml')}" />`,
    `<meta property="og:url" content="${escXml(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escXml(image)}" />`,
    `<script type="application/ld+json" data-schema="ld">${JSON.stringify(ld)}</script>`,
  ].join('\n    ')

  return rawHtml
    .replace(/<title>.*?<\/title>/, `<title>${escXml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escXml(description)}" />`)
    .replace(/<meta property="og:type" content="[^"]*" \/>/, `<meta property="og:type" content="${escXml(ogType)}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escXml(title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escXml(description)}" />`)
    .replace('</head>', `    ${extraHead}\n  </head>`)
}

async function serveFile(req, res, base, relative, fallbackIndex = false, routePath = '/') {
  let file = path.resolve(base, '.' + path.sep + decodeURIComponent(relative))
  if (file !== base && !file.startsWith(base + path.sep)) return send(res, 403, 'Forbidden')
  let stat = await fs.stat(file).catch(() => null)
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html')
    stat = await fs.stat(file).catch(() => null)
  }
  if (!stat && fallbackIndex && !path.extname(relative)) {
    file = path.join(base, 'index.html')
    stat = await fs.stat(file).catch(() => null)
  }
  if (!stat) return send(res, 404, 'Not found')
  const isHtml = path.extname(file).toLowerCase() === '.html'
  if (isHtml) {
    const raw = await fs.readFile(file, 'utf8')
    const html = await renderSpaHtml(req, raw, routePath)
    res.writeHead(200, {
      ...securityHeaders,
      'content-security-policy': csp,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
    })
    return res.end(html)
  }
  res.writeHead(200, {
    ...securityHeaders,
    'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) || base === uploadDir ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const { pathname } = url
    const method = req.method

    if (pathname === '/robots.txt' && method === 'GET') {
      const origin = baseOrigin(req)
      return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${origin}/sitemap.xml\n`, { 'content-type': 'text/plain; charset=utf-8' })
    }

    if (pathname === '/sitemap.xml' && method === 'GET') {
      return send(res, 200, await buildSitemap(req), { 'content-type': 'application/xml; charset=utf-8' })
    }

    if (pathname === '/feed.xml' && method === 'GET') {
      return send(res, 200, await buildRss(req), { 'content-type': 'application/rss+xml; charset=utf-8' })
    }

    if (pathname.startsWith('/uploads/') && method === 'GET') return serveFile(req, res, uploadDir, pathname.slice('/uploads/'.length))

    if (pathname.startsWith('/api/')) {
      const origin = req.headers.origin || ''
      const corsHeaders = origin
        ? {
            'access-control-allow-origin': origin,
            'access-control-allow-credentials': 'true',
            'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'access-control-allow-headers': 'content-type, authorization',
          }
        : {}
      if (method === 'OPTIONS') return send(res, 204, '', corsHeaders)
      const sendApi = (status, body, extra = {}) => send(res, status, body, { ...corsHeaders, ...extra })

      if (method !== 'GET' && !sameOriginOrBearer(req)) return sendApi(403, { error: 'Cross-origin request blocked' })

      if (pathname === '/api/content' && method === 'GET') {
        const full = await readContent()
        return sendApi(200, isAuthed(req) ? full : publicContent(full))
      }

      if (pathname === '/api/hit' && method === 'POST') {
        const body = await readJson(req).catch(() => ({}))
        await recordHit(req, body).catch(() => {})
        return sendApi(204, '')
      }

      // Public direct message endpoint
      if (pathname === '/api/messages' && method === 'POST') {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim()
        const rec = msgRate.get(ip)
        if (rec && rec.count >= 5 && rec.until > Date.now()) {
          return sendApi(429, { error: 'Too many messages sent recently. Please try again later.' })
        }
        const body = await readJson(req)
        const name = str(body?.name, 100).trim()
        const email = str(body?.email, 150).trim()
        const subject = str(body?.subject, 160).trim()
        const text = str(body?.body, 5000).trim()
        if (!name || !email.includes('@') || !subject || !text) {
          return sendApi(400, { error: 'Please fill in your name, valid email, subject and message.' })
        }
        msgRate.set(ip, { count: (rec && rec.until > Date.now() ? rec.count : 0) + 1, until: Date.now() + 15 * 60 * 1000 })
        const messages = await readMessages()
        messages.unshift({
          id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
          ts: new Date().toISOString(),
          name,
          email,
          subject,
          body: text,
          read: false,
        })
        while (messages.length > MAX_MESSAGES) messages.pop()
        await writeAtomic(messagesFile, JSON.stringify(messages, null, 2))
        return sendApi(201, { ok: true })
      }

      if (pathname === '/api/session' && method === 'GET') return sendApi(200, { authenticated: isAuthed(req) })

      if (pathname === '/api/login' && method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown'
        if (isLocked(ip)) return sendApi(429, { error: 'Too many attempts. Try again later.' })
        const body = await readJson(req)
        if (!(await verifyPassword(body.password))) {
          recordFailure(ip)
          return sendApi(401, { error: 'Wrong password' })
        }
        failures.delete(ip)
        const token = crypto.randomBytes(32).toString('base64url')
        sessions.set(token, Date.now() + SESSION_MS)
        return sendApi(
          200,
          { authenticated: true, token },
          { 'set-cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secureFlag(req)}` },
        )
      }

      if (pathname === '/api/logout' && method === 'POST') {
        const token = authToken(req)
        if (token) sessions.delete(token)
        return sendApi(200, { authenticated: false }, { 'set-cookie': `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureFlag(req)}` })
      }

      if (!isAuthed(req)) return sendApi(401, { error: 'Not signed in' })

      if (pathname === '/api/messages' && method === 'GET') {
        const messages = await readMessages()
        const unreadCount = messages.filter((m) => !m.read).length
        return sendApi(200, { messages, unreadCount })
      }

      if (pathname.startsWith('/api/messages/') && (method === 'PATCH' || method === 'DELETE')) {
        const msgId = decodeURIComponent(pathname.slice('/api/messages/'.length))
        const messages = await readMessages()
        const idx = messages.findIndex((m) => m.id === msgId)
        if (idx === -1) return sendApi(404, { error: 'Message not found' })
        if (method === 'DELETE') {
          messages.splice(idx, 1)
        } else {
          const body = await readJson(req).catch(() => ({}))
          messages[idx].read = Boolean(body.read ?? true)
        }
        await writeAtomic(messagesFile, JSON.stringify(messages, null, 2))
        return sendApi(200, { ok: true })
      }

      if (pathname === '/api/analytics' && method === 'GET') {
        return sendApi(200, summarizeHits(await readHits()))
      }

      if (pathname === '/api/analytics' && method === 'DELETE') {
        await writeAtomic(analyticsFile, '[]')
        return sendApi(200, { ok: true })
      }

      if (pathname === '/api/password' && method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown'
        if (isLocked(ip)) return sendApi(429, { error: 'Too many attempts. Try again later.' })
        const body = await readJson(req)
        if (!(await verifyPassword(body.current))) {
          recordFailure(ip)
          return sendApi(403, { error: 'Current password is wrong' })
        }
        if (typeof body.next !== 'string' || body.next.length < 10 || body.next.length > 200) return sendApi(400, { error: 'New password must be at least 10 characters' })
        await storePassword(body.next)
        failures.delete(ip)
        const keep = authToken(req)
        for (const token of sessions.keys()) if (token !== keep) sessions.delete(token)
        return sendApi(200, { ok: true })
      }

      if (pathname === '/api/content' && method === 'PUT') {
        let content
        try {
          content = normalize(await readJson(req))
        } catch (error) {
          return sendApi(error.status || 400, { error: error.message })
        }
        await writeAtomic(contentFile, JSON.stringify(content, null, 2))
        return sendApi(200, content)
      }

      if (pathname === '/api/upload' && method === 'POST') {
        const type = uploadTypes[String(req.headers['content-type']).split(';')[0]]
        if (!type) return sendApi(415, { error: 'Only PNG, JPEG, GIF, WebP or PDF files are allowed' })
        const data = await readBody(req, MAX_UPLOAD)
        if (!data.length || !type.magic(data)) return sendApi(415, { error: 'File content does not match the file type' })
        const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${type.ext}`
        await fs.mkdir(uploadDir, { recursive: true })
        await fs.writeFile(path.join(uploadDir, name), data)
        return sendApi(201, { url: `/uploads/${name}` })
      }

      return sendApi(404, { error: 'Not found' })
    }

    if (existsSync(distDir) && (method === 'GET' || method === 'HEAD')) return serveFile(req, res, distDir, pathname.slice(1), true, pathname)
    return send(res, 404, 'Not found. Run `npm run build` to serve the site from this server, or use `npm run dev:all`.')
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message })
    console.error(error)
    send(res, 500, { error: 'Server error' })
  }
})

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `\nPort ${PORT} is already in use — an old server is probably still running.\nStop it with: pkill -f server/index.mjs\n` : error)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces()
  const lanIps = Object.values(nets)
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address)
  console.log(`API listening on http://localhost:${PORT}`)
  for (const ip of lanIps) console.log(`  LAN / Phone URL: http://${ip}:${PORT}`)
})
