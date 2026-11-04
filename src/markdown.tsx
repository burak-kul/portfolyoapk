import { useEffect, useRef, useState, type ReactNode } from 'react'
import { slugify } from './types'

declare global {
  interface Window {
    katex?: {
      renderToString: (tex: string, options?: { displayMode?: boolean; throwOnError?: boolean }) => string
    }
  }
}

function MathSpan({ tex, display }: { tex: string; display?: boolean }) {
  const [, setReady] = useState(() => Boolean(window.katex))
  useEffect(() => {
    if (window.katex) return
    const timer = window.setInterval(() => {
      if (window.katex) {
        setReady(true)
        window.clearInterval(timer)
      }
    }, 120)
    return () => window.clearInterval(timer)
  }, [])

  if (window.katex) {
    try {
      const html = window.katex.renderToString(tex, { displayMode: Boolean(display), throwOnError: false })
      return display ? (
        <div className="md-math-block" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="md-math-inline" dangerouslySetInnerHTML={{ __html: html }} />
      )
    } catch {
      // Fall back to raw formula below
    }
  }
  return display ? <pre className="md-math-fallback">{tex}</pre> : <code className="md-math-fallback">{tex}</code>
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const lines = code.split('\n')

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="md-code-wrap">
      <div className="md-code-bar">
        <span>{lang || 'code'}</span>
        <button type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
      <pre className="md-code">
        <code>
          {lines.map((line, idx) => (
            <span className="md-code-line" key={idx}>
              <i className="md-line-num" aria-hidden="true">{String(idx + 1).padStart(2, '0')}</i>
              <span>{line || ' '}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

/** Interactive physics & orbital mechanics simulations embeddable via `:::sim orbit | pendulum | wave`. */
function SimulationBlock({ kind }: { kind: string }) {
  const type = kind.trim().toLowerCase()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [p1, setP1] = useState(type === 'pendulum' ? 45 : type === 'wave' ? 3 : 1.0)
  const [p2, setP2] = useState(type === 'pendulum' ? 9.81 : type === 'wave' ? 4.5 : 2.2)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let frame = 0
    let t = 0

    const draw = () => {
      t += 0.02
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Subtle coordinate grid
      ctx.strokeStyle = 'rgba(242,240,233,0.06)'
      ctx.lineWidth = 1
      for (let x = 0; x < w; x += 36) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      }
      for (let y = 0; y < h; y += 36) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      }

      if (type === 'pendulum') {
        const angle0 = (p1 * Math.PI) / 180
        const g = p2
        const L = 1.4
        const omega = Math.sqrt(g / L)
        const theta = angle0 * Math.cos(omega * t * 1.4)
        const ox = w / 2
        const oy = 34
        const lenPx = Math.min(w, h) * 0.62
        const bx = ox + lenPx * Math.sin(theta)
        const by = oy + lenPx * Math.cos(theta)

        ctx.strokeStyle = 'rgba(255,238,0,0.28)'
        ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy + lenPx + 14); ctx.stroke()
        ctx.setLineDash([])

        ctx.strokeStyle = '#f2f0e9'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(bx, by); ctx.stroke()

        ctx.fillStyle = '#ff4800'
        ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2); ctx.fill()
      } else if (type === 'wave') {
        const f1 = p1
        const f2 = p2
        const mid = h / 2
        const amp = h * 0.18

        // Wave 1
        ctx.strokeStyle = 'rgba(255,72,0,0.55)'
        ctx.lineWidth = 1.3
        ctx.beginPath()
        for (let x = 0; x < w; x++) {
          const y = mid + Math.sin((x / w) * Math.PI * 2 * f1 - t * 2) * amp * 0.6
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()

        // Superposition wave
        ctx.strokeStyle = '#ffee00'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        for (let x = 0; x < w; x++) {
          const y1 = Math.sin((x / w) * Math.PI * 2 * f1 - t * 2)
          const y2 = Math.sin((x / w) * Math.PI * 2 * f2 + t * 1.5)
          const y = mid + (y1 + y2) * 0.5 * amp
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
      } else {
        // Default: Hohmann orbital transfer simulator
        const cx = w / 2
        const cy = h / 2
        const scale = Math.min(w, h) * 0.14
        const r1 = p1 * scale
        const r2 = p2 * scale
        const a = (r1 + r2) / 2
        const c = Math.abs(r2 - r1) / 2
        const b = Math.sqrt(Math.max(100, a * a - c * c))

        // Inner & outer circular orbits
        ctx.strokeStyle = 'rgba(242,240,233,0.32)'
        ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.arc(cx, cy, r1, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy, r2, 0, Math.PI * 2); ctx.stroke()

        // Transfer ellipse
        ctx.strokeStyle = '#ffee00'
        ctx.setLineDash([5, 5])
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.ellipse(cx + (r1 < r2 ? -c : c), cy, a, b, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])

        // Central star/planet
        ctx.fillStyle = '#ff4800'
        ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill()

        // Orbiting craft along transfer ellipse
        const ecx = cx + (r1 < r2 ? -c : c)
        const px = ecx + a * Math.cos(t)
        const py = cy + b * Math.sin(t)
        ctx.fillStyle = '#ffee00'
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2); ctx.fill()
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [type, p1, p2])

  // Calculate live telemetry readout for the simulation
  let readout = ''
  if (type === 'pendulum') {
    const period = (2 * Math.PI * Math.sqrt(1.4 / p2) * (1 + Math.pow((p1 * Math.PI) / 180, 2) / 16)).toFixed(2)
    readout = `T ≈ ${period} s · θ₀ = ${p1.toFixed(0)}° · g = ${p2.toFixed(2)} m/s²`
  } else if (type === 'wave') {
    readout = `f₁ = ${p1.toFixed(1)} Hz · f₂ = ${p2.toFixed(1)} Hz · Δf = ${Math.abs(p2 - p1).toFixed(1)} Hz`
  } else {
    // Hohmann delta-v (normalised to Earth LEO/GEO scale, mu = 1, v_circ = 29.78 / sqrt(r))
    const v0 = 29.78
    const v1 = v0 / Math.sqrt(p1)
    const v2 = v0 / Math.sqrt(p2)
    const a = (p1 + p2) / 2
    const dv1 = Math.abs(v0 * Math.sqrt(2 / p1 - 1 / a) - v1)
    const dv2 = Math.abs(v2 - v0 * Math.sqrt(2 / p2 - 1 / a))
    readout = `r₁ = ${p1.toFixed(2)} AU · r₂ = ${p2.toFixed(2)} AU · Total Δv = ${(dv1 + dv2).toFixed(2)} km/s`
  }

  return (
    <div className="md-sim">
      <div className="md-sim-head">
        <span>Interactive simulation / {type === 'pendulum' ? 'Nonlinear Pendulum' : type === 'wave' ? 'Wave Superposition' : 'Hohmann Orbital Transfer'}</span>
        <em>{readout}</em>
      </div>
      <canvas ref={canvasRef} width={680} height={240} />
      <div className="md-sim-controls">
        {type === 'pendulum' ? (
          <>
            <label><span>Initial angle θ₀ ({p1.toFixed(0)}°)</span><input type="range" min="5" max="150" step="1" value={p1} onChange={(e) => setP1(Number(e.target.value))} /></label>
            <label><span>Gravity g ({p2.toFixed(2)} m/s²)</span><input type="range" min="1.62" max="24.79" step="0.1" value={p2} onChange={(e) => setP2(Number(e.target.value))} /></label>
          </>
        ) : type === 'wave' ? (
          <>
            <label><span>Wave 1 frequency ({p1.toFixed(1)})</span><input type="range" min="1" max="10" step="0.2" value={p1} onChange={(e) => setP1(Number(e.target.value))} /></label>
            <label><span>Wave 2 frequency ({p2.toFixed(1)})</span><input type="range" min="1" max="10" step="0.2" value={p2} onChange={(e) => setP2(Number(e.target.value))} /></label>
          </>
        ) : (
          <>
            <label><span>Inner orbit r₁ ({p1.toFixed(2)} AU)</span><input type="range" min="0.5" max="2.5" step="0.05" value={p1} onChange={(e) => setP1(Number(e.target.value))} /></label>
            <label><span>Outer orbit r₂ ({p2.toFixed(2)} AU)</span><input type="range" min="0.8" max="3.2" step="0.05" value={p2} onChange={(e) => setP2(Number(e.target.value))} /></label>
          </>
        )}
      </div>
    </div>
  )
}

/** Parse inline markdown: $math$, `code`, **bold**, *italic*, ~~strike~~, ![alt](src) and [text](url). */
function renderInline(text: string, onImageClick?: (src: string, alt: string) => void): ReactNode[] {
  const tokens: ReactNode[] = []
  const pattern = /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\$([^$\n]+)\$)|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(\*([^*]+)\*|_([^_]+)_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) tokens.push(text.slice(lastIndex, match.index))
    if (match[1]) {
      const alt = match[2]
      const src = match[3]
      if (/^(\/uploads\/|https?:\/\/)/i.test(src)) {
        tokens.push(
          <img
            key={key++}
            className="md-inline-img is-zoomable"
            src={src}
            alt={alt}
            loading="lazy"
            onClick={() => onImageClick?.(src, alt)}
          />,
        )
      }
    } else if (match[4]) {
      const label = match[5]
      const href = match[6]
      const safe = /^(https?:\/\/|mailto:|\/|#)/i.test(href) ? href : '#'
      const external = /^https?:\/\//i.test(safe)
      tokens.push(
        <a key={key++} href={safe} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
          {label}
        </a>,
      )
    } else if (match[7]) {
      tokens.push(<MathSpan key={key++} tex={match[8]} />)
    } else if (match[9]) {
      tokens.push(<code key={key++}>{match[10]}</code>)
    } else if (match[11]) {
      tokens.push(<strong key={key++}>{match[12]}</strong>)
    } else if (match[13]) {
      tokens.push(<del key={key++}>{match[14]}</del>)
    } else if (match[15]) {
      tokens.push(<em key={key++}>{match[16] ?? match[17]}</em>)
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) tokens.push(text.slice(lastIndex))
  return tokens
}

export function Markdown({ text, onImageClick }: { text: string; onImageClick?: (src: string, alt: string) => void }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0
  let headingCounter = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // Interactive simulation block :::sim orbit | pendulum | wave
    const simMatch = /^:::sim\s+([a-z0-9_-]+)/i.exec(line.trim())
    if (simMatch) {
      blocks.push(<SimulationBlock key={key++} kind={simMatch[1]} />)
      i++
      if (i < lines.length && lines[i].trim() === ':::') i++
      continue
    }

    // Display math block $$ ... $$
    if (line.trim().startsWith('$$')) {
      const firstLine = line.trim().slice(2)
      if (firstLine.endsWith('$$') && firstLine.length > 2) {
        blocks.push(<MathSpan key={key++} tex={firstLine.slice(0, -2).trim()} display />)
        i++
        continue
      }
      const mathLines: string[] = firstLine ? [firstLine] : []
      i++
      while (i < lines.length && !lines[i].trim().endsWith('$$')) {
        mathLines.push(lines[i])
        i++
      }
      if (i < lines.length) {
        const closing = lines[i].trim().slice(0, -2)
        if (closing) mathLines.push(closing)
        i++
      }
      blocks.push(<MathSpan key={key++} tex={mathLines.join('\n').trim()} display />)
      continue
    }

    // Fenced code block ```lang
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++
      blocks.push(<CodeBlock key={key++} lang={lang} code={codeLines.join('\n')} />)
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="md-hr" />)
      i++
      continue
    }

    // Headings # / ## / ###
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line)
    if (headingMatch) {
      const level = headingMatch[1].length
      const rawText = headingMatch[2]
      const cleanText = rawText.replace(/[*_`~]/g, '').trim()
      const hid = `h-${slugify(cleanText)}-${headingCounter++}`
      const content = renderInline(rawText, onImageClick)
      if (level === 1) blocks.push(<h2 id={hid} key={key++} className="md-h1">{content}</h2>)
      else if (level === 2) blocks.push(<h3 id={hid} key={key++} className="md-h2">{content}</h3>)
      else blocks.push(<h4 id={hid} key={key++} className="md-h3">{content}</h4>)
      i++
      continue
    }

    // Blockquote >
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push(<blockquote key={key++} className="md-quote">{renderInline(quoteLines.join('\n'), onImageClick)}</blockquote>)
      continue
    }

    // Unordered list - or *
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*[-*]\s+/, ''), onImageClick)}</li>)
        i++
      }
      blocks.push(<ul key={key++} className="md-list">{items}</ul>)
      continue
    }

    // Ordered list 1.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''), onImageClick)}</li>)
        i++
      }
      blocks.push(<ol key={key++} className="md-list">{items}</ol>)
      continue
    }

    // Regular paragraph
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('$$') &&
      !lines[i].trim().startsWith(':::sim') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('>') &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,})$/.test(lines[i].trim())
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(<p key={key++}>{renderInline(para.join('\n'), onImageClick)}</p>)
  }

  return <div className="prose">{blocks}</div>
}

/** 3D Tilt & Zoom Fullscreen Lightbox for technical diagrams and project photos. */
export function Lightbox({ item, onClose }: { item: { src: string; alt: string } | null; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 })

  useEffect(() => {
    setZoom(1)
    setTilt({ rx: 0, ry: 0 })
  }, [item])

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, +(z + 0.4).toFixed(1)))
      if (e.key === '-') setZoom((z) => Math.max(0.6, +(z - 0.4).toFixed(1)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  if (!item) return null

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.alt || 'Image viewer'}
      onClick={onClose}
      onMouseMove={(e) => {
        const rx = ((e.clientY / window.innerHeight - 0.5) * -14).toFixed(2)
        const ry = ((e.clientX / window.innerWidth - 0.5) * 14).toFixed(2)
        setTilt({ rx: Number(rx), ry: Number(ry) })
      }}
    >
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>{item.alt || 'Technical view'} · {Math.round(zoom * 100)}%</span>
        <div className="lightbox-actions">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.4).toFixed(1)))}>− Zoom out</button>
          <button type="button" onClick={() => setZoom(1)}>100%</button>
          <button type="button" onClick={() => setZoom((z) => Math.min(4, +(z + 0.4).toFixed(1)))}>+ Zoom in</button>
          <button type="button" onClick={onClose}>Close ✕</button>
        </div>
      </div>
      <div
        className="lightbox-stage"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          e.preventDefault()
          setZoom((z) => Math.min(4, Math.max(0.6, +(z + (e.deltaY < 0 ? 0.25 : -0.25)).toFixed(2))))
        }}
      >
        <img
          src={item.src}
          alt={item.alt}
          style={{
            transform: `perspective(1100px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) scale(${zoom})`,
          }}
        />
      </div>
    </div>
  )
}

/** Rich Markdown textarea with formatting, LaTeX & Simulation toolbar + live preview for the Admin panel. */
export function MarkdownField({
  label,
  value,
  onChange,
  rows = 14,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  rows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)

  const wrap = (before: string, after = '', placeholder = 'text') => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  return (
    <div className="cms-field">
      <div className="md-toolbar-row">
        <span>{label}</span>
        <div className="md-toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" title="Heading 2" onClick={() => wrap('## ', '', 'Section heading')}>H2</button>
          <button type="button" title="Heading 3" onClick={() => wrap('### ', '', 'Subheading')}>H3</button>
          <button type="button" title="Bold" onClick={() => wrap('**', '**', 'bold')}><b>B</b></button>
          <button type="button" title="Italic" onClick={() => wrap('*', '*', 'italic')}><i>I</i></button>
          <button type="button" title="Inline LaTeX math" onClick={() => wrap('$', '$', 'E = mc^2')}>∑ Math</button>
          <button type="button" title="Block LaTeX equation" onClick={() => wrap('\n$$\n', '\n$$\n', '\\Delta v = v_e \\ln \\frac{m_0}{m_f}')}>$$ Eq</button>
          <button type="button" title="Code block" onClick={() => wrap('\n```python\n', '\n```\n', 'def orbit():\n    pass')}>Code</button>
          <button type="button" title="Orbital simulation" onClick={() => wrap('\n:::sim orbit\n', '', '')}>🪐 Orbit Sim</button>
          <button type="button" title="Pendulum simulation" onClick={() => wrap('\n:::sim pendulum\n', '', '')}>⏱ Pendulum</button>
          <button type="button" title="Wave simulation" onClick={() => wrap('\n:::sim wave\n', '', '')}>〰 Wave</button>
          <button type="button" title="Quote" onClick={() => wrap('> ', '', 'quote')}>“ ”</button>
          <button type="button" title="Link" onClick={() => wrap('[', '](https://example.com)', 'link text')}>Link</button>
          <button type="button" className={preview ? 'is-active' : undefined} onClick={() => setPreview(!preview)}>
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
      </div>
      {preview ? (
        <div className="md-preview">{value.trim() ? <Markdown text={value} /> : <p className="cms-muted">Nothing to preview yet.</p>}</div>
      ) : (
        <textarea ref={ref} value={value} rows={rows} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  )
}
