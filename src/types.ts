export type PublishStatus = 'published' | 'draft'

export type Project = {
  id: string
  title: string
  summary: string
  description: string
  cover: string
  images: string[]
  status?: PublishStatus
}

export type Note = {
  id: string
  title: string
  date: string
  categories: string[]
  cover: string
  body: string
  pdf?: string
  references?: string[]
  status?: PublishStatus
}

export type Link = { label: string; value: string; href: string }
type PageTexts = { kicker: string; titleMain: string; titleAccent: string; intro: string }

export type Content = {
  landing: { firstName: string; lastName: string; statement: string; sideNote: string; latestCardLabel: string; noNoteText: string; tableKicker: string }
  work: PageTexts & { emptyText: string; projects: Project[] }
  notes: PageTexts & { categories: string[]; items: Note[] }
  about: PageTexts & { body: string; interests: string[] }
  contact: PageTexts & { text: string; links: Link[] }
}

export type ContactMessage = {
  id: string
  ts: string
  name: string
  email: string
  subject: string
  body: string
  read: boolean
}

export type AnalyticsSummary = {
  totalViews: number
  uniqueVisitors: number
  viewsLast7Days: number
  viewsLast30Days: number
  byDay: Array<{ date: string; views: number }>
  topPages: Array<{ path: string; views: number }>
  countries: Array<{ country: string; views: number }>
  devices: Array<{ device: string; views: number }>
  referrers: Array<{ referrer: string; views: number }>
  recent: Array<{ ts: string; path: string; country: string; device: string; referrer: string }>
}

export const isPublished = (item: { status?: PublishStatus }) => (item.status ?? 'published') === 'published'

export const sortNotes = (notes: Note[], category = '', includeDrafts = false): Note[] =>
  notes
    .filter((note) => (includeDrafts || isPublished(note)) && (!category || note.categories.includes(category)))
    .sort((a, b) => b.date.localeCompare(a.date))

/** Convert any Turkish/English title into a clean URL slug (e.g. "Yörünge Mekaniği 101" -> "yorunge-mekanigi-101"). */
export function slugify(text: string): string {
  const trMap: Record<string, string> = { ğ: 'g', ü: 'u', ş: 's', ı: 'i', İ: 'i', ö: 'o', ç: 'c', Ğ: 'g', Ü: 'u', Ş: 's', Ö: 'o', Ç: 'c' }
  const clean = text
    .split('')
    .map((ch) => trMap[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
  return clean || Math.random().toString(36).slice(2, 8)
}

/** Estimate reading time in minutes (~200 words per minute, minimum 1 min). */
export function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

/** Extract H2 / H3 headings from Markdown text to build the Table of Contents. */
export function extractHeadings(markdown: string): Array<{ id: string; text: string; level: 2 | 3 }> {
  const headings: Array<{ id: string; text: string; level: 2 | 3 }> = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let inCode = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const m = /^(#{1,3})\s+(.+)$/.exec(line)
    if (m) {
      const cleanText = m[2].replace(/[*_`~]/g, '').trim()
      headings.push({
        id: `h-${slugify(cleanText)}-${headings.length}`,
        text: cleanText,
        level: m[1].length >= 3 ? 3 : 2,
      })
    }
  }
  return headings
}

/** Find up to `limit` related published notes scored by shared categories and title/body keywords. */
export function relatedNotes(all: Note[], current: Note, limit = 3): Note[] {
  const catSet = new Set(current.categories)
  const words = new Set(
    current.title
      .toLowerCase()
      .replace(/[^a-z0-9ğüşıöç\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  )
  return all
    .filter((n) => n.id !== current.id && isPublished(n))
    .map((n) => {
      let score = 0
      for (const c of n.categories) if (catSet.has(c)) score += 3
      const hay = `${n.title} ${n.body}`.toLowerCase()
      for (const w of words) if (hay.includes(w)) score += 1
      return { note: n, score }
    })
    .sort((a, b) => b.score - a.score || b.note.date.localeCompare(a.note.date))
    .slice(0, limit)
    .map((entry) => entry.note)
}
