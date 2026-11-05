import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, getServerUrl, resolveAssetUrl, setServerUrl } from './api'
import { MarkdownField } from './markdown'
import { isPublished, readingMinutes, slugify, type AnalyticsSummary, type ContactMessage, type Content, type Link, type Note, type Project, type PublishStatus } from './types'

type SectionKey = 'landing' | 'work' | 'notes' | 'about' | 'contact' | 'inbox' | 'analytics'
const sections: Array<[SectionKey, string]> = [
  ['landing', 'Landing Page'],
  ['work', 'Work'],
  ['notes', 'Notes'],
  ['about', 'About'],
  ['contact', 'Contact'],
  ['inbox', 'Inbox'],
  ['analytics', 'Analytics'],
]

type Update = (change: (draft: Content) => void) => void
const newId = () => Math.random().toString(36).slice(2, 8)
const today = () => new Date().toISOString().slice(0, 10)
const pageFields: Array<[string, string, boolean?]> = [
  ['kicker', 'Small label above the title'],
  ['titleMain', 'Title'],
  ['titleAccent', 'Title (highlighted part)'],
  ['intro', 'Intro text', true],
]

// ---------- form building blocks ----------
function Field({ label, value, onChange, multiline, rows = 5, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; rows?: number; type?: string }) {
  return (
    <label className="cms-field">
      <span>{label}</span>
      {multiline ? <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />}
    </label>
  )
}

function SlugField({ prefix, value, title, onChange }: { prefix: string; value: string; title: string; onChange: (slug: string) => void }) {
  return (
    <div className="cms-field">
      <span>Readable URL slug ({prefix}/{value})</span>
      <div className="cms-row">
        <input value={value} onChange={(e) => onChange(slugify(e.target.value))} />
        <button type="button" className="cms-button is-ghost" onClick={() => onChange(slugify(title))}>
          Generate from title
        </button>
      </div>
    </div>
  )
}

function StatusField({ value = 'published', onChange }: { value?: PublishStatus; onChange: (status: PublishStatus) => void }) {
  return (
    <div className="cms-field">
      <span>Visibility status</span>
      <div className="cms-checks">
        <label className={value === 'published' ? 'is-on' : undefined}>
          <input type="radio" name="status" checked={value === 'published'} onChange={() => onChange('published')} />
          Published (visible on site)
        </label>
        <label className={value === 'draft' ? 'is-on' : undefined}>
          <input type="radio" name="status" checked={value === 'draft'} onChange={() => onChange('draft')} />
          Draft (hidden from visitors &amp; Google)
        </label>
      </div>
    </div>
  )
}

function TextFields({ fields, values, onChange }: { fields: Array<[string, string, boolean?]>; values: object; onChange: (key: string, value: string) => void }) {
  return <>{fields.map(([key, label, multiline]) => <Field key={key} label={label} multiline={multiline} rows={3} value={String((values as Record<string, unknown>)[key] ?? '')} onChange={(value) => onChange(key, value)} />)}</>
}

function useUpload(onDone: (url: string) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError('')
    try {
      for (const file of Array.from(files)) onDone((await api.upload(file)).url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, upload }
}

function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (url: string) => void }) {
  const { busy, error, upload } = useUpload(onChange)
  return (
    <div className="cms-field">
      <span>{label}</span>
      <div className="cms-image">
        {value ? <img src={resolveAssetUrl(value)} alt="" /> : <div className="cms-image-empty">No image</div>}
        <div className="cms-image-actions">
          <label className="cms-button">{busy ? 'Uploading…' : value ? 'Replace image' : 'Choose image'}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(event) => { void upload(event.target.files); event.target.value = '' }} /></label>
          {value && <button type="button" className="cms-button is-ghost" onClick={() => onChange('')}>Remove</button>}
        </div>
      </div>
      {error && <p className="cms-error">{error}</p>}
    </div>
  )
}

function PdfField({ label, value = '', onChange }: { label: string; value?: string; onChange: (url: string) => void }) {
  const { busy, error, upload } = useUpload(onChange)
  return (
    <div className="cms-field">
      <span>{label}</span>
      <div className="cms-image-actions">
        <label className="cms-button">
          {busy ? 'Uploading PDF…' : value ? 'Replace PDF' : 'Upload PDF'}
          <input type="file" accept="application/pdf" hidden onChange={(event) => { void upload(event.target.files); event.target.value = '' }} />
        </label>
        {value && (
          <>
            <a className="cms-button is-ghost" href={resolveAssetUrl(value)} target="_blank" rel="noreferrer">View PDF ↗</a>
            <button type="button" className="cms-button is-danger" onClick={() => onChange('')}>Remove PDF</button>
          </>
        )}
      </div>
      {error && <p className="cms-error">{error}</p>}
    </div>
  )
}

function Gallery({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const { busy, error, upload } = useUpload((url) => onChange([...images, url]))
  return (
    <div className="cms-field">
      <span>Gallery images</span>
      <div className="cms-gallery">
        {images.map((src, index) => (
          <figure key={src}>
            <img src={resolveAssetUrl(src)} alt="" />
            <button type="button" className="cms-button is-ghost" onClick={() => onChange(images.filter((_, i) => i !== index))}>Remove</button>
          </figure>
        ))}
        <label className="cms-button">{busy ? 'Uploading…' : '+ Add images'}<input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(event) => { void upload(event.target.files); event.target.value = '' }} /></label>
      </div>
      {error && <p className="cms-error">{error}</p>}
    </div>
  )
}

function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="cms-card">
      <header><h2>{title}</h2>{actions}</header>
      {children}
    </section>
  )
}

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function StringList({ title, items, onChange, addLabel }: { title: string; items: string[]; onChange: (items: string[]) => void; addLabel: string }) {
  return (
    <Card title={title} actions={<button type="button" className="cms-button" onClick={() => onChange([...items, ''])}>{addLabel}</button>}>
      {items.length === 0 && <p className="cms-muted">Nothing here yet.</p>}
      {items.map((item, index) => (
        <div className="cms-row" key={index}>
          <input value={item} onChange={(event) => onChange(items.map((value, i) => (i === index ? event.target.value : value)))} />
          <button type="button" className="cms-button is-ghost" aria-label="Move up" onClick={() => onChange(move(items, index, -1))}>↑</button>
          <button type="button" className="cms-button is-ghost" aria-label="Move down" onClick={() => onChange(move(items, index, 1))}>↓</button>
          <button type="button" className="cms-button is-danger" onClick={() => onChange(items.filter((_, i) => i !== index))}>Delete</button>
        </div>
      ))}
    </Card>
  )
}

// ---------- section editors ----------
function LandingEditor({ draft, update }: { draft: Content; update: Update }) {
  const fields: Array<[string, string, boolean?]> = [
    ['firstName', 'First name (white)'],
    ['lastName', 'Last name (orange)'],
    ['statement', 'Tagline under the name'],
    ['sideNote', 'Small side note (line breaks allowed)', true],
    ['latestCardLabel', 'Latest-note card label'],
    ['noNoteText', 'Latest-note card text when there are no notes'],
    ['tableKicker', 'Label above the latest-notes table'],
  ]
  return (
    <>
      <Card title="Hero">
        <TextFields fields={fields} values={draft.landing} onChange={(key, value) => update((d) => { (d.landing as Record<string, string>)[key] = value })} />
      </Card>
      <p className="cms-muted">The latest-note card and the table of the 10 newest notes fill in automatically from published notes in the Notes section.</p>
    </>
  )
}

function WorkEditor({ draft, update }: { draft: Content; update: Update }) {
  const [selected, setSelected] = useState<string | null>(null)
  const projects = draft.work.projects
  const index = projects.findIndex((project) => project.id === selected)
  const project: Project | undefined = projects[index]
  const patch = (change: Partial<Project>) => update((d) => { Object.assign(d.work.projects[index], change) })

  if (project) {
    return (
      <>
        <button type="button" className="cms-button is-ghost" onClick={() => setSelected(null)}>← All projects</button>
        <Card title={`Edit project ${String(index + 1).padStart(2, '0')}`}>
          <Field label="Title" value={project.title} onChange={(title) => patch({ title })} />
          <SlugField
            prefix="/work"
            value={project.id}
            title={project.title}
            onChange={(id) => {
              patch({ id })
              setSelected(id)
            }}
          />
          <StatusField value={project.status ?? 'published'} onChange={(status) => patch({ status })} />
          <Field label="Short summary (shown on the card)" value={project.summary} onChange={(summary) => patch({ summary })} multiline rows={2} />
          <MarkdownField label="Full description (Markdown, LaTeX & Simulations supported)" value={project.description} onChange={(description) => patch({ description })} rows={12} />
          <ImageField label="Cover image" value={project.cover} onChange={(cover) => patch({ cover })} />
          <Gallery images={project.images} onChange={(images) => patch({ images })} />
        </Card>
      </>
    )
  }

  const add = () => {
    const id = `project-${newId()}`
    update((d) => { d.work.projects.push({ id, title: 'New project', summary: '', description: '', cover: '', images: [], status: 'published' }) })
    setSelected(id)
  }
  return (
    <>
      <Card title="Page text">
        <TextFields fields={[...pageFields, ['emptyText', 'Text shown when there are no projects']]} values={draft.work} onChange={(key, value) => update((d) => { (d.work as unknown as Record<string, string>)[key] = value })} />
      </Card>
      <Card title={`Projects (${projects.length})`} actions={<button type="button" className="cms-button" onClick={add}>+ Add project</button>}>
        {projects.length === 0 && <p className="cms-muted">No projects yet. Add your first one.</p>}
        {projects.map((item, i) => (
          <div className="cms-item" key={item.id}>
            {item.cover ? <img src={resolveAssetUrl(item.cover)} alt="" /> : <div className="cms-thumb-empty" />}
            <div className="cms-item-text">
              <b>
                {item.title || 'Untitled project'}
                {!isPublished(item) && <em className="cms-badge">Draft</em>}
              </b>
              <span>/work/{item.id}{item.summary ? ` · ${item.summary}` : ''}</span>
            </div>
            <div className="cms-item-actions">
              <button type="button" className="cms-button is-ghost" aria-label="Move up" onClick={() => update((d) => { d.work.projects = move(d.work.projects, i, -1) })}>↑</button>
              <button type="button" className="cms-button is-ghost" aria-label="Move down" onClick={() => update((d) => { d.work.projects = move(d.work.projects, i, 1) })}>↓</button>
              <button type="button" className="cms-button" onClick={() => setSelected(item.id)}>Edit</button>
              <button type="button" className="cms-button is-danger" onClick={() => { if (confirm(`Delete “${item.title || 'Untitled project'}”?`)) update((d) => { d.work.projects.splice(i, 1) }) }}>Delete</button>
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}

function CategoryRow({ name, count, onRename, onDelete }: { name: string; count: number; onRename: (next: string) => void; onDelete: () => void }) {
  return (
    <div className="cms-row">
      <input defaultValue={name} onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== name) onRename(next); else event.target.value = name }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      <span className="cms-muted">{count} {count === 1 ? 'note' : 'notes'}</span>
      <button type="button" className="cms-button is-danger" onClick={onDelete}>Delete</button>
    </div>
  )
}

function NotesEditor({ draft, update }: { draft: Content; update: Update }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [newCategory, setNewCategory] = useState('')
  const { categories, items } = draft.notes
  const index = items.findIndex((note) => note.id === selected)
  const note: Note | undefined = items[index]
  const patch = (change: Partial<Note>) => update((d) => { Object.assign(d.notes.items[index], change) })

  if (note) {
    const toggle = (name: string) => patch({ categories: note.categories.includes(name) ? note.categories.filter((c) => c !== name) : [...note.categories, name] })
    const mins = readingMinutes(note.body)
    return (
      <>
        <button type="button" className="cms-button is-ghost" onClick={() => setSelected(null)}>← All notes</button>
        <Card title={`Edit note · ~${mins} min read`}>
          <Field label="Title" value={note.title} onChange={(title) => patch({ title })} />
          <SlugField
            prefix="/notes"
            value={note.id}
            title={note.title}
            onChange={(id) => {
              patch({ id })
              setSelected(id)
            }}
          />
          <StatusField value={note.status ?? 'published'} onChange={(status) => patch({ status })} />
          <Field label="Publish date" type="date" value={note.date} onChange={(date) => patch({ date })} />
          <div className="cms-field">
            <span>Categories (pick one or more)</span>
            <div className="cms-checks">
              {categories.length === 0 && <p className="cms-muted">Create categories on the notes overview first.</p>}
              {categories.map((name) => (
                <label key={name} className={note.categories.includes(name) ? 'is-on' : undefined}>
                  <input type="checkbox" checked={note.categories.includes(name)} onChange={() => toggle(name)} />{name}
                </label>
              ))}
            </div>
          </div>
          <ImageField label="Cover image" value={note.cover} onChange={(cover) => patch({ cover })} />
          <PdfField label="PDF version (optional — visitors can download it)" value={note.pdf} onChange={(pdf) => patch({ pdf })} />
          <MarkdownField label="Note text (Markdown, LaTeX $...$ / $$...$$ & :::sim orbit|pendulum|wave supported)" value={note.body} onChange={(body) => patch({ body })} rows={16} />
        </Card>
        <StringList
          title="References & Sources (shown at the bottom of the note)"
          items={note.references ?? []}
          addLabel="+ Add reference"
          onChange={(references) => patch({ references })}
        />
      </>
    )
  }

  const addNote = () => {
    const id = `note-${newId()}`
    update((d) => { d.notes.items.push({ id, title: 'New note', date: today(), categories: [], cover: '', body: '', pdf: '', references: [], status: 'published' }) })
    setSelected(id)
  }
  const addCategory = (event: FormEvent) => {
    event.preventDefault()
    const name = newCategory.trim()
    if (!name || categories.includes(name)) return
    update((d) => { d.notes.categories.push(name) })
    setNewCategory('')
  }
  const rename = (from: string, to: string) => {
    if (categories.includes(to)) return alert(`A category named “${to}” already exists.`)
    update((d) => {
      d.notes.categories = d.notes.categories.map((c) => (c === from ? to : c))
      d.notes.items.forEach((n) => { n.categories = n.categories.map((c) => (c === from ? to : c)) })
    })
  }
  const remove = (name: string) => {
    const count = items.filter((n) => n.categories.includes(name)).length
    if (!confirm(`Delete category “${name}”?${count ? ` It will be removed from ${count} note(s); the notes themselves stay.` : ''}`)) return
    update((d) => {
      d.notes.categories = d.notes.categories.filter((c) => c !== name)
      d.notes.items.forEach((n) => { n.categories = n.categories.filter((c) => c !== name) })
    })
  }
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <Card title="Page text">
        <TextFields fields={pageFields} values={draft.notes} onChange={(key, value) => update((d) => { (d.notes as unknown as Record<string, string>)[key] = value })} />
      </Card>
      <Card title={`Categories (${categories.length})`}>
        {categories.map((name) => <CategoryRow key={name} name={name} count={items.filter((n) => n.categories.includes(name)).length} onRename={(to) => rename(name, to)} onDelete={() => remove(name)} />)}
        <form className="cms-row" onSubmit={addCategory}>
          <input placeholder="New category name" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
          <button className="cms-button" type="submit">+ Add category</button>
        </form>
      </Card>
      <Card title={`Notes (${items.length})`} actions={<button type="button" className="cms-button" onClick={addNote}>+ New note</button>}>
        {items.length === 0 && <p className="cms-muted">No notes yet. Write your first one.</p>}
        {sorted.map((item) => (
          <div className="cms-item" key={item.id}>
            {item.cover ? <img src={resolveAssetUrl(item.cover)} alt="" /> : <div className="cms-thumb-empty" />}
            <div className="cms-item-text">
              <b>
                {item.title || 'Untitled note'}
                {!isPublished(item) && <em className="cms-badge">Draft</em>}
                {item.pdf && <em className="cms-badge is-pdf">PDF</em>}
              </b>
              <span>/notes/{item.id} · {item.date} · {readingMinutes(item.body)} min{item.categories.length ? ` · ${item.categories.join(', ')}` : ''}</span>
            </div>
            <div className="cms-item-actions">
              <button type="button" className="cms-button" onClick={() => setSelected(item.id)}>Edit</button>
              <button type="button" className="cms-button is-danger" onClick={() => { if (confirm(`Delete “${item.title || 'Untitled note'}”?`)) update((d) => { d.notes.items = d.notes.items.filter((n) => n.id !== item.id) }) }}>Delete</button>
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}

function AboutEditor({ draft, update }: { draft: Content; update: Update }) {
  return (
    <>
      <Card title="Page text">
        <TextFields fields={pageFields} values={draft.about} onChange={(key, value) => update((d) => { (d.about as unknown as Record<string, string>)[key] = value })} />
        <MarkdownField label="About text (Markdown & LaTeX supported)" value={draft.about.body} rows={10} onChange={(body) => update((d) => { d.about.body = body })} />
      </Card>
      <StringList title="Interests" items={draft.about.interests} addLabel="+ Add interest" onChange={(interests) => update((d) => { d.about.interests = interests })} />
    </>
  )
}

function ContactEditor({ draft, update }: { draft: Content; update: Update }) {
  const links = draft.contact.links
  const patch = (index: number, change: Partial<Link>) => update((d) => { Object.assign(d.contact.links[index], change) })
  return (
    <>
      <Card title="Page text">
        <TextFields fields={[...pageFields, ['text', 'Text above the links', true]]} values={draft.contact} onChange={(key, value) => update((d) => { (d.contact as unknown as Record<string, string>)[key] = value })} />
      </Card>
      <Card title="Links" actions={<button type="button" className="cms-button" onClick={() => update((d) => { d.contact.links.push({ label: '', value: '', href: '' }) })}>+ Add link</button>}>
        {links.length === 0 && <p className="cms-muted">No links yet.</p>}
        {links.map((link, index) => (
          <div className="cms-link" key={index}>
            <Field label="Name (e.g. GitHub)" value={link.label} onChange={(label) => patch(index, { label })} />
            <Field label="Shown text" value={link.value} onChange={(value) => patch(index, { value })} />
            <Field label="URL (https://… or mailto:…)" value={link.href} onChange={(href) => patch(index, { href })} />
            <div className="cms-item-actions">
              <button type="button" className="cms-button is-ghost" aria-label="Move up" onClick={() => update((d) => { d.contact.links = move(d.contact.links, index, -1) })}>↑</button>
              <button type="button" className="cms-button is-ghost" aria-label="Move down" onClick={() => update((d) => { d.contact.links = move(d.contact.links, index, 1) })}>↓</button>
              <button type="button" className="cms-button is-danger" onClick={() => update((d) => { d.contact.links.splice(index, 1) })}>Delete</button>
            </div>
          </div>
        ))}
        <p className="cms-muted">Links without a valid URL are dropped when you save.</p>
      </Card>
    </>
  )
}

function InboxView({ onUnreadChange }: { onUnreadChange: (count: number) => void }) {
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    api.getMessages().then((res) => {
      setMessages(res.messages)
      onUnreadChange(res.unreadCount)
    }).catch((caught: Error) => setError(caught.message))
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <Card
      title={`Direct messages (${messages.length})`}
      actions={
        <div className="cms-item-actions">
          <button type="button" className="cms-button is-ghost" onClick={() => triggerNativeNotification('Test Transmission', 'Burak Kül Admin notifications are active!')}>
            Test alert
          </button>
          <button type="button" className="cms-button is-ghost" onClick={load}>Refresh</button>
        </div>
      }
    >
      {error && <p className="cms-error">{error}</p>}
      {messages.length === 0 && <p className="cms-muted">Inbox is empty. Visitors can send messages from the Contact page.</p>}
      {messages.map((msg) => (
        <article className={`inbox-msg${msg.read ? '' : ' is-unread'}`} key={msg.id}>
          <div className="inbox-head">
            <div>
              <b>{msg.subject}</b>
              {!msg.read && <em className="cms-badge">New</em>}
              <span>From: {msg.name} &lt;{msg.email}&gt; · {msg.ts.replace('T', ' ').slice(0, 16)}</span>
            </div>
            <div className="cms-item-actions">
              <a className="cms-button" href={`mailto:${msg.email}?subject=${encodeURIComponent('Re: ' + msg.subject)}`}>Reply ↗</a>
              <button type="button" className="cms-button is-ghost" onClick={() => void api.markMessageRead(msg.id, !msg.read).then(load)}>
                {msg.read ? 'Mark unread' : 'Mark read'}
              </button>
              <button type="button" className="cms-button is-danger" onClick={() => { if (confirm('Delete this message?')) void api.deleteMessage(msg.id).then(load) }}>
                Delete
              </button>
            </div>
          </div>
          <p>{msg.body}</p>
        </article>
      ))}
    </Card>
  )
}

function AnalyticsView() {
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    api.getAnalytics().then(setData).catch((caught: Error) => setError(caught.message))
  }

  useEffect(() => {
    load()
  }, [])

  if (error) return <p className="cms-error">{error}</p>
  if (!data) return <p className="cms-muted">Loading analytics…</p>

  const maxDay = Math.max(1, ...data.byDay.map((d) => d.views))

  return (
    <>
      <div className="stats-grid">
        <div className="stat-box"><span>Total pageviews</span><b>{data.totalViews}</b></div>
        <div className="stat-box"><span>Unique visitors</span><b>{data.uniqueVisitors}</b></div>
        <div className="stat-box"><span>Last 7 days</span><b>{data.viewsLast7Days}</b></div>
        <div className="stat-box"><span>Last 30 days</span><b>{data.viewsLast30Days}</b></div>
      </div>

      <Card title="Last 14 days" actions={<button type="button" className="cms-button is-ghost" onClick={load}>Refresh</button>}>
        <div className="bar-chart" aria-label="Views per day">
          {data.byDay.map((day) => (
            <div className="bar-col" key={day.date} title={`${day.date}: ${day.views} views`}>
              <div className="bar-track"><div className="bar-fill" style={{ height: `${Math.round((day.views / maxDay) * 100)}%` }} /></div>
              <span>{day.date.slice(5)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="stats-two-col">
        <Card title="Top pages">
          {data.topPages.length === 0 && <p className="cms-muted">No visits recorded yet.</p>}
          {data.topPages.map((row) => <div className="stat-row" key={row.path}><span>{row.path}</span><b>{row.views}</b></div>)}
        </Card>
        <Card title="Countries / Regions">
          {data.countries.length === 0 && <p className="cms-muted">No country data yet.</p>}
          {data.countries.map((row) => <div className="stat-row" key={row.country}><span>{row.country}</span><b>{row.views}</b></div>)}
        </Card>
        <Card title="Devices">
          {data.devices.length === 0 && <p className="cms-muted">No device data yet.</p>}
          {data.devices.map((row) => <div className="stat-row" key={row.device}><span>{row.device}</span><b>{row.views}</b></div>)}
        </Card>
        <Card title="Referrers">
          {data.referrers.length === 0 && <p className="cms-muted">Direct visits only so far.</p>}
          {data.referrers.map((row) => <div className="stat-row" key={row.referrer}><span>{row.referrer}</span><b>{row.views}</b></div>)}
        </Card>
      </div>

      <Card
        title="Recent visits"
        actions={
          data.totalViews > 0 && (
            <button type="button" className="cms-button is-danger" onClick={() => { if (confirm('Clear all analytics history?')) void api.clearAnalytics().then(load) }}>
              Clear history
            </button>
          )
        }
      >
        {data.recent.length === 0 && <p className="cms-muted">No visits recorded yet.</p>}
        {data.recent.map((hit, i) => (
          <div className="stat-row" key={i}>
            <span>{hit.ts.replace('T', ' ').slice(0, 16)} · <b>{hit.path}</b></span>
            <span>{hit.country} · {hit.device}{hit.referrer !== 'Direct' ? ` · ${hit.referrer}` : ''}</span>
          </div>
        ))}
      </Card>
    </>
  )
}

function PasswordEditor() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (next !== repeat) return setMessage({ ok: false, text: 'The new passwords do not match.' })
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setRepeat('')
      setMessage({ ok: true, text: 'Password changed. Other devices were signed out.' })
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : 'Could not change the password' })
    }
  }
  return (
    <Card title="Change password">
      <form className="cms-form" onSubmit={submit}>
        <Field label="Current password" type="password" value={current} onChange={setCurrent} />
        <Field label="New password (at least 10 characters)" type="password" value={next} onChange={setNext} />
        <Field label="Repeat new password" type="password" value={repeat} onChange={setRepeat} />
        {message && <p className={message.ok ? 'cms-muted' : 'cms-error'}>{message.text}</p>}
        <div><button className="cms-button is-primary" type="submit" disabled={!current || !next || !repeat}>Change password</button></div>
      </form>
    </Card>
  )
}

// ---------- shell ----------
function Login({ isMobileApp, onDone }: { isMobileApp?: boolean; onDone: () => void }) {
  const [server, setServer] = useState(getServerUrl)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (isMobileApp || server.trim()) {
      if (isMobileApp && !/^https?:\/\//i.test(server.trim())) {
        return setError('Enter full server URL (e.g. http://192.168.1.25:3001 or https://yourdomain.com)')
      }
      setServerUrl(server)
    }
    try {
      await api.login(password)
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login failed')
    }
  }
  return (
    <main className="cms-login">
      <div className="notes-motion" aria-hidden="true"><span></span><span></span></div>
      <form onSubmit={submit}>
        <a className="monogram" href="/">BURAK<span aria-hidden="true"></span>KÜL</a>
        <p className="section-kicker">{isMobileApp ? 'Mobile Command Center' : 'Admin panel'}</p>
        <h1>Sign <span>in</span></h1>
        {(isMobileApp || server) && (
          <Field
            label="Server URL (VPS domain or LAN IP)"
            value={server}
            onChange={setServer}
          />
        )}
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {error && <p className="cms-error">{error}</p>}
        <button className="cms-button is-primary" type="submit">Sign in</button>
      </form>
    </main>
  )
}

type TauriInternals = { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }

function playAlertTone() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    for (const [freq, start, dur] of [[880, 0, 0.12], [1318.5, 0.14, 0.22]] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + start)
      gain.gain.setValueAtTime(0.18, now + start)
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + start + dur)
    }
  } catch {
    // AudioContext blocked until interaction
  }
}

async function requestNativeNotificationPermission() {
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (tauri?.invoke) {
    try {
      const perm = await tauri.invoke('plugin:notification|is_permission_granted')
      if (!perm) await tauri.invoke('plugin:notification|request_permission')
    } catch {
      // ignore
    }
  }
  if ('Notification' in window && Notification.permission === 'default') {
    try { void Notification.requestPermission() } catch { /* ignore */ }
  }
}

function triggerNativeNotification(title: string, body: string) {
  playAlertTone()
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (tauri?.invoke) {
    void requestNativeNotificationPermission().then(() => {
      void tauri.invoke!('notify_new_message', { title, body }).catch(() => {
        void tauri.invoke!('plugin:notification|notify', { options: { title, body } }).catch(() => {})
      })
    })
  } else if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }) } catch { /* ignore */ }
  }
}

const NOTIFIED_STORAGE_KEY = 'bk_admin_notified_msgs'
function getNotifiedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}
function saveNotifiedIds(ids: Set<string>) {
  try {
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify([...ids].slice(-200)))
  } catch {
    // ignore
  }
}

export function Admin({ content, onSaved, isMobileApp }: { content: Content; onSaved: (content: Content) => void; isMobileApp?: boolean }) {
  const [auth, setAuth] = useState<'loading' | 'out' | 'in'>('loading')
  const [saved, setSaved] = useState(content)
  const [draft, setDraft] = useState(content)
  const [section, setSection] = useState<SectionKey | 'password'>('landing')
  const [status, setStatus] = useState('')
  const [unread, setUnread] = useState(0)
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null)
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)

  const checkMessagesAndNotify = (requestPermission = false) => {
    if (requestPermission) void requestNativeNotificationPermission()
    api.getMessages().then((res) => {
      setUnread(res.unreadCount)
      const notified = getNotifiedIds()
      let updated = false
      for (const msg of res.messages) {
        if (!msg.read && !notified.has(msg.id)) {
          notified.add(msg.id)
          updated = true
          const title = `New message: ${msg.subject}`
          const body = `${msg.name} (${msg.email}): ${msg.body.slice(0, 100)}`
          setToast({ title, body })
          triggerNativeNotification(title, body)
        }
      }
      if (updated) saveNotifiedIds(notified)
    }).catch(() => {})
  }

  const refreshAdminData = () => {
    api.getContent().then((full) => {
      setSaved(full)
      setDraft(full)
      onSaved(full)
    }).catch(() => {})
    checkMessagesAndNotify(true)
  }

  useEffect(() => {
    if (isMobileApp && !getServerUrl()) {
      setAuth('out')
      return
    }
    api.session().then((s) => {
      setAuth(s.authenticated ? 'in' : 'out')
      if (s.authenticated) refreshAdminData()
    }).catch(() => setAuth('out'))
  }, [])

  // Background polling for new direct messages (every 10s while signed in)
  useEffect(() => {
    if (auth !== 'in') return
    const timer = window.setInterval(() => checkMessagesAndNotify(false), 10000)
    return () => window.clearInterval(timer)
  }, [auth])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update: Update = (change) => {
    setStatus('')
    setDraft((current) => {
      const next = structuredClone(current)
      change(next)
      return next
    })
  }

  const save = async () => {
    setStatus('Saving…')
    try {
      const result = await api.saveContent(draft)
      setSaved(result)
      setDraft(result)
      onSaved(result)
      setStatus('Saved ✓')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Save failed'
      if (message === 'Not signed in') setAuth('out')
      setStatus(message)
    }
  }

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `portfolio-backup-${today()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (auth === 'loading') return <main className="cms-login" />
  if (auth === 'out') return <Login isMobileApp={isMobileApp} onDone={() => {
    setAuth('in')
    refreshAdminData()
  }} />

  const editors: Record<SectionKey, ReactNode> = {
    landing: <LandingEditor draft={draft} update={update} />,
    work: <WorkEditor draft={draft} update={update} />,
    notes: <NotesEditor draft={draft} update={update} />,
    about: <AboutEditor draft={draft} update={update} />,
    contact: <ContactEditor draft={draft} update={update} />,
    inbox: <InboxView onUnreadChange={setUnread} />,
    analytics: <AnalyticsView />,
  }
  const title = section === 'password' ? 'Password' : sections.find(([key]) => key === section)![1]
  const showSave = section !== 'password' && section !== 'analytics' && section !== 'inbox'
  const liveSiteUrl = getServerUrl() || '/'

  return (
    <div className="cms">
      <div className="notes-motion cms-bg-motion" aria-hidden="true"><span></span><span></span></div>
      <aside className="cms-side">
        <a className="monogram" href={liveSiteUrl} target={isMobileApp ? '_blank' : undefined} rel="noreferrer">BURAK<span aria-hidden="true"></span>KÜL</a>
        <p className="cms-label">{isMobileApp ? 'Mobile Admin' : 'Admin panel'}</p>
        <nav aria-label="Admin sections">
          {sections.map(([key, label], index) => (
            <button type="button" key={key} className={section === key ? 'is-active' : undefined} onClick={() => setSection(key)}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              {label}
              {key === 'inbox' && unread > 0 && <em className="cms-badge">{unread}</em>}
            </button>
          ))}
        </nav>
        <div className="cms-side-foot">
          <a href={liveSiteUrl} target={isMobileApp ? '_blank' : undefined} rel="noreferrer">View site ↗</a>
          <button type="button" onClick={exportBackup}>Export backup ↓</button>
          <button type="button" className={section === 'password' ? 'is-active' : undefined} onClick={() => setSection('password')}>Change password</button>
          <button type="button" onClick={() => { void api.logout().then(() => setAuth('out')) }}>Sign out</button>
        </div>
      </aside>
      <section className="cms-main">
        {toast && (
          <div className="cms-toast" role="status">
            <div onClick={() => { setSection('inbox'); setToast(null) }} style={{ cursor: 'pointer', flex: 1 }}>
              <b>{toast.title}</b>
              <span>{toast.body}</span>
            </div>
            <div className="cms-item-actions">
              <button type="button" className="cms-button is-primary" onClick={() => { setSection('inbox'); setToast(null) }}>Open Inbox</button>
              <button type="button" className="cms-button is-ghost" onClick={() => setToast(null)}>✕</button>
            </div>
          </div>
        )}
        <header className="cms-bar">
          <div><p className="section-kicker">Editing</p><h1>{title}</h1></div>
          <div className="cms-bar-actions">
            {showSave && <span className={status && status !== 'Saved ✓' && status !== 'Saving…' ? 'cms-error' : 'cms-muted'}>{status || (dirty ? 'Unsaved changes' : '')}</span>}
            {showSave && <button type="button" className="cms-button is-primary" disabled={!dirty} onClick={() => void save()}>Save changes</button>}
          </div>
        </header>
        <div className="cms-body">{section === 'password' ? <PasswordEditor /> : editors[section]}</div>
      </section>
    </div>
  )
}
