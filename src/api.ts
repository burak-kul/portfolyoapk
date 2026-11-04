import type { AnalyticsSummary, ContactMessage, Content } from './types'

const SERVER_KEY = 'burak-admin-server-url'
const TOKEN_KEY = 'burak-admin-auth-token'

export const getServerUrl = (): string => (localStorage.getItem(SERVER_KEY) || '').replace(/\/+$/, '')
export const setServerUrl = (url: string) => localStorage.setItem(SERVER_KEY, url.trim().replace(/\/+$/, ''))

export const getAuthToken = (): string => localStorage.getItem(TOKEN_KEY) || ''
export const setAuthToken = (token: string) => {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/** Resolve relative `/uploads/...` URLs against the configured remote server when running inside the mobile APK. */
export function resolveAssetUrl(url: string): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  const base = getServerUrl()
  return base && url.startsWith('/') ? `${base}${url}` : url
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const base = getServerUrl()
  const fullUrl = base && url.startsWith('/') ? `${base}${url}` : url
  const token = getAuthToken()
  const headers = new Headers(init?.headers || {})
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`)

  const response = await fetch(fullUrl, {
    credentials: base ? 'omit' : 'same-origin',
    ...init,
    headers,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data as T
}

const MAX_SIDE = 2000

/** Downscale big photos in the browser before upload (keeps GIFs, PDFs and small images untouched). */
async function shrink(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1_500_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.86))
    return blob && blob.size < file.size ? new File([blob], file.name, { type: file.type }) : file
  } catch {
    return file
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  getContent: () => request<Content>('/api/content'),
  saveContent: (content: Content) => request<Content>('/api/content', json('PUT', content)),
  session: () => request<{ authenticated: boolean }>('/api/session'),
  login: async (password: string) => {
    const res = await request<{ authenticated: boolean; token?: string }>('/api/login', json('POST', { password }))
    if (res.token) setAuthToken(res.token)
    return res
  },
  changePassword: (current: string, next: string) => request<{ ok: boolean }>('/api/password', json('POST', { current, next })),
  logout: async () => {
    const res = await request<{ authenticated: boolean }>('/api/logout', { method: 'POST' }).catch(() => ({ authenticated: false }))
    setAuthToken('')
    return res
  },
  upload: async (file: File) => {
    const processed = await shrink(file)
    return request<{ url: string }>('/api/upload', { method: 'POST', headers: { 'content-type': processed.type }, body: processed })
  },
  trackHit: (path: string) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    const lang = navigator.language || ''
    void fetch('/api/hit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, referrer: document.referrer || '', tz, lang }),
    }).catch(() => {})
  },
  getAnalytics: () => request<AnalyticsSummary>('/api/analytics'),
  clearAnalytics: () => request<{ ok: boolean }>('/api/analytics', { method: 'DELETE' }),
  sendMessage: (payload: { name: string; email: string; subject: string; body: string }) =>
    request<{ ok: boolean }>('/api/messages', json('POST', payload)),
  getMessages: () => request<{ messages: ContactMessage[]; unreadCount: number }>('/api/messages'),
  markMessageRead: (id: string, read = true) => request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}`, json('PATCH', { read })),
  deleteMessage: (id: string) => request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
