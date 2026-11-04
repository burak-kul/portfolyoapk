import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from './api'
import { Lightbox, Markdown } from './markdown'
import { extractHeadings, isPublished, readingMinutes, relatedNotes, sortNotes, type Content, type Note, type Project } from './types'

type Vector = { x: number; y: number }

const pad = (index: number) => String(index + 1).padStart(2, '0')

const hairlines = (
  <svg className="page-hairlines" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g className="hairlines"><path d="M-40 559 C168 491 324 648 498 572 S801 423 1240 536" /><path d="M-120 173 C173 81 369 310 588 207 S961 51 1330 178" /><path d="M116 738 L312 52" /><path d="M1067 705 L866 31" /></g></svg>
)

/** Live ISS coordinates + Earth heliocentric orbital velocity (vis-viva equation) + UTC mission clock. */
function SpaceTelemetry() {
  const [iss, setIss] = useState<{ lat: number; lon: number; alt: number }>({ lat: 24.61, lon: 36.12, alt: 418.4 })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const fetchIss = async () => {
      try {
        const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544')
        if (!res.ok) return
        const data = (await res.json()) as { latitude?: number; longitude?: number; altitude?: number }
        if (alive && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
          setIss({ lat: data.latitude, lon: data.longitude, alt: data.altitude ?? 418.4 })
        }
      } catch {
        // Offline / blocked fallback: propagate 51.6° inclination LEO orbit
        const sec = Date.now() / 1000
        const period = 92.68 * 60
        const phase = (sec % period) / period
        const lat = 51.6 * Math.sin(phase * 2 * Math.PI)
        const lon = ((((sec * 360) / period - (sec / 86164) * 360) % 360) + 540) % 360 - 180
        if (alive) setIss({ lat, lon, alt: 418.2 })
      }
    }
    void fetchIss()
    const issTimer = window.setInterval(() => void fetchIss(), 10000)
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      window.clearInterval(issTimer)
      window.clearInterval(clockTimer)
    }
  }, [])

  // Earth orbital speed via Kepler vis-viva: e = 0.0167086, perihelion ~ Jan 3
  const dayOfYear = (now - Date.UTC(new Date(now).getUTCFullYear(), 0, 0)) / 86400000
  const meanAnomaly = ((2 * Math.PI) / 365.256) * (dayOfYear - 3)
  const e = 0.0167086
  const rAu = (1 - e * e) / (1 + e * Math.cos(meanAnomaly))
  const vEarth = (29.7847 * Math.sqrt(2 / rAu - 1)).toFixed(4)
  const utc = new Date(now).toISOString().slice(11, 19)
  const latStr = `${Math.abs(iss.lat).toFixed(2)}°${iss.lat >= 0 ? 'N' : 'S'}`
  const lonStr = `${Math.abs(iss.lon).toFixed(2)}°${iss.lon >= 0 ? 'E' : 'W'}`

  return (
    <div className="telemetry-box" aria-label="Space telemetry">
      <span>ISS // {latStr} {lonStr} · {iss.alt.toFixed(0)} KM</span>
      <span>EARTH V☉ // {vEarth} KM/S</span>
      <span>UTC // {utc}</span>
    </div>
  )
}

/** Top laser reading progress bar for notes. */
function ReadingProgress() {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setPct(max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return <div className="reading-progress" style={{ width: `${pct}%` }} aria-hidden="true" />
}

/** Writes the normalised pointer position into --{prefix}-x/y on the returned element. */
function usePointerVars(prefix: string) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const onPointerMove = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect()
      element.style.setProperty(`--${prefix}-x`, (((event.clientX - bounds.left) / bounds.width - 0.5) * 2).toFixed(3))
      element.style.setProperty(`--${prefix}-y`, (((event.clientY - bounds.top) / bounds.height - 0.5) * 2).toFixed(3))
    }
    element.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => element.removeEventListener('pointermove', onPointerMove)
  }, [prefix])
  return ref
}

function TopBar({ active, className }: { active: string; className?: string }) {
  const link = (key: string, label: string) => <a className={active === key ? 'active-link' : undefined} href={`/${key}`}>{label}</a>
  return (
    <header className={`topbar ${className ?? ''}`}>
      <a className="monogram" href="/" aria-label="Home">BURAK<span aria-hidden="true"></span>KÜL</a>
      <nav aria-label="Primary navigation">
        {link('work', 'Work')}
        {link('notes', 'Notes')}
        {link('about', 'About')}
        {link('contact', 'Contact')}
      </nav>
    </header>
  )
}

export function LandingPage({ content }: { content: Content }) {
  const { landing } = content
  const sceneRef = useRef<HTMLDivElement>(null)
  const publishedNotes = sortNotes(content.notes.items)
  const latest = publishedNotes[0]

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    let current: Vector = { x: 0, y: 0 }
    let target: Vector = { x: 0, y: 0 }

    const update = () => {
      current.x += (target.x - current.x) * 0.055
      current.y += (target.y - current.y) * 0.055
      scene.style.setProperty('--cursor-x', current.x.toFixed(4))
      scene.style.setProperty('--cursor-y', current.y.toFixed(4))
      frame = requestAnimationFrame(update)
    }

    const onPointerMove = (event: PointerEvent) => {
      target = {
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2,
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    frame = requestAnimationFrame(update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [])

  return (
    <main className="site-shell" ref={sceneRef}>
      <header className="topbar" id="top">
        <a className="monogram" href="/" aria-label="Burak Kül home">BURAK<span aria-hidden="true"></span>KÜL</a>
        <nav aria-label="Primary navigation">
          <a href="/work">Work</a>
          <a href="/notes">Notes</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </nav>
        <div className="edition" aria-label="Independent practice">01—26</div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="diagram" aria-hidden="true">
          <svg viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice">
            <defs>
              <filter id="roughen"><feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="2" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" /></filter>
              <linearGradient id="orbit" x1="0" x2="1"><stop stopColor="#FF4800" /><stop offset="1" stopColor="#FFEE00" /></linearGradient>
            </defs>
            <g className="hairlines">
              <path d="M-40 559 C168 491 324 648 498 572 S801 423 1240 536" />
              <path d="M-120 173 C173 81 369 310 588 207 S961 51 1330 178" />
              <path d="M116 738 L312 52" />
              <path d="M1067 705 L866 31" />
            </g>
            <g className="orbit-system" filter="url(#roughen)">
              <ellipse cx="603" cy="379" rx="424" ry="177" transform="rotate(-20 603 379)" />
              <ellipse cx="603" cy="379" rx="344" ry="298" transform="rotate(54 603 379)" />
              <ellipse cx="603" cy="379" rx="237" ry="107" transform="rotate(21 603 379)" />
            </g>
            <g className="coordinates">
              <path d="M991 490h91m-45-45v91" />
              <circle cx="1036" cy="490" r="7" />
              <path d="M753 148 l18 -32 18 32z" />
            </g>
            <circle className="orb orb-one" cx="278" cy="237" r="25" />
            <circle className="orb orb-two" cx="911" cy="246" r="12" />
            <rect className="block" x="897" y="538" width="57" height="57" transform="rotate(14 926 566)" />
            <path className="signal" d="M77 673c29-42 59 42 88 0s59 42 88 0 59 42 88 0" />
          </svg>
        </div>

        <div className="hero-copy">
          <div className="title-row"><span className="title-index">001</span><h1 id="hero-title">{landing.firstName} <em>{landing.lastName}</em></h1></div>
          <div className="statement-row">
            <span className="marker" aria-hidden="true"></span>
            <p>{landing.statement}</p>
          </div>
        </div>

        <a className="latest-note-card" href={latest ? `/notes/${latest.id}` : '/notes'} aria-label={landing.latestCardLabel}>
          <span>{landing.latestCardLabel} / {latest?.categories[0] ?? '00'}</span>
          <p>{latest ? latest.title : landing.noNoteText}</p>
          <i aria-hidden="true">↗</i>
        </a>

        <SpaceTelemetry />
        <p className="side-note">{landing.sideNote}</p>
      </section>

      <section className="latest-notes" aria-labelledby="latest-notes-title">
        <div className="latest-deco" aria-hidden="true">
          <svg viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice">
            <defs><linearGradient id="orbit2" x1="0" x2="1"><stop stopColor="#FF4800" /><stop offset="1" stopColor="#FFEE00" /></linearGradient></defs>
            <g className="hairlines"><path d="M-40 640 C200 540 380 760 600 660 S960 520 1240 640" /><path d="M140 -20 L330 920" /><path d="M1040 -20 L880 920" /></g>
            <g className="orbit-system" style={{ transformOrigin: '600px 450px' }}>
              <ellipse cx="600" cy="450" rx="560" ry="230" transform="rotate(-12 600 450)" />
              <ellipse cx="600" cy="450" rx="430" ry="360" transform="rotate(60 600 450)" />
            </g>
            <g className="coordinates"><path d="M70 220h70m-35-35v70" /><circle cx="105" cy="220" r="6" /><path d="M1070 640l18 -32 18 32z" /></g>
            <circle className="orb orb-one" cx="90" cy="560" r="16" />
            <circle className="orb orb-two" cx="1110" cy="300" r="10" />
            <rect className="block" x="1070" y="760" width="40" height="40" transform="rotate(16 1090 780)" />
            <path className="signal" d="M30 800c25-36 50 36 75 0s50 36 75 0 50 36 75 0" />
            <path className="signal" d="M960 110c25-36 50 36 75 0s50 36 75 0" />
          </svg>
        </div>
        <p className="section-kicker">{landing.tableKicker} / 10</p>
        <h2 id="latest-notes-title" className="visually-hidden">{landing.tableKicker}</h2>
        <NotesTable items={[...publishedNotes.slice(0, 10), ...Array<null>(Math.max(0, 10 - publishedNotes.length)).fill(null)]} />
      </section>
    </main>
  )
}

function NotesTable({ items }: { items: Array<Note | null> }) {
  return (
    <ol className="notes-table">
      {items.map((note, index) => {
        const mins = note ? readingMinutes(note.body) : 0
        const content = (
          <>
            <span className="row-number">{pad(index)}</span>
            <span className="row-cover">{note?.cover && <img src={note.cover} alt={note.title} loading="lazy" />}</span>
            <span className="row-title">
              {note ? note.title : 'Coming soon'}
              {note && <small className="row-sub">{mins} min read{note.pdf ? ' · PDF' : ''}</small>}
            </span>
            <span className="row-date">{note ? note.date : '— — —'}</span>
            <span className="row-arrow" aria-hidden="true">→</span>
          </>
        )
        return (
          <li key={note ? note.id : index}>
            {note ? <a className="note-row" href={`/notes/${note.id}`} aria-label={note.title}>{content}</a> : <div className="note-row is-empty">{content}</div>}
          </li>
        )
      })}
    </ol>
  )
}

export function WorkPage({ content }: { content: Content }) {
  const { work } = content
  const ref = usePointerVars('work')
  const publishedProjects = work.projects.filter(isPublished)
  return (
    <main className="work-page" ref={ref}>
      <div className="work-motion" aria-hidden="true"><svg className="page-hairlines" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g className="hairlines"><path d="M-40 559 C168 491 324 648 498 572 S801 423 1240 536" /><path d="M-120 173 C173 81 369 310 588 207 S961 51 1330 178" /><path d="M116 738 L312 52" /><path d="M1067 705 L866 31" /></g></svg>
        <svg viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMin slice">
          <path className="work-orbit orbit-a" d="M-60 462C170 72 676 126 970 331s415 469 564 141" />
          <path className="work-orbit orbit-b" d="M108 105c133 308 284 501 625 530s524-121 802-4" />
          <circle className="work-node node-a" cx="237" cy="310" r="14" />
          <circle className="work-node node-b" cx="1148" cy="432" r="8" />
          <path className="work-signal" d="M1075 790c22-32 44 32 66 0s44 32 66 0 44 32 66 0" />
        </svg>
      </div>
      <TopBar active="work" className="work-topbar" />
      <section className="work-section" aria-labelledby="work-title">
        <div className="section-heading">
          <p className="section-kicker">{work.kicker}</p>
          <h1 id="work-title">{work.titleMain} <span>{work.titleAccent}</span></h1>
          <p className="section-intro">{work.intro}</p>
        </div>
        {publishedProjects.length ? (
          <div className="work-grid" aria-label="Projects">
            {publishedProjects.map((project, index) => (
              <a className="work-card" key={project.id} href={`/work/${project.id}`}>
                {project.cover && <img src={project.cover} alt={project.title} loading="lazy" />}
                <span className="work-card-number">{pad(index)}</span>
                <h2>{project.title || 'Untitled project'}</h2>
                {project.summary && <p>{project.summary}</p>}
                <i aria-hidden="true">↗</i>
              </a>
            ))}
          </div>
        ) : <p className="notes-empty work-empty">{work.emptyText}</p>}
      </section>
    </main>
  )
}

export function NotesPage({ content }: { content: Content }) {
  const { notes } = content
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const ref = usePointerVars('notes')
  const q = query.trim().toLowerCase()
  const items = sortNotes(notes.items, category).filter(
    (note) => !q || note.title.toLowerCase().includes(q) || note.body.toLowerCase().includes(q) || note.categories.some((c) => c.toLowerCase().includes(q)),
  )
  const selectCategory = (name: string) => {
    setCategory(category === name ? '' : name)
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <main className="notes-page" ref={ref}>
      <div className="notes-motion" aria-hidden="true">{hairlines}<span></span><span></span></div>
      <TopBar active="notes" className="notes-topbar" />
      <section className="notes-section" aria-labelledby="notes-title">
        <div className="notes-copy">
          <p className="section-kicker">{notes.kicker}</p>
          <h1 id="notes-title">{notes.titleMain} <span>{notes.titleAccent}</span></h1>
          <p className="notes-intro">{notes.intro}</p>
        </div>
        <div className="category-grid" aria-label="Note categories">
          {notes.categories.map((name, index) => (
            <button type="button" className={`category-card${category === name ? ' is-active' : ''}`} key={name} aria-pressed={category === name} onClick={() => selectCategory(name)}>
              <span>{pad(index)}</span><h2>{name}</h2><i aria-hidden="true">↗</i>
            </button>
          ))}
        </div>
        <div className="notes-list" ref={listRef}>
          <div className="notes-toolbar">
            <p className="section-kicker">{category || 'All notes'} / {items.length}</p>
            <div className="notes-tools">
              <input
                type="search"
                className="notes-search"
                placeholder="Search notes…"
                aria-label="Search notes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <a className="rss-link" href="/feed.xml" target="_blank" rel="noreferrer" title="RSS Feed">RSS ↗</a>
            </div>
          </div>
          {items.length ? <NotesTable items={items} /> : <p className="notes-empty">{q ? 'No notes match your search.' : 'No notes in this category yet.'}</p>}
        </div>
      </section>
    </main>
  )
}

function PageShell({ active, kicker, titleId, title, intro, compact, children }: { active: string; kicker: string; titleId: string; title: ReactNode; intro: string; compact?: boolean; children: ReactNode }) {
  const ref = usePointerVars('about')
  return (
    <main className="about-page" ref={ref}>
      <div className="about-motion" aria-hidden="true">
        {hairlines}
        <span></span><span></span>
        <svg className="about-shapes" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice">
          <defs><linearGradient id="orbit3" x1="0" x2="1"><stop stopColor="#FF4800" /><stop offset="1" stopColor="#FFEE00" /></linearGradient></defs>
          <g className="orbit-system" style={{ transformOrigin: '780px 380px' }}>
            <ellipse cx="780" cy="380" rx="400" ry="170" transform="rotate(-20 780 380)" />
            <ellipse cx="780" cy="380" rx="300" ry="260" transform="rotate(54 780 380)" />
          </g>
          <g className="coordinates"><path d="M1040 560h80m-40-40v80" /><circle cx="1080" cy="560" r="7" /><path d="M560 120l18 -32 18 32z" /></g>
          <circle className="orb orb-one" cx="980" cy="200" r="20" />
          <circle className="orb orb-two" cx="640" cy="560" r="11" />
          <rect className="block" x="860" y="600" width="46" height="46" transform="rotate(14 883 623)" />
          <path className="signal" d="M600 700c29-42 59 42 88 0s59 42 88 0 59 42 88 0" />
        </svg>
      </div>
      <TopBar active={active} className="about-topbar" />
      <section className={`about-section${compact ? ' is-compact' : ''}`} aria-labelledby={titleId}>
        <div className="about-copy">
          <p className="section-kicker">{kicker}</p>
          <h1 id={titleId}>{title}</h1>
          {intro && <p className="about-intro">{intro}</p>}
        </div>
        <div className={`about-body${compact ? ' detail-body' : ''}`}>{children}</div>
      </section>
    </main>
  )
}

export function AboutPage({ content }: { content: Content }) {
  const { about } = content
  return (
    <PageShell active="about" kicker={about.kicker} titleId="about-title" title={<>{about.titleMain} <span>{about.titleAccent}</span></>} intro={about.intro}>
      <Markdown text={about.body} />
      <ul className="interest-list" aria-label="Interests">
        {about.interests.map((interest, index) => <li key={interest}><span>{pad(index)}</span>{interest}</li>)}
      </ul>
    </PageShell>
  )
}

export function ContactPage({ content }: { content: Content }) {
  const { contact } = content
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [sending, setSending] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSending(true)
    setStatus(null)
    try {
      await api.sendMessage({ name, email, subject, body })
      setName(''); setEmail(''); setSubject(''); setBody('')
      setStatus({ ok: true, text: 'Message transmitted to inbox ✓' })
    } catch (caught) {
      setStatus({ ok: false, text: caught instanceof Error ? caught.message : 'Could not send message' })
    } finally {
      setSending(false)
    }
  }

  return (
    <PageShell active="contact" kicker={contact.kicker} titleId="contact-title" title={<>{contact.titleMain} <span>{contact.titleAccent}</span></>} intro={contact.intro}>
      <div className="contact-col">
        <p>{contact.text}</p>
        <ul className="contact-list" aria-label="Contact links">
          {contact.links.map((link, index) => (
            <li key={link.label}>
              <a href={link.href} target={link.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                <span>{pad(index)}</span>
                <b>{link.label}</b>
                <em>{link.value}</em>
                <i aria-hidden="true">→</i>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <form className="contact-form" onSubmit={submit} aria-label="Direct message form">
        <p className="section-kicker">Direct transmission</p>
        <label className="cms-field">
          <span>Your name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
        </label>
        <label className="cms-field">
          <span>Email address</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@analytical.engine" />
        </label>
        <label className="cms-field">
          <span>Subject</span>
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Orbital trajectory question" />
        </label>
        <label className="cms-field">
          <span>Message</span>
          <textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message here…" />
        </label>
        {status && <p className={status.ok ? 'cms-muted' : 'cms-error'}>{status.text}</p>}
        <button className="cms-button is-primary" type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send message →'}
        </button>
      </form>
    </PageShell>
  )
}

export function ProjectDetail({ content, id }: { content: Content; id: string }) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const published = content.work.projects.filter(isPublished)
  const index = published.findIndex((item) => item.id === id)
  const project: Project | undefined = published[index] ?? content.work.projects.find((item) => item.id === id)
  if (!project) return <NotFound active="work" backHref="/work" backLabel="All work" />
  return (
    <PageShell active="work" compact kicker={`Project / ${pad(Math.max(0, index))}`} titleId="detail-title" title={project.title} intro={project.summary}>
      {project.cover && (
        <img
          className="detail-cover is-zoomable"
          src={project.cover}
          alt={project.title}
          onClick={() => setLightbox({ src: project.cover, alt: project.title })}
        />
      )}
      <Markdown text={project.description} onImageClick={(src, alt) => setLightbox({ src, alt: alt || project.title })} />
      {project.images.length > 0 && (
        <div className="detail-gallery">
          {project.images.map((src, i) => (
            <img
              key={src}
              className="is-zoomable"
              src={src}
              alt={`${project.title} — ${i + 1}`}
              loading="lazy"
              onClick={() => setLightbox({ src, alt: `${project.title} — ${i + 1}` })}
            />
          ))}
        </div>
      )}
      <a className="detail-back" href="/work">← All work</a>
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </PageShell>
  )
}

export function NoteDetail({ content, id }: { content: Content; id: string }) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [copiedCite, setCopiedCite] = useState<'apa' | 'bib' | null>(null)
  const note = content.notes.items.find((item) => item.id === id)
  if (!note) return <NotFound active="notes" backHref="/notes" backLabel="All notes" />

  const mins = readingMinutes(note.body)
  const headings = extractHeadings(note.body)
  const related = relatedNotes(content.notes.items, note, 3)
  const refs = (note.references ?? []).filter((r) => r.trim())
  const author = `${content.landing.firstName} ${content.landing.lastName}`.trim() || 'Burak Kül'
  const year = note.date.slice(0, 4)
  const url = `${window.location.origin}/notes/${note.id}`
  const apaCite = `${author}. (${note.date}). ${note.title}. Retrieved from ${url}`
  const bibCite = `@misc{kul_${note.id.replace(/[^a-z0-9]/gi, '_')}_${year},\n  author = {${author}},\n  title = {${note.title}},\n  year = {${year}},\n  url = {${url}}\n}`

  const copyCite = (kind: 'apa' | 'bib', text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedCite(kind)
      window.setTimeout(() => setCopiedCite(null), 1800)
    })
  }

  return (
    <>
      <ReadingProgress />
      <PageShell active="notes" compact kicker={`Note / ${note.date} · ${mins} min read`} titleId="detail-title" title={note.title} intro="">
        <div className="note-meta-bar">
          {note.categories.length > 0 && <ul className="chip-list" aria-label="Categories">{note.categories.map((name) => <li key={name}>{name}</li>)}</ul>}
          <div className="note-actions">
            {note.pdf && (
              <a className="cms-button" href={note.pdf} download target="_blank" rel="noreferrer">
                ↓ Download PDF
              </a>
            )}
            <button type="button" className="cms-button is-ghost" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
          </div>
        </div>

        {note.cover && (
          <img
            className="detail-cover is-zoomable"
            src={note.cover}
            alt={note.title}
            onClick={() => setLightbox({ src: note.cover, alt: note.title })}
          />
        )}

        {headings.length > 0 && (
          <nav className="toc-box" aria-label="Table of contents">
            <p className="section-kicker">Table of contents</p>
            <ol>
              {headings.map((h, i) => (
                <li key={h.id} className={h.level === 3 ? 'is-sub' : undefined}>
                  <a
                    href={`#${h.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                  >
                    <span>{pad(i)}</span>
                    {h.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <Markdown text={note.body} onImageClick={(src, alt) => setLightbox({ src, alt: alt || note.title })} />

        {refs.length > 0 && (
          <section className="refs-box" aria-label="References">
            <p className="section-kicker">References &amp; Sources</p>
            <ol>
              {refs.map((ref, idx) => (
                <li key={idx}>
                  <span>[{pad(idx)}]</span>
                  <p>{ref}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="cite-box" aria-label="Cite this note">
          <div className="cite-head">
            <p className="section-kicker">Cite this note</p>
            <div className="cite-actions">
              <button type="button" className="cms-button is-ghost" onClick={() => copyCite('apa', apaCite)}>
                {copiedCite === 'apa' ? 'Copied APA ✓' : 'Copy APA'}
              </button>
              <button type="button" className="cms-button is-ghost" onClick={() => copyCite('bib', bibCite)}>
                {copiedCite === 'bib' ? 'Copied BibTeX ✓' : 'Copy BibTeX'}
              </button>
            </div>
          </div>
          <code>{apaCite}</code>
        </section>

        {related.length > 0 && (
          <aside className="related-notes" aria-label="Related notes">
            <p className="section-kicker">Related notes</p>
            <NotesTable items={related} />
          </aside>
        )}
        <a className="detail-back" href="/notes">← All notes</a>
      </PageShell>
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}

function NotFound({ active, backHref, backLabel }: { active: string; backHref: string; backLabel: string }) {
  return (
    <PageShell active={active} compact kicker="404" titleId="detail-title" title="Not found" intro="This page does not exist (anymore).">
      <a className="detail-back" href={backHref}>← {backLabel}</a>
    </PageShell>
  )
}
