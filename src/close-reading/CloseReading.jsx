import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Trash2, Keyboard, X, BookOpenText, Cloud, CloudOff,
  Loader2, AlertTriangle, ChevronRight, ListFilter, Link2
} from 'lucide-react'
import { BOOKS, getChapter, getVariantText, getVariantInfo } from './corpus'
import { buildTextModel, createAnchor } from './anchor'
import { useNotes, resolveChapterNotes } from './useNotes'
import { NOTE_TYPES, TYPE_MAP } from './constants'
import ReaderText, { readSelection, selectionSupported, findNoteElement } from './ReaderText'
import Popover from './Popover'
import NoteEditor from './NoteEditor'
import { NoteRail, NoteCard, TrashDrawer } from './NoteRail'

// 本章文本模型缓存
const MODEL_CACHE = new Map()
function getTextModel(chapterId, variantId) {
  const key = `${chapterId}::${variantId}`
  if (!MODEL_CACHE.has(key)) {
    const entry = getChapter(chapterId)
    const text = getVariantText(entry, variantId)
    const model = buildTextModel({ paragraphs: text.split('\n') })
    MODEL_CACHE.set(key, model)
    if (MODEL_CACHE.size > 8) MODEL_CACHE.delete(MODEL_CACHE.keys().next().value)
  }
  return MODEL_CACHE.get(key)
}

export default function CloseReading() {
  const { notes, trash, hydrated, saveStatus, lastSavedAt, storageError,
    addNote, updateNote, deleteNote, restoreNote, removeForever, retrySave } = useNotes()

  const [chapterId, setChapterId] = useState(BOOKS[0].chapters[0].id)
  const [variantId, setVariantId] = useState('base')
  const [typeFilter, setTypeFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [scopeChapter, setScopeChapter] = useState('current')
  const [showTrash, setShowTrash] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [notice, setNotice] = useState(null)
  const [activeNoteId, setActiveNoteId] = useState(null)

  const canSelect = useMemo(() => selectionSupported(), [])
  const [selection, setSelection] = useState(null) // { start, end, range? }
  const [showToolbar, setShowToolbar] = useState(false)
  const selectionTimer = useRef(null)
  const crossTimer = useRef(null)
  const articleRef = useRef(null)

  // popover: { kind: 'create'|'view'|'multi'|'edit', noteIds? }
  const [popover, setPopover] = useState(null)
  const [reanchoring, setReanchoring] = useState(null)
  const popoverRef = useRef(null)
  useEffect(() => { popoverRef.current = popover }, [popover])

  const model = getTextModel(chapterId, variantId)
  const entry = getChapter(chapterId)
  const variantInfo = getVariantInfo(entry.chapter, variantId)

  const variantTextFor = useCallback(vid => getVariantText(getChapter(chapterId), vid), [chapterId])

  const resolved = useMemo(() => resolveChapterNotes(
    notes, chapterId, variantId, model.text, variantTextFor
  ), [notes, chapterId, variantId, model.text, variantTextFor])

  const lostCount = useMemo(() => resolved.filter(r => r.status === 'lost').length, [resolved])

  const stats = useMemo(() => ({
    total: notes.length,
    chapters: new Set(notes.map(n => n.chapterId)).size
  }), [notes])

  // 全书搜索
  const searchResults = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw || scopeChapter !== 'all') return []
    return notes
      .filter(n => (typeFilter === 'all' || n.type === typeFilter)
        && (n.body.toLowerCase().includes(kw) || (n.anchor?.quote || '').toLowerCase().includes(kw)))
      .map(note => {
        const chEntry = getChapter(note.chapterId)
        return { note, chapterTitle: chEntry ? `${chEntry.book.title} · ${chEntry.chapter.title}` : '未知章节' }
      })
  }, [notes, keyword, scopeChapter, typeFilter])

  const filteredResolved = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return resolved.filter(r => {
      if (scopeChapter !== 'current') return true
      if (typeFilter !== 'all' && r.note.type !== typeFilter) return false
      if (kw) return r.note.body.toLowerCase().includes(kw) || (r.quoteNow || '').toLowerCase().includes(kw)
      return true
    })
  }, [resolved, typeFilter, keyword, scopeChapter])

  // 有筛选条件时，未命中的原文标记变淡（命中集合）
  const highlightedIds = useMemo(() => {
    const hasFilter = (scopeChapter === 'current') && (typeFilter !== 'all' || keyword.trim())
    if (!hasFilter) return null
    return new Set(filteredResolved.map(r => r.note.id))
  }, [scopeChapter, typeFilter, keyword, filteredResolved])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  // ---- 选区 ----
  const refreshSelection = useCallback(() => {
    if (!canSelect || !articleRef.current) return
    const sel = readSelection(articleRef.current)
    if (!sel) { setSelection(null); setShowToolbar(false); return }
    if (sel.crossParagraph) {
      setSelection({ crossParagraph: true })
      setShowToolbar(false)
      clearTimeout(crossTimer.current)
      crossTimer.current = setTimeout(() => setSelection(cur => cur?.crossParagraph ? null : cur), 2600)
      return
    }
    const globalStart = model.offsets[sel.paragraphIndex].start + sel.localStart
    const globalEnd = model.offsets[sel.paragraphIndex].start + sel.localEnd
    setSelection({ start: globalStart, end: globalEnd, range: sel.range })
    setShowToolbar(!popover && !reanchoring)
  }, [canSelect, model, popover, reanchoring])

  useEffect(() => {
    if (!canSelect) return
    const onSelectionChange = () => {
      // 弹层打开后（如输入框聚焦会移动选区），冻结已捕获的选区
      if (popoverRef.current) return
      clearTimeout(selectionTimer.current)
      selectionTimer.current = setTimeout(refreshSelection, 120)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => { document.removeEventListener('selectionchange', onSelectionChange); clearTimeout(selectionTimer.current); clearTimeout(crossTimer.current) }
  }, [canSelect, refreshSelection])

  // 弹层 / 工具条打开时，点击外部关闭
  useEffect(() => {
    const onMouseDown = event => {
      if (event.target.closest?.('.cr-popover')) return
      setPopover(prev => {
        if (prev && !event.target.closest?.('.cr-toolbar-pop')) setReanchoring(null)
        return null
      })
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // ---- 定位 ----
  const scrollToNote = useCallback((noteId, open = false) => {
    const el = findNoteElement(noteId)
    if (!el) { setNotice({ tone: 'warn', text: '该笔记在当前版本中没有可跳转的原文位置。' }); return false }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setActiveNoteId(noteId)
    setTimeout(() => setActiveNoteId(cur => cur === noteId ? null : cur), 2400)
    if (open) {
      const ids = (el.getAttribute('data-note-ids') || '').split(',').filter(Boolean)
      setPopover({ kind: ids.length > 1 ? 'multi' : 'view', noteIds: ids.length ? ids : [noteId] })
    }
    return true
  }, [])

  const handleOpenMarks = useCallback(noteIds => {
    const ids = noteIds.filter(id => notes.some(n => n.id === id))
    if (ids.length) setPopover({ kind: ids.length > 1 ? 'multi' : 'view', noteIds: ids })
  }, [notes])

  const annotateParagraph = useCallback(index => {
    const { start, end } = model.offsets[index]
    setSelection({ start, end, range: null })
    setPopover({ kind: 'create' })
  }, [model])

  const startCreate = useCallback(() => {
    if (!selection || selection.crossParagraph) return
    setShowToolbar(false)
    setPopover({ kind: 'create' })
  }, [selection])

  // 重锚流程：选中新句子后回到原笔记的编辑弹层
  const confirmReanchor = useCallback(() => {
    if (!reanchoring || !selection || selection.crossParagraph) return
    setShowToolbar(false)
    setPopover({ kind: 'edit', noteIds: [reanchoring.id] })
  }, [reanchoring, selection])

  const clearSelectionUI = () => {
    window.getSelection()?.removeAllRanges()
    setSelection(null); setShowToolbar(false)
  }

  // ---- 增改删 ----
  const handleCreate = ({ type, body }) => {
    const note = addNote({
      chapterId, variantId, text: model.text,
      start: selection.start, end: selection.end, type, body
    })
    setPopover(null)
    setActiveNoteId(note.id)
    setTimeout(() => setActiveNoteId(cur => cur === note.id ? null : cur), 2400)
    setNotice({ tone: 'ok', text: '笔记已保存，并标记在原文对应位置。' })
    clearSelectionUI()
  }

  const handleEditNote = note => setPopover({ kind: 'edit', noteIds: [note.id] })

  const handleUpdate = ({ type, body }) => {
    const id = popover.noteIds[0]
    const patch = { type, body }
    if (reanchoring && selection && !selection.crossParagraph) {
      patch.anchor = createAnchor(model.text, selection.start, selection.end)
      patch.variantId = variantId
    }
    updateNote(id, patch)
    setPopover(null)
    setNotice({ tone: 'ok', text: reanchoring ? '笔记已重新锚定到新位置。' : '修改已保存。' })
    setReanchoring(null)
    clearSelectionUI()
  }

  const handleDelete = id => {
    deleteNote(id)
    setPopover(null)
    setNotice({
      tone: 'warn', text: '笔记已移入回收站。',
      undo: () => { restoreNote(id); setNotice({ tone: 'ok', text: '笔记已恢复。' }) }
    })
  }

  const startReanchor = note => {
    setReanchoring(note)
    setPopover(null)
    setNotice({ tone: 'info', text: '请在原文中选中新的句子，工具条中选择「确认新位置」。' })
  }

  // ---- 快捷键 ----
  useEffect(() => {
    const onKey = event => {
      const typing = event.target.matches?.('textarea, input, select, [contenteditable="true"]')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); document.getElementById('cr-keyword')?.focus(); return
      }
      if (typing) return
      if (event.key === '/') { event.preventDefault(); document.getElementById('cr-keyword')?.focus(); return }
      if (event.key === 'j' || event.key === 'J') {
        event.preventDefault()
        const list = filteredResolved.filter(r => r.status !== 'lost')
        const idx = list.findIndex(r => r.note.id === activeNoteId)
        const next = list[idx + 1] ?? (idx === -1 ? list[0] : null)
        if (next) scrollToNote(next.note.id)
        return
      }
      if (event.key === 'k' || event.key === 'K') {
        event.preventDefault()
        const list = filteredResolved.filter(r => r.status !== 'lost')
        const idx = list.findIndex(r => r.note.id === activeNoteId)
        const prev = list[idx - 1] ?? (idx === -1 ? list[0] : null)
        if (prev) scrollToNote(prev.note.id)
        return
      }
      if ((event.key === 'n' || event.key === 'N') && selection && !selection.crossParagraph && !popover) {
        event.preventDefault()
        if (reanchoring) confirmReanchor()
        else startCreate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filteredResolved, activeNoteId, selection, popover, scrollToNote, startCreate, confirmReanchor, reanchoring])

  const changeChapter = id => {
    setChapterId(id); setVariantId('base'); setPopover(null); setReanchoring(null)
    setSelection(null); setShowToolbar(false)
    document.querySelector('.cr-layout')?.scrollIntoView?.()
    window.scrollTo({ top: 0 })
  }
  const changeVariant = vid => { setVariantId(vid); setPopover(null); setReanchoring(null) }

  const jumpToChapterNote = item => {
    setScopeChapter('current'); setKeyword(''); setTypeFilter('all')
    if (item.note.chapterId !== chapterId) {
      setVariantId('base'); setChapterId(item.note.chapterId)
      setTimeout(() => scrollToNote(item.note.id, true), 300)
    } else {
      scrollToNote(item.note.id, true)
    }
  }

  const viewNote = popover?.kind === 'view' ? resolved.find(r => r.note.id === popover.noteIds[0]) : null
  const multiNotes = popover?.kind === 'multi'
    ? popover.noteIds.map(id => resolved.find(r => r.note.id === id)).filter(Boolean) : []
  const editNote = popover?.kind === 'edit'
    ? (notes.find(n => n.id === popover.noteIds[0]) || trash.find(n => n.id === popover.noteIds[0])) : null
  const editResolved = editNote ? resolved.find(r => r.note.id === editNote.id) : null

  const selectionQuote = selection && !selection.crossParagraph ? model.text.slice(selection.start, selection.end) : ''

  return (
    <div className="cr-page">
      <header className="cr-header">
        <div className="cr-header-row">
          <div className="cr-title-block">
            <span className="eyebrow">CLOSE READING / 逐段精读</span>
            <h1><BookOpenText size={25} /> 逐段精读笔记</h1>
            <p>选中原文中的句子，按类型写下批注；原文换版本时，笔记会自动重新对齐。</p>
          </div>
          <div className="cr-header-tools">
            <SavePill status={saveStatus} time={lastSavedAt} hydrated={hydrated} onRetry={retrySave} />
            <button type="button" className="icon-btn" aria-label="键盘快捷键说明" onClick={() => setShowHelp(true)}><Keyboard size={18} /></button>
            <button type="button" className="secondary-btn" onClick={() => setShowTrash(true)}>
              <Trash2 size={15} />回收站{trash.length ? `（${trash.length}）` : ''}
            </button>
          </div>
        </div>

        <div className="cr-controls">
          <label className="cr-chapter-select">
            <span className="cr-control-label">选段</span>
            <select value={chapterId} onChange={e => changeChapter(e.target.value)} aria-label="选择章节">
              {BOOKS.map(book => (
                <optgroup key={book.id} label={`${book.title} · ${book.author}`}>
                  {book.chapters.map(ch => <option key={ch.id} value={ch.id}>{ch.title}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {entry.chapter.variants?.length > 0 && (
            <label className="cr-chapter-select">
              <span className="cr-control-label">版本</span>
              <select value={variantId} onChange={e => changeVariant(e.target.value)} aria-label="原文版本">
                <option value="base">通行本</option>
                {entry.chapter.variants.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
          )}
          <div className="cr-type-filters" role="group" aria-label="按类型筛选">
            <button type="button" className={typeFilter === 'all' ? 'is-active' : ''} onClick={() => setTypeFilter('all')}>全部</button>
            {NOTE_TYPES.map(t => (
              <button key={t.id} type="button" className={typeFilter === t.id ? 'is-active' : ''}
                style={{ '--mc': t.color }} aria-pressed={typeFilter === t.id}
                onClick={() => setTypeFilter(typeFilter === t.id ? 'all' : t.id)}>
                <i style={{ background: t.color }} />{t.label}
              </button>
            ))}
          </div>
          <div className="cr-search">
            <Search size={15} />
            <input id="cr-keyword" value={keyword} onChange={e => setKeyword(e.target.value)}
              placeholder="搜索笔记内容或原文摘录…" aria-label="关键词搜索" />
            {keyword && <button type="button" className="icon-btn" aria-label="清除关键词" onClick={() => setKeyword('')}><X size={14} /></button>}
          </div>
          <div className="cr-scope" role="group" aria-label="搜索范围">
            <button type="button" className={scopeChapter === 'current' ? 'is-active' : ''} onClick={() => setScopeChapter('current')}>本章</button>
            <button type="button" className={scopeChapter === 'all' ? 'is-active' : ''} onClick={() => setScopeChapter('all')}>全书</button>
          </div>
        </div>
        {variantId !== 'base' && variantInfo.note && (
          <div className="cr-variant-note"><AlertTriangle size={14} />{variantInfo.note}</div>
        )}
        {lostCount > 0 && (
          <div className="cr-variant-note cr-lost-note"><AlertTriangle size={14} />当前版本有 {lostCount} 条笔记无法定位，可在右侧列表中重新指定原文位置。</div>
        )}
      </header>

      {!canSelect && (
        <div className="cr-compat-banner" role="alert">
          <AlertTriangle size={15} />
          当前浏览器不支持文本选区，无法划词。可用 <kbd>Tab</kbd> 聚焦每段末尾的 <b>＋</b>，回车后对整段添加笔记。
        </div>
      )}
      {storageError && (
        <div className="cr-compat-banner cr-storage-error" role="alert">
          <AlertTriangle size={15} />本地存储不可用（隐私模式或配额已满），笔记无法保留在本机。
        </div>
      )}

      <div className="cr-layout">
        <div className="cr-reader-wrap">
          <div className="cr-chapter-meta">
            <h2>{entry.chapter.title}</h2>
            <span>{entry.book.author} · {model.text.length} 字 · {model.offsets.length} 段 · {resolved.length} 条笔记</span>
          </div>
          <ReaderText
            text={model.text}
            offsets={model.offsets}
            resolved={resolved}
            activeNoteId={activeNoteId}
            highlightIds={highlightedIds}
            onOpen={handleOpenMarks}
            onAnnotateParagraph={annotateParagraph}
            canSelect={canSelect}
            articleRef={articleRef}
            activeVariant={variantId}
          />
        </div>

        {scopeChapter === 'all' && keyword.trim() ? (
          <aside className="cr-rail" aria-label="笔记列表">
            <div className="cr-rail-stats"><strong>·</strong><span>全书搜索结果显示在右侧浮层</span></div>
            <div className="cr-rail-empty">
              <p>正在全书 {stats.chapters} 个章节中搜索「{keyword.trim()}」，匹配 {searchResults.length} 条。</p>
              <button type="button" className="secondary-btn" onClick={() => setScopeChapter('current')}>返回本章笔记</button>
            </div>
          </aside>
        ) : (
          <NoteRail
            resolved={filteredResolved.map(r => ({
              ...r,
              sourceVariantLabel: r.sourceVariant !== variantId ? getVariantInfo(entry.chapter, r.sourceVariant).label : ''
            }))}
            filters={{ type: typeFilter, keyword }}
            totalCount={notes.length}
            onLocate={r => scrollToNote(r.note.id, true)}
            onEdit={handleEditNote}
            activeNoteId={activeNoteId}
          />
        )}
      </div>

      {/* 全书搜索结果 */}
      {keyword.trim() && scopeChapter === 'all' && (
        <section className="cr-search-panel" aria-label="全书搜索结果">
          <div className="cr-search-panel-head">
            <strong><ListFilter size={15} />全书匹配 {searchResults.length} 条</strong>
            <button type="button" className="text-btn" onClick={() => { setScopeChapter('current'); setKeyword('') }}>清除</button>
          </div>
          {searchResults.length === 0
            ? <p className="cr-rail-empty" style={{ padding: 18 }}>全书没有匹配的笔记。</p>
            : <ol className="cr-card-list">
                {searchResults.map(item => (
                  <NoteCard key={item.note.id}
                    resolved={{
                      note: item.note, status: 'exact',
                      quoteNow: item.note.anchor?.quote,
                      sourceVariant: item.note.variantId || 'base'
                    }}
                    chapterLine={item.chapterTitle}
                    onLocate={() => jumpToChapterNote(item)}
                    onEdit={handleEditNote} />
                ))}
              </ol>}
        </section>
      )}

      {/* 划词工具条 */}
      {showToolbar && selection && !selection.crossParagraph && !popover && (
        <Popover
          getAnchorRect={() => {
            if (selection.range) {
              const rects = selection.range.getClientRects()
              return rects[rects.length - 1] || selection.range.getBoundingClientRect()
            }
            return null
          }}
          onClose={() => setShowToolbar(false)}
          maxWidth={320}
        >
          <div className="cr-toolbar-pop">
            <button type="button" className="cr-toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={reanchoring ? confirmReanchor : startCreate}>
              {reanchoring ? <><Link2 size={14} />确认新位置</> : <><span className="cr-toolbar-plus">＋</span>写笔记 <kbd>N</kbd></>}
            </button>
            <span className="cr-toolbar-quote" title={selectionQuote}>
              「{selectionQuote.slice(0, 24)}{selectionQuote.length > 24 ? '…' : ''}」
            </span>
          </div>
        </Popover>
      )}

      {selection?.crossParagraph && (
        <div className="cr-hint-bubble" role="status">一次只能为同一段落内的句子添加笔记，请缩小选择范围。</div>
      )}

      {reanchoring && !popover && (
        <div className="cr-reanchor-bar" role="status">
          <Link2 size={14} />正在重新指定原文位置：选中句子后点击「确认新位置」，
          <button type="button" className="text-btn" onClick={() => setReanchoring(null)}>取消</button>
        </div>
      )}

      {/* 创建 */}
      {popover?.kind === 'create' && selection && (
        <Popover
          getAnchorRect={() => {
            if (selection.range) {
              const rects = selection.range.getClientRects()
              return rects[rects.length - 1] || selection.range.getBoundingClientRect()
            }
            return { top: 140, left: window.innerWidth / 2, width: 0, height: 0, bottom: 140, right: window.innerWidth / 2 }
          }}
          onClose={clearSelectionUI}
          maxWidth={400}
        >
          <NoteEditor mode="create" quote={selectionQuote}
            onClose={clearSelectionUI} onSubmit={handleCreate} />
        </Popover>
      )}

      {/* 查看 */}
      {popover?.kind === 'view' && viewNote && (
        <Popover
          getAnchorRect={() => findNoteElement(viewNote.note.id)?.getBoundingClientRect() || null}
          onClose={() => setPopover(null)} maxWidth={400}>
          <ViewNotePop resolved={viewNote}
            variantLabel={viewNote.sourceVariant !== variantId ? getVariantInfo(entry.chapter, viewNote.sourceVariant).label : ''}
            onEdit={() => handleEditNote(viewNote.note)}
            onDelete={handleDelete} onReanchor={() => startReanchor(viewNote.note)} />
        </Popover>
      )}

      {/* 重叠位置：多条笔记 */}
      {popover?.kind === 'multi' && (
        <Popover
          getAnchorRect={() => findNoteElement(popover.noteIds[0])?.getBoundingClientRect() || null}
          onClose={() => setPopover(null)} maxWidth={420}>
          <div className="cr-multi-pop">
            <div className="cr-multi-head"><strong>同一位置有 {multiNotes.length} 条笔记</strong></div>
            <ol className="cr-card-list">
              {multiNotes.map(r => (
                <NoteCard key={r.note.id} resolved={r}
                  onLocate={() => setPopover({ kind: 'view', noteIds: [r.note.id] })}
                  onEdit={handleEditNote} />
              ))}
            </ol>
          </div>
        </Popover>
      )}

      {/* 编辑 */}
      {popover?.kind === 'edit' && editNote && (
        <Popover
          getAnchorRect={() => findNoteElement(editNote.id)?.getBoundingClientRect()
            || document.getElementById(`cr-rail-${editNote.id}`)?.getBoundingClientRect() || null}
          onClose={() => { setPopover(null); setReanchoring(null) }} maxWidth={400}>
          <NoteEditor
            mode="edit"
            initial={editNote}
            quote={reanchoring && selection && !selection.crossParagraph
              ? model.text.slice(selection.start, selection.end)
              : (editResolved?.quoteNow || editNote.anchor?.quote)}
            relocateStatus={editResolved
              ? (editResolved.status === 'fuzzy' && editResolved.deleted ? 'deleted'
                : editResolved.status === 'exact' ? null : editResolved.status)
              : null}
            sourceVariantLabel={editResolved && editResolved.sourceVariant !== variantId
              ? getVariantInfo(entry.chapter, editResolved.sourceVariant).label : ''}
            onClose={() => { setPopover(null); setReanchoring(null) }}
            onSubmit={handleUpdate}
            onDelete={handleDelete}
            onStartReanchor={() => startReanchor(editNote)}
          />
        </Popover>
      )}

      {notice && <NoticeBar notice={notice} onClose={() => setNotice(null)} />}
      {showTrash && <TrashDrawer trash={trash} onClose={() => setShowTrash(false)}
        onRestore={id => { restoreNote(id); setNotice({ tone: 'ok', text: '笔记已恢复到原文位置。' }) }}
        onRemove={id => { removeForever(id); setNotice({ tone: 'warn', text: '已彻底删除，不可恢复。' }) }} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

function ViewNotePop({ resolved, variantLabel, onEdit, onDelete, onReanchor }) {
  const { note, status, quoteNow, deleted } = resolved
  const meta = TYPE_MAP[note.type]
  const lost = status === 'lost'
  const badge = lost ? { cls: 'bad', text: '无法定位' }
    : status === 'fuzzy' && deleted ? { cls: 'warn', text: '原文此处已删除' }
    : status === 'fuzzy' ? { cls: 'warn', text: '上下文推测位置' }
    : status === 'shifted' ? { cls: 'warn', text: '已随文本移动' }
    : null
  return (
    <div className="cr-view-pop">
      <div className="cr-card-head">
        <span className="cr-type-chip" style={{ '--mc': meta.color }}><i style={{ background: meta.color }} />{meta.label}</span>
        {badge && <span className={`cr-badge cr-badge-${badge.cls}`}>{badge.text}</span>}
      </div>
      <blockquote className="cr-editor-quote" style={{ '--mc': meta.color }}>
        <span className="cr-card-quote-bar" /><span>{(lost || deleted) ? note.anchor?.quote : quoteNow}</span>
      </blockquote>
      {variantLabel && <div className="cr-variant-line">写于：{variantLabel}</div>}
      <p className="cr-card-body">{note.body}</p>
      <div className="cr-editor-actions">
        {(lost || status === 'fuzzy') && (
          <button type="button" className="cr-card-btn" onClick={onReanchor}><Link2 size={13} />重新指定原文</button>
        )}
        <button type="button" className="cr-card-btn cr-danger" onClick={() => onDelete(note.id)}><Trash2 size={13} />删除</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="primary-btn" onClick={onEdit}>修改</button>
      </div>
    </div>
  )
}

function SavePill({ status, time, hydrated, onRetry }) {
  const timeLabel = time
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(time))
    : ''
  const map = {
    saved: { icon: <Cloud size={14} />, text: `已保存${timeLabel ? ` · ${timeLabel}` : ''}`, cls: 'ok' },
    saving: { icon: <Loader2 size={14} className="cr-spin" />, text: '保存中…', cls: 'busy' },
    failed: { icon: <CloudOff size={14} />, text: '保存失败，点击重试', cls: 'bad', action: onRetry },
    offline: { icon: <CloudOff size={14} />, text: '离线 · 已暂存本机', cls: 'warn' }
  }
  if (!hydrated) return <div className="cr-save-pill cr-save-busy"><Loader2 size={14} className="cr-spin" />正在载入笔记…</div>
  const item = map[status] || map.saved
  return (
    <button type="button" className={`cr-save-pill cr-save-${item.cls}`} onClick={item.action}
      disabled={!item.action} title={item.action ? '点击立即重试' : '保存状态'}>
      {item.icon}<span>{item.text}</span>
    </button>
  )
}

function NoticeBar({ notice, onClose }) {
  return (
    <div className={`cr-notice cr-notice-${notice.tone}`} role="status">
      <span>{notice.text}</span>
      {notice.undo && <button type="button" className="cr-undo-btn" onClick={() => { notice.undo(); onClose() }}>撤销</button>}
      <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={14} /></button>
    </div>
  )
}

function HelpModal({ onClose }) {
  return (
    <div className="cr-drawer-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="cr-help-modal" role="dialog" aria-modal="true" aria-label="键盘快捷键">
        <div className="cr-drawer-head">
          <div><span className="eyebrow">SHORTCUTS</span><h2>键盘操作</h2></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <ul className="cr-help-list">
          <li><span className="cr-help-keys"><kbd>Shift</kbd> + 方向键 / 鼠标拖动</span><dd>在原文中选中句子</dd></li>
          <li><span className="cr-help-keys"><kbd>N</kbd></span><dd>对当前选区写笔记</dd></li>
          <li><span className="cr-help-keys"><kbd>J</kbd> / <kbd>K</kbd></span><dd>在筛选结果的笔记间后 / 前跳转</dd></li>
          <li><span className="cr-help-keys"><kbd>/</kbd> 或 <kbd>⌃/⌘ K</kbd></span><dd>聚焦关键词搜索</dd></li>
          <li><span className="cr-help-keys"><kbd>Tab</kbd></span><dd>段落末尾 ＋ 可聚焦，回车对整段记笔记</dd></li>
          <li><span className="cr-help-keys"><kbd>Esc</kbd></span><dd>关闭弹层</dd></li>
        </ul>
      </div>
    </div>
  )
}
