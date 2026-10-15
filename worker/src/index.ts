export interface Env {
  OPENROUTER_API_KEY?: string
  TRIPO_API_KEY?: string
  ALLOWED_ORIGIN?: string
  OPENROUTER_MODEL?: string
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })
const limits = new Map<string, { count: number; reset: number }>()
const MAX_BODY = 24_000

function cors(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean)
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  })
  if (allowed.includes(origin) || local) headers.set('Access-Control-Allow-Origin', origin)
  return headers
}
function limited(request: Request): boolean {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const now = Date.now()
  const current = limits.get(ip)
  if (!current || current.reset < now) { limits.set(ip, { count: 1, reset: now + 60_000 }); return false }
  current.count += 1
  return current.count > 20
}
function errorMessage(data: any, fallback: string) {
  return typeof data?.error?.message === 'string' ? data.error.message :
    typeof data?.message === 'string' ? data.message : fallback
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request, env)
    const origin = request.headers.get('Origin') || ''
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean)
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (origin && !allowed.includes(origin) && !local) return json({ error: 'This website is not allowed to use the API.' }, 403)
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return json({ service: 'Lite AI API', status: 'ready' }, 200, headers)
    if (request.method === 'POST' && Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json({ error: 'Request is too large.' }, 413, headers)
    if (limited(request)) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429, { ...Object.fromEntries(headers) })

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      if (!env.OPENROUTER_API_KEY) return json({ error: 'Chat is not configured. Add OPENROUTER_API_KEY as a Worker secret.' }, 503, headers)
      let input: any
      try { input = await request.json() } catch { return json({ error: 'Invalid JSON body.' }, 400, headers) }
      if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 40) return json({ error: 'Send between 1 and 40 messages.' }, 400, headers)
      const messages = input.messages.map((m: any) => {
        if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new Error('invalid')
        return { role: m.role, content: m.content.slice(0, 8000) }
      })
      if (messages.some((m: any) => !m.content.trim())) return json({ error: 'Messages cannot be empty.' }, 400, headers)
      const model = typeof input.model === 'string' && /^[a-zA-Z0-9._/-]{2,120}$/.test(input.model) ? input.model : (env.OPENROUTER_MODEL || 'openrouter/auto')
      const payload: any = { model, messages, stream: input.stream !== false, max_tokens: 1800, temperature: 0.7 }
      if (input.search === true) payload.plugins = [{ id: 'web' }]
      let upstream: Response
      try {
        upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.OPENROUTER_API_KEY, 'Content-Type': 'application/json', 'HTTP-Referer': env.ALLOWED_ORIGIN?.split(',')[0] || 'https://liteempire.github.io/Echo/', 'X-Title': 'Lite AI' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(110_000),
        })
      } catch {
        return json({ error: 'The chat provider could not be reached. Please try again.' }, 502, headers)
      }
      if (!upstream.ok) {
        let data: any = {}
        try { data = await upstream.json() } catch {}
        return json({ error: errorMessage(data, 'The chat provider rejected this request.'), providerStatus: upstream.status }, upstream.status === 429 ? 429 : 502, headers)
      }
      const responseHeaders = new Headers(headers)
      responseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8')
      responseHeaders.set('Cache-Control', 'no-cache, no-transform')
      responseHeaders.set('X-Content-Type-Options', 'nosniff')
      return new Response(upstream.body, { status: 200, headers: responseHeaders })
    }

    if (url.pathname === '/api/3d' && request.method === 'POST') {
      if (!env.TRIPO_API_KEY) return json({ error: '3D generation is not configured. Add TRIPO_API_KEY as a Worker secret.' }, 503, headers)
      let input: any
      try { input = await request.json() } catch { return json({ error: 'Invalid JSON body.' }, 400, headers) }
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 1024) return json({ error: 'Prompt must be 1–1024 characters.' }, 400, headers)
      try {
        const upstream = await fetch('https://openapi.tripo3d.ai/v3/generation/text-to-model', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.TRIPO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: input.prompt.trim(), model: 'v3.1-20260211', texture: true, pbr: true }),
          signal: AbortSignal.timeout(30_000),
        })
        const data: any = await upstream.json()
        if (!upstream.ok || data.code !== 0 || !data.data?.task_id) return json({ error: errorMessage(data, 'Tripo could not start this task.') }, upstream.status === 429 ? 429 : 502, headers)
        return json({ task_id: data.data.task_id }, 202, headers)
      } catch { return json({ error: 'Tripo could not be reached. Please try again.' }, 502, headers) }
    }

    const taskMatch = url.pathname.match(/^\/api\/3d\/([A-Za-z0-9_-]{1,160})$/)
    if (taskMatch && request.method === 'GET') {
      if (!env.TRIPO_API_KEY) return json({ error: '3D generation is not configured.' }, 503, headers)
      try {
        const upstream = await fetch('https://openapi.tripo3d.ai/v3/tasks/' + encodeURIComponent(taskMatch[1]), {
          headers: { 'Authorization': 'Bearer ' + env.TRIPO_API_KEY },
          signal: AbortSignal.timeout(15_000),
        })
        const data: any = await upstream.json()
        if (!upstream.ok || data.code !== 0 || !data.data) return json({ error: errorMessage(data, 'Could not check Tripo task status.') }, upstream.status === 429 ? 429 : 502, headers)
        const task = data.data
        return json({ task_id: task.task_id, status: task.status, progress: task.progress, output: task.output || null }, 200, headers)
      } catch { return json({ error: 'Could not reach Tripo to check task status.' }, 502, headers) }
    }

    return json({ error: 'Endpoint not found.' }, 404, headers)
  },
}
