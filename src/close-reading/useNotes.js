import { useCallback, useEffect, useRef, useState } from 'react'
import { createAnchor, relocate } from './anchor.js'

const STORAGE_KEY = 'novelverse-close-reading-v1'
const USER_ID = 'user-demo'
const SYNC_DELAY = 700

function uid() {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { notes: [], trash: [] }
    const parsed = JSON.parse(raw)
    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      trash: Array.isArray(parsed.trash) ? parsed.trash : []
    }
  } catch {
    return { notes: [], trash: [] }
  }
}

function saveLocal(notes, trash) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ notes, trash, savedAt: new Date().toISOString() }))
    return true
  } catch {
    return false // 隐私模式 / 配额耗尽时由调用方提示
  }
}

async function syncToServer(payload) {
  const response = await fetch('/api/annotations/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
    body: JSON.stringify({ notes: payload.notes || [], purgeIds: payload.purgeIds || [] })
  })
  if (!response.ok) throw new Error(`同步失败 (${response.status})`)
  return response.json()
}

async function fetchServerNotes() {
  const response = await fetch('/api/annotations', { headers: { 'x-user-id': USER_ID } })
  if (!response.ok) throw new Error(`读取云端笔记失败 (${response.status})`)
  const data = await response.json().catch(() => ({}))
  return Array.isArray(data.notes) ? data.notes : []
}

// 合并两份笔记：同一 id 取 updatedAt 较新者；回收站状态以较新记录为准
function mergeNotes(a, b) {
  const map = new Map()
  for (const note of [...a, ...b]) {
    const existing = map.get(note.id)
    if (!existing || new Date(note.updatedAt) >= new Date(existing.updatedAt)) map.set(note.id, note)
  }
  const all = [...map.values()]
  return {
    notes: all.filter(n => !n.deletedAt),
    trash: all.filter(n => n.deletedAt).sort((x, y) => new Date(y.deletedAt) - new Date(x.deletedAt))
  }
}

export function useNotes() {
  const [state, setState] = useState(() => loadLocal())
  const [saveStatus, setSaveStatus] = useState('saved') // saved | saving | failed | offline
  const [lastSavedAt, setLastSavedAt] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').savedAt || null } catch { return null }
  })
  const [hydrated, setHydrated] = useState(false)
  const [storageError, setStorageError] = useState(false)

  const stateRef = useRef(state)
  stateRef.current = state
  const dirtyRef = useRef(new Map()) // id -> note（待推送的 upsert）
  const purgeRef = useRef(new Set()) // 待硬删除 id
  const timerRef = useRef(null)

  const flush = useCallback(async () => {
    if (!dirtyRef.current.size && !purgeRef.current.size) return
    const queued = [...dirtyRef.current.values()]
    const purgeIds = [...purgeRef.current]
    dirtyRef.current = new Map()
    purgeRef.current = new Set()
    setSaveStatus(navigator.onLine === false ? 'offline' : 'saving')
    try {
      const result = await syncToServer({ notes: queued, purgeIds })
      const serverNotes = Array.isArray(result?.notes) ? result.notes : []
      setState(prev => {
        // 以本地未推送内容为先，再吸收服务端其它设备的更新
        const purgeSet = new Set(purgeIds)
        const localAll = prev.notes.concat(prev.trash).filter(n => !purgeSet.has(n.id))
        const merged = mergeNotes(localAll, serverNotes)
        saveLocal(merged.notes, merged.trash)
        return merged
      })
      setSaveStatus('saved')
      setLastSavedAt(new Date().toISOString())
    } catch {
      for (const note of queued) dirtyRef.current.set(note.id, note) // 还回队列
      for (const id of purgeIds) purgeRef.current.add(id)
      setSaveStatus(navigator.onLine === false ? 'offline' : 'failed')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, 2500)
    }
  }, [])

  const scheduleFlush = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, SYNC_DELAY)
  }, [flush])

  const mutate = useCallback((note) => {
    dirtyRef.current.set(note.id, note)
    setState(prev => {
      const others = [
        ...prev.notes.filter(n => n.id !== note.id),
        ...prev.trash.filter(n => n.id !== note.id)
      ]
      const nextNotes = note.deletedAt ? others : [...others, note]
      const nextTrash = note.deletedAt ? [...others, note] : others
      const ok = saveLocal(nextNotes, nextTrash)
      setStorageError(!ok)
      if (ok) setLastSavedAt(new Date().toISOString())
      return { notes: nextNotes, trash: nextTrash }
    })
    scheduleFlush()
  }, [scheduleFlush])

  // 初次 hydration：与服务端合并
  useEffect(() => {
    let cancelled = false
    fetchServerNotes().then(serverNotes => {
      if (cancelled) return
      setState(prev => {
        const localAll = [...prev.notes, ...prev.trash]
        const serverMap = new Map(serverNotes.map(n => [n.id, n]))
        for (const local of localAll) {
          const remote = serverMap.get(local.id)
          if (!remote || new Date(local.updatedAt) > new Date(remote.updatedAt)) {
            dirtyRef.current.set(local.id, local)
          }
        }
        // 服务端可能已经硬删除了某些笔记；hydration 时同步这一事实
        const remoteIds = new Set(serverNotes.map(n => n.id))
        const keptLocal = localAll.filter(n => remoteIds.has(n.id) || dirtyRef.current.has(n.id))
        const merged = mergeNotes(keptLocal, serverNotes)
        saveLocal(merged.notes, merged.trash)
        return merged
      })
      setHydrated(true)
      if (dirtyRef.current.size) scheduleFlush()
      else { setSaveStatus('saved'); setLastSavedAt(new Date().toISOString()) }
    }).catch(() => {
      if (cancelled) return
      setHydrated(true)
      setSaveStatus(navigator.onLine === false ? 'offline' : 'failed')
    })
    return () => { cancelled = true }
  }, [scheduleFlush])

  // 在线 / 离线切换自动重试
  useEffect(() => {
    const onOnline = () => { if (dirtyRef.current.size || purgeRef.current.size) flush(); else setSaveStatus('saved') }
    const onOffline = () => setSaveStatus('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [flush])

  // 页面关闭前尽力推送
  useEffect(() => () => {
    clearTimeout(timerRef.current)
    if ((dirtyRef.current.size || purgeRef.current.size) && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify({
        notes: [...dirtyRef.current.values()],
        purgeIds: [...purgeRef.current]
      })], { type: 'application/json' })
      navigator.sendBeacon(`/api/annotations/sync?userId=${encodeURIComponent(USER_ID)}`, blob)
    }
  }, [])

  const addNote = useCallback(({ chapterId, variantId, text, start, end, type, body }) => {
    const now = new Date().toISOString()
    const note = {
      id: uid(), chapterId, variantId: variantId || 'base', type,
      body: body.trim(), anchor: createAnchor(text, start, end),
      createdAt: now, updatedAt: now, deletedAt: null
    }
    mutate(note)
    return note
  }, [mutate])

  const updateNote = useCallback((id, patch) => {
    const existing = stateRef.current.notes.find(n => n.id === id)
      || stateRef.current.trash.find(n => n.id === id)
    if (!existing) return null
    const note = { ...existing, ...patch, updatedAt: new Date().toISOString() }
    mutate(note)
    return note
  }, [mutate])

  const deleteNote = useCallback(id => updateNote(id, { deletedAt: new Date().toISOString() }), [updateNote])
  const restoreNote = useCallback(id => updateNote(id, { deletedAt: null }), [updateNote])
  const removeForever = useCallback(id => {
    setState(prev => {
      const nextNotes = prev.notes.filter(n => n.id !== id)
      const nextTrash = prev.trash.filter(n => n.id !== id)
      const ok = saveLocal(nextNotes, nextTrash)
      setStorageError(!ok)
      return { notes: nextNotes, trash: nextTrash }
    })
    dirtyRef.current.delete(id)
    purgeRef.current.add(id)
    scheduleFlush()
  }, [scheduleFlush])

  const retrySave = useCallback(() => {
    setSaveStatus(navigator.onLine === false ? 'offline' : 'saving')
    flush()
  }, [flush])

  return {
    ...state, hydrated, saveStatus, lastSavedAt, storageError,
    addNote, updateNote, deleteNote, restoreNote, removeForever, retrySave
  }
}

// 把章节笔记解析到当前文本坐标；版本变化时模糊重定位，结果按引用位置排序。
// getVariantText(variantId) 返回笔记创建版本的文本，作为锚点的“旧文本”。
export function resolveChapterNotes(notes, chapterId, activeVariant, activeText, getVariantText) {
  return notes
    .filter(n => n.chapterId === chapterId)
    .map(note => {
      const sourceVariant = note.variantId || 'base'
      const oldText = sourceVariant === activeVariant
        ? activeText
        : (getVariantText(sourceVariant) ?? activeText)
      const inBounds = note.anchor.start >= 0 && note.anchor.end <= oldText.length
        && oldText.slice(note.anchor.start, note.anchor.end) === note.anchor.quote
      // 同版本且引用仍在原位置 → 直接用坐标；否则交给锚点引擎模糊重定位
      const result = sourceVariant === activeVariant && inBounds
        ? { status: 'exact', start: note.anchor.start, end: note.anchor.end, deleted: false }
        : relocate(note.anchor, oldText, activeText)
      const quoteNow = result.status === 'lost'
        ? note.anchor.quote
        : (result.deleted ? '' : activeText.slice(result.start, result.end))
      return { note, ...result, quoteNow, sourceVariant }
    })
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
}
