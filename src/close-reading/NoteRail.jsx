import { RotateCcw, Trash2, Pencil, ArrowDownToLine, FileWarning, Link2 } from 'lucide-react'
import { TYPE_MAP, RELOCATE_STATUS, formatTime, statusOf } from './constants'

function StatusBadge({ resolved }) {
  const status = statusOf(resolved)
  if (!status || status === 'exact') return null
  const meta = RELOCATE_STATUS[status]
  return <span className={`cr-badge cr-badge-${meta.tone}`} title={meta.label}>{meta.label}</span>
}

export function NoteQuote({ quote, type, muted = false }) {
  const meta = TYPE_MAP[type] || TYPE_MAP.plot
  return (
    <blockquote className={`cr-card-quote ${muted ? 'cr-quote-muted' : ''}`} style={{ '--mc': meta.color }}>
      <span className="cr-card-quote-bar" aria-hidden />
      <span>{quote || '（无摘录）'}</span>
    </blockquote>
  )
}

export function NoteCard({ resolved, active, chapterLine, onLocate, onEdit }) {
  const { note, status, quoteNow, sourceVariantLabel } = resolved
  const meta = TYPE_MAP[note.type] || TYPE_MAP.plot
  const lost = status === 'lost'
  const deleted = status === 'fuzzy' && resolved.deleted
  return (
    <li id={`cr-rail-${note.id}`} className={`cr-card ${active ? 'is-active' : ''} ${lost ? 'is-lost' : ''}`}>
      {chapterLine && <div className="cr-search-chapter">{chapterLine}</div>}
      <div className="cr-card-head">
        <span className="cr-type-chip" style={{ '--mc': meta.color }}>
          <i style={{ background: meta.color }} />{meta.label}
        </span>
        <StatusBadge resolved={resolved} />
        <span className="cr-card-time">{formatTime(note.updatedAt)}</span>
      </div>
      {lost ? (
        <div className="cr-lost-body">
          <FileWarning size={14} />
          <p>原文改动后，未能在当前版本找到这段文字。</p>
          <NoteQuote quote={note.anchor?.quote} type={note.type} muted />
        </div>
      ) : deleted ? (
        <div className="cr-lost-body">
          <FileWarning size={14} />
          <p>这段原文在新版本中已被删除，笔记标记在删除位置。</p>
          <NoteQuote quote={note.anchor?.quote} type={note.type} muted />
        </div>
      ) : (
        <NoteQuote quote={quoteNow} type={note.type} />
      )}
      {sourceVariantLabel && <div className="cr-variant-line">写于：{sourceVariantLabel}</div>}
      <p className="cr-card-body">{note.body || <em>（未填写内容）</em>}</p>
      <div className="cr-card-actions">
        {lost || deleted
          ? <button type="button" className="cr-card-btn" onClick={() => onEdit(note)}><Link2 size={13} />重新指定原文</button>
          : <button type="button" className="cr-card-btn" onClick={() => onLocate(resolved)}><ArrowDownToLine size={13} />跳回原文</button>}
        <button type="button" className="cr-card-btn" onClick={() => onEdit(note)}><Pencil size={13} />编辑</button>
      </div>
    </li>
  )
}

export function NoteRail({ resolved, filters, totalCount, onLocate, onEdit, activeNoteId }) {
  const visible = resolved.filter(r => {
    if (filters.type !== 'all' && r.note.type !== filters.type) return false
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase()
      const hay = `${r.note.body} ${r.quoteNow || ''} ${r.note.anchor?.quote || ''}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
  return (
    <aside className="cr-rail" aria-label="笔记列表">
      <div className="cr-rail-stats">
        <strong>{visible.length}</strong>
        <span>条结果{filters.type !== 'all' || filters.keyword ? ` · 本章 ${resolved.length} 条` : ''} · 全书 {totalCount} 条</span>
      </div>
      {visible.length === 0 ? (
        <div className="cr-rail-empty">
          <p>{totalCount === 0 ? '在正文中选中一句话，即可写下第一条笔记。' : '没有符合条件的笔记。'}</p>
        </div>
      ) : (
        <ol className="cr-card-list">
          {visible.map(r => (
            <NoteCard key={r.note.id} resolved={r} active={r.note.id === activeNoteId}
              onLocate={onLocate} onEdit={onEdit} />
          ))}
        </ol>
      )}
    </aside>
  )
}

export function TrashDrawer({ trash, onClose, onRestore, onRemove }) {
  return (
    <div className="cr-drawer-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="cr-drawer" role="dialog" aria-modal="true" aria-label="回收站">
        <div className="cr-drawer-head">
          <div>
            <span className="eyebrow">TRASH</span>
            <h2>回收站</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭回收站">×</button>
        </div>
        {trash.length === 0 ? (
          <p className="cr-drawer-empty">回收站是空的。删除的笔记会在这里保留，可随时恢复。</p>
        ) : (
          <>
            <p className="cr-drawer-hint">服务端会在删除 30 天后自动清理，清理前可随时恢复。</p>
            <ul className="cr-trash-list">
              {trash.map(note => {
                const meta = TYPE_MAP[note.type]
                return (
                  <li key={note.id} className="cr-trash-item">
                    <div className="cr-trash-main">
                      <span className="cr-type-chip" style={{ '--mc': meta.color }}><i style={{ background: meta.color }} />{meta.label}</span>
                      <NoteQuote quote={note.anchor?.quote} type={note.type} muted />
                      <p>{note.body}</p>
                      <span className="cr-card-time">删除于 {formatTime(note.deletedAt)}</span>
                    </div>
                    <div className="cr-trash-actions">
                      <button type="button" className="secondary-btn" onClick={() => onRestore(note.id)}><RotateCcw size={14} />恢复</button>
                      <button type="button" className="cr-card-btn cr-danger" onClick={() => onRemove(note.id)}><Trash2 size={13} />彻底删除</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
