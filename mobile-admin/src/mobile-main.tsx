import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Admin } from '../../src/Admin'
import { api, getServerUrl } from '../../src/api'
import type { Content } from '../../src/types'
import '../../src/style.css'

const emptyContent: Content = {
  landing: {
    firstName: 'Burak',
    lastName: 'Kül',
    statement: 'Exploring What Lies Beyond',
    sideNote: 'A field study in\nform, motion & digital matter.',
    latestCardLabel: 'Latest note',
    noNoteText: 'No note published yet.',
    tableKicker: 'Latest notes',
  },
  work: { kicker: 'Project index / 00', titleMain: 'Work', titleAccent: 'in orbit', intro: '', emptyText: 'No projects yet.', projects: [] },
  notes: { kicker: 'Field notes / 00', titleMain: 'Notes', titleAccent: 'for later', intro: '', categories: [], items: [] },
  about: { kicker: 'About / 00', titleMain: 'About', titleAccent: 'me', intro: '', body: '', interests: [] },
  contact: { kicker: 'Contact / 00', titleMain: 'Get in', titleAccent: 'touch', intro: '', text: '', links: [] },
}

function MobileApp() {
  const [content, setContent] = useState<Content>(emptyContent)

  useEffect(() => {
    if (getServerUrl()) {
      api.getContent().then(setContent).catch(() => {})
    }
  }, [])

  return <Admin content={content} onSaved={setContent} isMobileApp />
}

createRoot(document.getElementById('root')!).render(<MobileApp />)

