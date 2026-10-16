import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Sparkles, Plus, Pencil, PanelLeftClose, PanelLeftOpen, Settings2, Sun, Moon, Globe2, Box, ArrowUp, Square, Copy, RefreshCw, Trash2, X, MessageSquare, Paperclip, Check, AlertCircle, ExternalLink } from 'lucide-react'

type Message = { id: string; role: 'user' | 'assistant'; content: string; error?: boolean }
type Chat = { id: string; title: string; updated: number; messages: Message[] }
type Prefs = { theme: 'dark' | 'light'; accent: string; model: string; memory: boolean }
const API = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const CHAT_KEY = 'echo-chats-v1'
const PREF_KEY = 'echo-prefs-v1'
const id = () => crypto.randomUUID()
const makeChat = (): Chat => ({ id: id(), title: 'New conversation', updated: Date.now(), messages: [] })
const readChats = (): Chat[] => { try { const x = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); return Array.isArray(x) ? x : [] } catch { return [] } }
const readPrefs = (): Prefs => { try { return { theme: 'dark', accent: '#8b7cff', model: 'openrouter/auto', memory: true, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } } catch { return { theme: 'dark', accent: '#8b7cff', model: 'openrouter/auto', memory: true } } }
const shortTitle = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 34) || 'New conversation'

export default function App() {
  const [chats, setChats] = useState<Chat[]>(readChats)
  const [activeId, setActiveId] = useState(() => readChats()[0]?.id || '')
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const [sidebar, setSidebar] = useState(true)
  const [settings, setSettings] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState(false)
  const [notice, setNotice] = useState('')
  const [rename, setRename] = useState('')
  const [renameId, setRenameId] = useState('')
  const [studio, setStudio] = useState(false)
  const [prompt3d, setPrompt3d] = useState('')
  const [studioStatus, setStudioStatus] = useState('')
  const [task3dId, setTask3dId] = useState('')
  const [modelOutput, setModelOutput] = useState<{model_url?: string; rendered_image_url?: string} | null>(null)
  const [copied, setCopied] = useState('')
  const aborter = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const active = chats.find(c => c.id === activeId)
  const configured = Boolean(API)

  useEffect(() => { localStorage.setItem(CHAT_KEY, JSON.stringify(chats)) }, [chats])
  useEffect(() => { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); document.documentElement.dataset.theme = prefs.theme; document.documentElement.style.setProperty('--accent', prefs.accent) }, [prefs])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [active?.messages, busy])
  const patchPrefs = (p: Partial<Prefs>) => setPrefs(x => ({ ...x, ...p }))
  const patchChat = (cid: string, fn: (c: Chat) => Chat) => setChats(xs => xs.map(c => c.id === cid ? fn(c) : c))
  const add = (cid: string, m: Message) => patchChat(cid, c => ({ ...c, updated: Date.now(), title: c.messages.length === 0 && m.role === 'user' ? shortTitle(m.content) : c.title, messages: [...c.messages, m] }))
  const patchMessage = (cid: string, mid: string, p: Partial<Message>) => patchChat(cid, c => ({ ...c, messages: c.messages.map(m => m.id === mid ? { ...m, ...p } : m) }))
  const createChat = () => { const c = makeChat(); setChats(xs => [c, ...xs]); setActiveId(c.id); setText(''); setNotice(''); if (window.innerWidth < 700) setSidebar(false) }
  const ensureChat = () => { if (active) return active; const c = makeChat(); setChats(xs => [c, ...xs]); setActiveId(c.id); return c }
  const stop = () => { aborter.current?.abort(); aborter.current = null; setBusy(false) }

  async function send(value = text) {
    const body = value.trim()
    if (!body || busy) return
    const chat = ensureChat()
    const user: Message = { id: id(), role: 'user', content: body }
    const assistant: Message = { id: id(), role: 'assistant', content: '' }
    add(chat.id, user); add(chat.id, assistant); setText(''); setNotice('')
    const history = [...chat.messages, user].map(m => ({ role: m.role, content: m.content }))
    if (!API) {
      patchMessage(chat.id, assistant.id, { content: 'Live AI is not connected yet. Set VITE_API_BASE_URL to your secure backend URL and configure a chat-model API key on the backend. Tripo is integrated separately for 3D generation.', error: true })
      setNotice('Backend setup required — see README.md.'); return
    }
    const controller = new AbortController(); aborter.current = controller; setBusy(true)
    const timer = window.setTimeout(() => controller.abort(), 120000)
    try {
      const res = await fetch(API + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ model: prefs.model, search, memory: prefs.memory, messages: prefs.memory ? history : history.slice(-1) }) })
      if (!res.ok) { let msg = 'The AI service could not answer.'; try { msg = (await res.json()).error || msg } catch {} throw new Error(msg) }
      if ((res.headers.get('content-type') || '').includes('text/event-stream') && res.body) {
        const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
        while (true) {
          const { done, value } = await reader.read(); if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n'); buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue
            const packet = JSON.parse(data); if (packet.error) throw new Error(packet.error)
            const chunk = packet.choices?.[0]?.delta?.content || ''
            if (chunk) setChats(xs => xs.map(c => c.id === chat.id ? { ...c, messages: c.messages.map(m => m.id === assistant.id ? { ...m, content: m.content + chunk } : m) } : c))
          }
        }
      } else {
        const data = await res.json()
        const answer = data.choices?.[0]?.message?.content ?? data.content ?? data.answer
        if (typeof answer !== 'string') throw new Error('Unexpected response format from AI.')
        patchMessage(chat.id, assistant.id, { content: answer })
      }
      setChats(xs => xs.map(c => c.id === chat.id ? { ...c, messages: c.messages.map(m => m.id === assistant.id && !m.content ? { ...m, content: 'The model returned an empty answer. Please try again.', error: true } : m) } : c))
    } catch (e) {
      patchMessage(chat.id, assistant.id, { content: controller.signal.aborted ? 'Request stopped or timed out. Please try again.' : (e instanceof Error ? e.message : 'Request failed.'), error: true })
      setNotice('Request failed. Check the backend and your connection.')
    } finally { clearTimeout(timer); aborter.current = null; setBusy(false) }
  }

  async function retry(message: Message) {
    if (!active || busy || !configured) return
    const index = active.messages.findIndex(m => m.id === message.id)
    const history = active.messages.slice(0, index).map(m => ({ role: m.role, content: m.content }))
    patchMessage(active.id, message.id, { content: '', error: false })
    const controller = new AbortController(); aborter.current = controller; setBusy(true)
    try {
      const res = await fetch(API + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ model: prefs.model, search, memory: prefs.memory, stream: false, messages: prefs.memory ? history : history.slice(-1) }) })
      if (!res.ok) throw new Error((await res.json()).error || 'Retry failed.')
      const data = await res.json(); patchMessage(active.id, message.id, { content: data.choices?.[0]?.message?.content ?? data.content ?? data.answer ?? 'Empty answer.' })
    } catch (e) { patchMessage(active.id, message.id, { content: e instanceof Error ? e.message : 'Retry failed.', error: true }) }
    finally { aborter.current = null; setBusy(false) }
  }

  async function generate3D() {
    if (!prompt3d.trim()) return
    if (!API) { setStudioStatus('Configure VITE_API_BASE_URL and the server-side TRIPO_API_KEY first.'); return }
    setStudioStatus('Sending request to Tripo…'); setModelOutput(null); setTask3dId('')
    try {
      const res = await fetch(API + '/api/3d', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt3d.trim() }) })
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not start generation.')
      setTask3dId(data.task_id)
      setStudioStatus('Task submitted. Check status again shortly.')
      const check = await fetch(API + '/api/3d/' + encodeURIComponent(data.task_id))
      const task = await check.json(); if (!check.ok) throw new Error(task.error || 'Could not query task.')
      setModelOutput(task.output || null); setStudioStatus(task.status === 'success' ? 'Model ready.' : 'Generation status: ' + task.status + (task.progress != null ? ' (' + task.progress + '%)' : ''))
    } catch (e) { setStudioStatus(e instanceof Error ? e.message : '3D generation failed.') }
  }

  async function check3DStatus() {
    if (!task3dId || !API) return
    setStudioStatus('Checking Tripo task…')
    try {
      const res = await fetch(API + '/api/3d/' + encodeURIComponent(task3dId))
      const task = await res.json()
      if (!res.ok) throw new Error(task.error || 'Could not check task.')
      setModelOutput(task.output || null)
      setStudioStatus(task.status === 'success' ? 'Model ready.' : 'Generation status: ' + task.status + (task.progress != null ? ' (' + task.progress + '%)' : '') + '. Check again in a moment.')
    } catch (e) { setStudioStatus(e instanceof Error ? e.message : 'Could not check task status.') }
  }

  const copy = async (m: Message) => { try { await navigator.clipboard.writeText(m.content); setCopied(m.id); setTimeout(() => setCopied(''), 1300) } catch { setNotice('Clipboard access was blocked by your browser.') } }
  const removeChat = (cid: string) => { const rest = chats.filter(c => c.id !== cid); setChats(rest); if (activeId === cid) setActiveId(rest[0]?.id || '') }
  const sorted = [...chats].sort((a, b) => b.updated - a.updated)

  return <div className="app-shell">
    {sidebar && <div className="mobile-scrim" onClick={() => setSidebar(false)} />}
    <aside className={sidebar ? 'sidebar sidebar-open' : 'sidebar sidebar-closed'}>
      <div className="brand-row"><div className="brand-mark"><Sparkles size={19}/></div><div className="brand-copy"><strong>echo</strong><small>YOUR THINKING SPACE</small></div><button className="icon-button sidebar-collapse" aria-label="Collapse sidebar" onClick={() => setSidebar(false)}><PanelLeftClose size={18}/></button></div>
      <button className="new-chat-button" onClick={createChat}><Plus size={17}/> New chat <span className="shortcut">⌘ K</span></button>
      <div className="side-label">WORKSPACE</div>
      <button className="nav-item active"><MessageSquare size={17}/> Conversations</button>
      <button className="nav-item" onClick={() => setStudio(true)}><Box size={17}/> 3D studio <span className="mini-tag">BETA</span></button>
      <div className="history-heading"><span className="side-label">RECENT</span><button className="tiny-icon" aria-label="New chat" onClick={createChat}><Plus size={15}/></button></div>
      <div className="history-list">{sorted.length === 0 && <div className="empty-history">Your conversations will appear here.</div>}
        {sorted.map(c => <div className={'history-row ' + (c.id === activeId ? 'selected' : '')} key={c.id}>
          {renameId === c.id ? <form className="rename-form" onSubmit={e => { e.preventDefault(); patchChat(c.id, x => ({ ...x, title: rename.trim() || x.title })); setRenameId('') }}><input value={rename} autoFocus onChange={e => setRename(e.target.value)}/></form> : <button className="history-name" title={c.title} onClick={() => { setActiveId(c.id); if (window.innerWidth < 700) setSidebar(false) }}><span className="history-dot"/>{c.title}</button>}
          <button className="history-menu" title="Rename conversation" onClick={() => { setRenameId(c.id); setRename(c.title) }}>···</button><button className="history-menu" title="Delete conversation" onClick={() => removeChat(c.id)}><Trash2 size={13}/></button>
        </div>)}
      </div>
      <div className="sidebar-bottom"><div className="connection-state"><span className={'state-dot ' + (configured ? 'online' : '')}/>{configured ? 'Backend configured' : 'Setup required'}<span className="connection-right">{configured ? 'API' : 'OFF'}</span></div>
        <button className="profile-row" onClick={() => setSettings(true)}><div className="avatar">L</div><div className="profile-copy"><strong>Echo</strong><small>Personal workspace</small></div><Settings2 size={17} className="profile-settings"/></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="top-left">{!sidebar && <button className="icon-button" aria-label="Open sidebar" onClick={() => setSidebar(true)}><PanelLeftOpen size={19}/></button>}<div className="model-select-wrap"><span className="model-orb"><Sparkles size={14}/></span><span className="model-name">Echo</span><span className="model-pill">Preview</span></div></div>
        <div className="top-actions"><button className={'top-action ' + (search ? 'toggled' : '')} onClick={() => setSearch(x => !x)} title="Search requires a compatible backend"><Globe2 size={16}/><span>Search</span></button><button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}><Settings2 size={18}/></button><button className="icon-button" aria-label="Toggle theme" onClick={() => patchPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}>{prefs.theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button></div>
      </header>
      <section className={'chat-scroll ' + (active?.messages.length ? 'has-messages' : '')}>
        {!active?.messages.length ? <div className="welcome"><div className="welcome-kicker"><span className="kicker-line"/>A CLEARER WAY TO THINK<span className="kicker-line"/></div><div className="welcome-symbol"><div className="symbol-halo"/><Sparkles size={31}/></div><h1>Good ideas start<br/><span>with a conversation.</span></h1><p className="welcome-subtitle">A calm, capable space to explore ideas, solve problems, write code, and create something new.</p>
          <div className="prompt-grid"><button className="prompt-card" onClick={() => setText('Explain a complex idea in a simple, intuitive way.')}><span className="prompt-icon lavender"><Sparkles size={17}/></span><strong>Learn something</strong><small>Make difficult ideas feel simple</small><ArrowUp size={15} className="prompt-arrow"/></button><button className="prompt-card" onClick={() => setText('Help me brainstorm an original creative project.')}><span className="prompt-icon peach"><Sparkles size={17}/></span><strong>Explore an idea</strong><small>Turn a spark into a plan</small><ArrowUp size={15} className="prompt-arrow"/></button><button className="prompt-card" onClick={() => setText('Help me debug this code and explain the fix step by step.')}><span className="prompt-icon blue"><Settings2 size={17}/></span><strong>Build something</strong><small>Code, debug, and iterate</small><ArrowUp size={15} className="prompt-arrow"/></button><button className="prompt-card" onClick={() => { setStudio(true); setPrompt3d('A futuristic desk companion robot, smooth ceramic shell, mint accent lights') }}><span className="prompt-icon mint"><Box size={17}/></span><strong>Create in 3D</strong><small>Bring a concept into 3D</small><ArrowUp size={15} className="prompt-arrow"/></button></div></div> :
          <div className="messages-wrap">{active.messages.map((m, i) => <article key={m.id} className={'message-row ' + m.role + (m.error ? ' message-error' : '')}><div className={'message-avatar ' + (m.role === 'assistant' ? 'assistant-avatar' : 'user-avatar')}>{m.role === 'assistant' ? <Sparkles size={16}/> : 'Y'}</div><div className="message-content"><div className="message-author">{m.role === 'assistant' ? 'Echo' : 'You'}<span>· {m.role.toUpperCase()}</span></div>{m.content ? <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{m.content}</ReactMarkdown></div> : <div className="typing-indicator"><span/><span/><span/></div>}
            {m.content && <div className="message-tools"><button onClick={() => copy(m)}>{copied === m.id ? <Check size={14}/> : <Copy size={14}/>}<span>{copied === m.id ? 'Copied' : 'Copy'}</span></button>{m.role === 'user' && <button onClick={() => { const ix = active.messages.findIndex(x => x.id === m.id); setChats(xs => xs.map(c => c.id === active.id ? { ...c, messages: c.messages.slice(0, ix) } : c)); setText(m.content) }}><Pencil size={14}/><span>Edit</span></button>}{m.role === 'assistant' && i === active.messages.length - 1 && <button disabled={busy || !configured} onClick={() => retry(m)}><RefreshCw size={14}/><span>Regenerate</span></button>}</div>}</div></article>)}{busy && <div className="stream-status"><span className="stream-pulse"/> Echo is thinking… <button onClick={stop}><Square size={12}/> Stop</button></div>}<div ref={bottom}/></div>}
      </section>
      <div className="composer-zone">{notice && <div className="status-message"><AlertCircle size={14}/>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14}/></button></div>}
        {!configured && !active?.messages.length && <div className="setup-notice"><span className="notice-dot"/><span><strong>One setup step left.</strong> Add a backend URL to enable live AI responses.</span><button onClick={() => setSettings(true)}>Configure →</button></div>}
        <form className="composer" onSubmit={e => { e.preventDefault(); void send() }}><textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} placeholder="Message Echo…" rows={1} aria-label="Message Echo"/><div className="composer-bottom"><div className="composer-tools"><button type="button" className="composer-tool" onClick={() => setNotice('Uploads are not enabled yet; this control is a placeholder.')}><Paperclip size={16}/><span>Attach</span></button><button type="button" className="composer-tool" onClick={() => setStudio(true)}><Box size={16}/><span>3D Studio</span></button></div><div className="send-group"><span className="enter-hint">↵ to send</span><button type={busy ? 'button' : 'submit'} className={'send-button ' + (text.trim() ? 'ready' : '')} disabled={!busy && !text.trim()} onClick={busy ? stop : undefined} aria-label={busy ? 'Stop response' : 'Send message'}>{busy ? <Square size={15} fill="currentColor"/> : <ArrowUp size={18}/>}</button></div></div></form><div className="disclaimer">Echo can make mistakes. Check important information. <span>·</span> Chats are saved in this browser.</div>
      </div>
    </main>
    {settings && <div className="modal-backdrop" onClick={() => setSettings(false)}><section className="settings-modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">PREFERENCES</span><h2>Settings</h2></div><button className="icon-button" onClick={() => setSettings(false)} aria-label="Close"><X size={19}/></button></div>
      <div className="settings-section"><h3>Appearance</h3><p>Make your workspace feel like yours.</p><div className="setting-row"><div><strong>Theme</strong><small>Choose light or dark appearance</small></div><div className="segmented"><button className={prefs.theme === 'dark' ? 'chosen' : ''} onClick={() => patchPrefs({ theme: 'dark' })}><Moon size={14}/> Dark</button><button className={prefs.theme === 'light' ? 'chosen' : ''} onClick={() => patchPrefs({ theme: 'light' })}><Sun size={14}/> Light</button></div></div><div className="setting-row"><div><strong>Accent color</strong><small>Customize highlights</small></div><div className="swatches">{[['Violet','#8b7cff'],['Blue','#5b8cff'],['Mint','#48c7a5'],['Rose','#f078a8'],['Amber','#e9ac53']].map(([name,color]) => <button key={color} title={name} aria-label={name} className={'swatch ' + (prefs.accent === color ? 'chosen' : '')} style={{ background: color }} onClick={() => patchPrefs({ accent: color })}/>)}</div></div></div>
      <div className="settings-section"><h3>AI & privacy</h3><p>Chat history and preferences are stored locally in this browser.</p><div className="setting-row"><div><strong>Conversation context</strong><small>Send current chat history with each request</small></div><button className={'switch ' + (prefs.memory ? 'on' : '')} role="switch" aria-checked={prefs.memory} onClick={() => patchPrefs({ memory: !prefs.memory })}><span/></button></div><div className="setting-row"><div><strong>Chat model</strong><small>Must be supported by your backend</small></div><select className="model-input" value={prefs.model} onChange={e => patchPrefs({ model: e.target.value })}><option value="openrouter/auto">Automatic (OpenRouter)</option><option value="openai/gpt-4o-mini">GPT-4o mini</option><option value="anthropic/claude-3.5-haiku">Claude Haiku</option></select></div><div className="setting-row"><div><strong>Backend URL</strong><small>{API || 'Not configured · see .env.example'}</small></div><span className={'status-badge ' + (configured ? 'good' : '')}>{configured ? 'Configured' : 'Not set'}</span></div><div className="setting-row"><div><strong>Clear conversations</strong><small>Remove saved history from this browser</small></div><button className="danger-button" onClick={() => { setChats([]); setActiveId(''); localStorage.removeItem(CHAT_KEY); setSettings(false) }}><Trash2 size={14}/> Clear all</button></div></div><div className="settings-foot"><span>Echo · Preview</span><button onClick={() => setSettings(false)}>Done</button></div></section></div>}
    {studio && <div className="modal-backdrop" onClick={() => setStudio(false)}><section className="settings-modal studio-modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">TRIPO INTEGRATION</span><h2><Box size={21}/> 3D Studio</h2></div><button className="icon-button" onClick={() => setStudio(false)} aria-label="Close 3D studio"><X size={19}/></button></div><p className="studio-intro">Generate a 3D model from text using Tripo. This may consume your Tripo credits.</p><label className="field-label" htmlFor="model-prompt">Describe your model</label><textarea id="model-prompt" className="studio-textarea" rows={4} maxLength={1024} value={prompt3d} onChange={e => setPrompt3d(e.target.value)} placeholder="A tiny ceramic fox figurine with amber details…"/><div className="studio-meta"><span>{prompt3d.length}/1024 characters</span><span>Text-to-3D · Tripo</span></div><button className="studio-generate" disabled={!prompt3d.trim()} onClick={() => void generate3D()}><Sparkles size={16}/> Generate 3D model <ArrowUp size={16}/></button>{studioStatus && <div className="studio-status"><span className="notice-dot"/>{studioStatus}</div>}{task3dId && !modelOutput?.model_url && <button className="studio-generate" onClick={() => void check3DStatus()}>Check generation status <RefreshCw size={14}/></button>}{modelOutput?.rendered_image_url && <img className="model-preview" src={modelOutput.rendered_image_url} alt="Generated 3D model preview"/>}{modelOutput?.model_url && <a className="download-model" href={modelOutput.model_url} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Open / download model (.glb)</a>}<div className="studio-footnote"><AlertCircle size={14}/> API credentials stay on the backend. A Tripo key and configured Worker are required.</div></section></div>}
  </div>
}
