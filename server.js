import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { getChapter, getVariantText } from './src/close-reading/corpus.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
const dataFile = path.join(dataDir, 'store.json')
const PORT = process.env.PORT || 8787
const app = express()
app.use(express.json({ limit: '2mb' }))

const demoUser = { id: 'user-demo', name: '林舟', handle: 'linzhou', initials: 'LZ' }
const seed = {
  users: [demoUser],
  projects: [
    {
      id: 'proj-salt-wind', title: '盐与风的航线', description: '在潮汐尽头，寻找一座不存在的岛。', visibility: 'private',
      cover: { kind: 'image', value: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80', name: 'salt-wind.jpg' },
      ownerId: demoUser.id, createdAt: '2026-09-08T09:30:00.000Z', updatedAt: '2026-09-16T10:24:00.000Z',
      draft: { id: 'draft-salt-wind', content: '潮水退去以后，港口只剩下一种颜色。\n\n我把地图折成四份，塞进旧风衣的内袋。', version: 7, updatedAt: '2026-09-16T10:24:00.000Z' }, sharedStatus: 'private'
    },
    {
      id: 'proj-lanterns', title: '午夜图书馆', description: '每一本被遗忘的书，都在午夜后亮起一盏灯。', visibility: 'shared',
      cover: { kind: 'image', value: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=800&q=80', name: 'library.jpg' },
      ownerId: demoUser.id, createdAt: '2026-08-22T12:10:00.000Z', updatedAt: '2026-09-12T16:40:00.000Z',
      draft: { id: 'draft-lanterns', content: '图书馆在午夜十二点准时醒来。', version: 3, updatedAt: '2026-09-12T16:40:00.000Z' }, sharedStatus: 'shared'
    }
  ]
}

async function readStore() {
  try { return JSON.parse(await fs.readFile(dataFile, 'utf8')) } catch { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(dataFile, JSON.stringify(seed, null, 2)); return structuredClone(seed) }
}
let writeQueue = Promise.resolve()
async function writeStore(store) { writeQueue = writeQueue.then(async () => { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(dataFile, JSON.stringify(store, null, 2)) }); return writeQueue }
function requireUser(req, res) { const id = req.header('x-user-id') || req.query.userId; if (!id) { res.status(401).json({ error: 'UNAUTHENTICATED', message: '请先登录 Novelverse' }); return null } return id }
function now() { return new Date().toISOString() }

app.get('/api/me', (req, res) => res.json({ user: demoUser }))
app.get('/api/projects', async (req, res) => { const userId = requireUser(req, res); if (!userId) return; const store = await readStore(); res.json({ projects: store.projects.filter(p => p.ownerId === userId) }) })
app.post('/api/projects', async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return
  const { title, description = '', visibility = 'private', cover = null } = req.body || {}
  const cleanTitle = String(title || '').trim(); if (!cleanTitle) return res.status(400).json({ error: 'TITLE_REQUIRED', message: '请填写项目标题' })
  const store = await readStore(); if (store.projects.some(p => p.ownerId === userId && p.title.toLowerCase() === cleanTitle.toLowerCase())) return res.status(409).json({ error: 'DUPLICATE_PROJECT', message: '已经有同名项目了' })
  const projectId = `proj-${crypto.randomUUID()}`; const draftId = `draft-${crypto.randomUUID()}`; const timestamp = now()
  const project = { id: projectId, title: cleanTitle, description: String(description).trim(), visibility: visibility === 'shared' ? 'shared' : 'private', cover, ownerId: userId, createdAt: timestamp, updatedAt: timestamp, draft: { id: draftId, content: '', version: 0, updatedAt: timestamp }, sharedStatus: visibility === 'shared' ? 'shared' : 'private' }
  store.projects.unshift(project); await writeStore(store); res.status(201).json({ project })
})
app.patch('/api/projects/:id', async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return; const store = await readStore(); const project = store.projects.find(p => p.id === req.params.id && p.ownerId === userId); if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' })
  const { title, description, visibility, cover } = req.body || {}; if (title !== undefined) project.title = String(title).trim(); if (description !== undefined) project.description = String(description).trim(); if (visibility !== undefined) project.visibility = visibility === 'shared' ? 'shared' : 'private'; if (cover !== undefined) project.cover = cover; project.updatedAt = now(); project.sharedStatus = project.visibility; await writeStore(store); res.json({ project })
})
app.get('/api/projects/:id/draft', async (req, res) => { const userId = requireUser(req, res); if (!userId) return; const store = await readStore(); const project = store.projects.find(p => p.id === req.params.id && p.ownerId === userId); if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '草稿不存在' }); res.json({ draft: project.draft }) })
app.put('/api/projects/:id/draft', async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return; const store = await readStore(); const project = store.projects.find(p => p.id === req.params.id && p.ownerId === userId); if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' })
  const { content = '', baseVersion = 0 } = req.body || {}; if (Number(baseVersion) !== Number(project.draft.version)) return res.status(409).json({ error: 'DRAFT_CONFLICT', message: '这份草稿在另一台设备上有更新', serverDraft: project.draft })
  const draft = { ...project.draft, content: String(content), version: Number(project.draft.version) + 1, updatedAt: now() }; project.draft = draft; project.updatedAt = draft.updatedAt; await writeStore(store); res.json({ draft })
})
app.post('/api/projects/:id/share', async (req, res) => { const userId = requireUser(req, res); if (!userId) return; const store = await readStore(); const project = store.projects.find(p => p.id === req.params.id && p.ownerId === userId); if (!project) return res.status(404).json({ error: 'NOT_FOUND', message: '项目不存在' }); project.visibility = project.visibility === 'shared' ? 'private' : 'shared'; project.sharedStatus = project.visibility; project.updatedAt = now(); await writeStore(store); res.json({ project }) })

// ---------- 逐段精读笔记 ----------
const NOTE_TYPES = new Set(['character', 'narrative', 'language', 'symbol', 'plot'])
const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_NOTE_BODY = 4000
const MAX_NOTES_PER_SYNC = 2000

// 与前端 corpus 保持一致的预置笔记（均指向公有领域选段）；偏移由引用文本精确计算
function seedAnnotations() {
  const ts = offset => new Date(Date.parse('2026-09-15T10:00:00.000Z') + offset).toISOString()
  const CONTEXT_RADIUS = 24
  const specs = [
    { id: 'note-seed-daiyu', chapterId: 'ch-hlm-3', type: 'character',
      quote: '步步留心，时时在意，不肯轻易多说一句话，多行一步路，惟恐被人耻笑了他去',
      body: '初入贾府的行为准则，一个“惟恐”写出寄人篱下的自尊与敏感；也为黛玉此后的言行定调。', offset: 0 },
    { id: 'note-seed-xifeng', chapterId: 'ch-hlm-3', type: 'narrative',
      quote: '我来迟了，不曾迎接远客！',
      body: '先声夺人：满府“敛声屏气”，唯独王熙凤人未到笑先闻，用对比一笔立住人物的张扬地位。', offset: 60000 },
    { id: 'note-seed-meiyan', chapterId: 'ch-hlm-3', type: 'language',
      quote: '闲静时如姣花照水，行动处似弱柳扶风',
      body: '对仗式的水畔意象群：姣花、弱柳都以“柔弱中的美”写黛玉，连用比喻而不堆砌，节奏舒缓。', offset: 120000 },
    { id: 'note-seed-shuaiyu', chapterId: 'ch-hlm-3', type: 'plot',
      quote: '什么罕物，连人之高低不择',
      body: '摔玉是宝黛关系的第一个高潮：以“玉不通灵”否定家族秩序，也第一次把两人命运绑在一起。', offset: 180000 },
    { id: 'note-seed-yueliang', chapterId: 'ch-gx-1', type: 'symbol',
      quote: '深蓝的天空中挂着一轮金黄的圆月',
      body: '圆月与碧绿瓜田构成“故乡”最明亮的记忆图式，与开篇萧索荒村的现实色调形成首尾对照。', offset: 240000 }
  ]
  return specs.map(spec => {
    const entry = getChapter(spec.chapterId)
    const text = getVariantText(entry, 'base')
    const start = text.indexOf(spec.quote)
    if (start === -1) throw new Error(`种子笔记引用未找到: ${spec.id}`)
    const end = start + spec.quote.length
    const ctxStart = Math.max(0, start - CONTEXT_RADIUS)
    const ctxEnd = Math.min(text.length, end + CONTEXT_RADIUS)
    return {
      id: spec.id, ownerId: 'user-demo', chapterId: spec.chapterId, variantId: 'base', type: spec.type, body: spec.body,
      anchor: {
        start, end, quote: spec.quote,
        context: text.slice(ctxStart, ctxEnd), contextOffset: start - ctxStart
      },
      createdAt: ts(spec.offset), updatedAt: ts(spec.offset), deletedAt: null
    }
  })
}

function sanitizeNote(raw, userId) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && /^note-[A-Za-z0-9-]{4,64}$/.test(raw.id) ? raw.id : `note-${crypto.randomUUID()}`
  const chapterId = String(raw.chapterId || '').slice(0, 64)
  if (!chapterId) return null
  const type = NOTE_TYPES.has(raw.type) ? raw.type : 'plot'
  const body = String(raw.body || '').slice(0, MAX_NOTE_BODY)
  const variantId = typeof raw.variantId === 'string' ? raw.variantId.slice(0, 40) || 'base' : 'base'
  const anchor = sanitizeAnchor(raw.anchor)
  if (!anchor) return null
  const createdAt = Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : now()
  const updatedAt = Number.isFinite(Date.parse(raw.updatedAt)) && Date.parse(raw.updatedAt) >= Date.parse(createdAt)
    ? raw.updatedAt : (Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : now())
  const deletedAt = raw.deletedAt && Number.isFinite(Date.parse(raw.deletedAt)) ? raw.deletedAt : null
  return { id, ownerId: userId, chapterId, variantId, type, body, anchor, createdAt, updatedAt, deletedAt }
}

function sanitizeAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return null
  const start = Number.isInteger(anchor.start) && anchor.start >= 0 ? anchor.start : 0
  const end = Number.isInteger(anchor.end) && anchor.end >= start ? anchor.end : start
  const quote = String(anchor.quote || '').slice(0, 500)
  const context = String(anchor.context || '').slice(0, 300)
  const contextOffset = Number.isInteger(anchor.contextOffset) && anchor.contextOffset >= 0 ? anchor.contextOffset : 0
  return { start, end, quote, context, contextOffset }
}

function pruneTrash(annotations) {
  const cutoff = Date.now() - TRASH_TTL_MS
  return annotations.filter(n => !n.deletedAt || Date.parse(n.deletedAt) > cutoff)
}

app.get('/api/annotations', async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return
  const store = await readStore()
  if (!store.annotations) { store.annotations = seedAnnotations(); await writeStore(store) }
  let list = store.annotations.filter(n => n.ownerId === userId)
  const before = list.length
  list = pruneTrash(list)
  if (list.length !== before) {
    const keep = new Set(list.map(n => n.id))
    store.annotations = store.annotations.filter(n => n.ownerId !== userId || keep.has(n.id))
    await writeStore(store)
  }
  res.json({ notes: list })
})

// 批量 upsert（每次操作携带完整笔记；服务端以 updatedAt 决定新旧）
// purgeIds 为用户确认“彻底删除”的笔记，服务端立即物理删除
app.post('/api/annotations/sync', async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return
  const incoming = Array.isArray(req.body?.notes) ? req.body.notes.slice(0, MAX_NOTES_PER_SYNC) : []
  const rawPurge = Array.isArray(req.body?.purgeIds) ? req.body.purgeIds.slice(0, MAX_NOTES_PER_SYNC) : []
  const purgeIds = new Set(rawPurge.filter(id => typeof id === 'string' && /^note-[A-Za-z0-9-]{4,64}$/.test(id)))
  const clean = incoming.map(n => sanitizeNote(n, userId)).filter(Boolean)
  const store = await readStore()
  if (!store.annotations) store.annotations = seedAnnotations()
  const byId = new Map(store.annotations.map(n => [n.id, n]))
  for (const note of clean) {
    const existing = byId.get(note.id)
    if (existing && existing.ownerId !== userId) continue
    if (!existing || Date.parse(note.updatedAt) >= Date.parse(existing.updatedAt)) byId.set(note.id, note)
  }
  for (const id of purgeIds) {
    const existing = byId.get(id)
    if (existing && existing.ownerId === userId) byId.delete(id)
  }
  store.annotations = pruneTrash([...byId.values()])
  await writeStore(store)
  res.json({ notes: store.annotations.filter(n => n.ownerId === userId) })
})

app.use(express.static(path.join(__dirname, 'dist')))
app.get(/.*/, (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(__dirname, 'dist', 'index.html')))
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'SERVER_ERROR', message: '服务器暂时开小差了' }) })
app.listen(PORT, () => console.log(`Novelverse API running at http://localhost:${PORT}`))
