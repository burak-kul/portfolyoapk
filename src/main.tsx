import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import { Admin } from './Admin'
import { AboutPage, ContactPage, LandingPage, NoteDetail, NotesPage, ProjectDetail, WorkPage } from './pages'
import type { Content } from './types'
import './style.css'

/** Convert legacy #hash URLs to clean paths (/work, /notes/id, etc.) and read current pathname. */
function currentPath(): string {
  if (window.location.hash.startsWith('#')) {
    const raw = window.location.hash.slice(1)
    if (raw && raw !== 'top') {
      const target = raw.startsWith('/') ? raw : `/${raw}`
      window.history.replaceState(null, '', target)
      return target
    }
  }
  return window.location.pathname || '/'
}

function upsertMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function updateSeo(path: string, content: Content) {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/')
  const page = parts[0] || ''
  const id = parts[1] || ''
  const site = `${content.landing.firstName} ${content.landing.lastName}`.trim() || 'Burak Kül'
  const origin = window.location.origin

  let title = `${site} — ${content.landing.statement}`
  let description = content.about.intro || content.landing.statement
  let image = `${origin}/favicon.svg`
  let ogType = 'website'
  let ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: site,
    url: origin,
    description,
    knowsAbout: content.about.interests,
  }

  if (page === 'work' && id) {
    const project = content.work.projects.find((item) => item.id === id)
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
  } else if (page === 'notes' && id) {
    const note = content.notes.items.find((item) => item.id === id)
    if (note) {
      title = `${note.title} — ${site}`
      description = note.body.replace(/[#>*_`~-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) || note.title
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
  } else if (page === 'work') {
    title = `Work — ${site}`
    description = content.work.intro
  } else if (page === 'notes') {
    title = `Notes — ${site}`
    description = content.notes.intro
  } else if (page === 'about') {
    title = `About — ${site}`
    description = content.about.intro
  } else if (page === 'contact') {
    title = `Contact — ${site}`
    description = content.contact.intro
  } else if (page === 'admin') {
    title = `Admin — ${site}`
  }

  document.title = title
  upsertMeta('meta[name="description"]', 'name', 'description', description)
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', title)
  upsertMeta('meta[property="og:description"]', 'property', 'og:description', description)
  upsertMeta('meta[property="og:type"]', 'property', 'og:type', ogType)
  upsertMeta('meta[property="og:url"]', 'property', 'og:url', `${origin}${path}`)
  upsertMeta('meta[property="og:image"]', 'property', 'og:image', image)

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    document.head.appendChild(canonical)
  }
  canonical.href = `${origin}${path}`

  let ldScript = document.head.querySelector<HTMLScriptElement>('script[data-schema="ld"]')
  if (!ldScript) {
    ldScript = document.createElement('script')
    ldScript.type = 'application/ld+json'
    ldScript.setAttribute('data-schema', 'ld')
    document.head.appendChild(ldScript)
  }
  ldScript.textContent = JSON.stringify(ld)
}

function App() {
  const [path, setPath] = useState(currentPath)
  const [content, setContent] = useState<Content | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getContent().then(setContent).catch((caught: Error) => setError(caught.message))
  }, [])

  useEffect(() => {
    const onPop = () => setPath(currentPath())
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return
      const href = anchor.getAttribute('href')
      if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/uploads/') || href === '/feed.xml' || href === '/sitemap.xml') return
      event.preventDefault()
      if (href !== window.location.pathname) {
        window.history.pushState(null, '', href)
        setPath(href)
      }
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
      document.removeEventListener('click', onClick)
    }
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    if (!path.startsWith('/admin')) api.trackHit(path)
  }, [path])

  useEffect(() => {
    if (content) updateSeo(path, content)
  }, [path, content])

  if (!content) return <main className="boot">{error && `Could not load content: ${error}. Is the backend running? (npm run dev:all)`}</main>

  const [page, id = ''] = path.replace(/^\/+|\/+$/g, '').split('/')
  switch (page) {
    case 'admin': return <Admin content={content} onSaved={setContent} />
    case 'work': return id ? <ProjectDetail content={content} id={id} /> : <WorkPage content={content} />
    case 'notes': return id ? <NoteDetail content={content} id={id} /> : <NotesPage content={content} />
    case 'about': return <AboutPage content={content} />
    case 'contact': return <ContactPage content={content} />
    default: return <LandingPage content={content} />
  }
}

createRoot(document.getElementById('root')!).render(<App />)
