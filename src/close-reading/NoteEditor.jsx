import { useEffect, useRef, useState } from 'react'
import { Check, Trash2, X, Link2, FileWarning } from 'lucide-react'
import { NOTE_TYPES, TYPE_MAP, RELOCATE_STATUS } from './constants'

// 创建 / 编辑笔记的弹层内容
export default function NoteEditor({ mode, initial, quote, relocateStatus, sourceVariantLabel, onClose, onSubmit, onDelete, onStartReanchor }) {
  const [type, setType] = useState(initial?.type || 'character')
  const [body, setBody] = useState(initial?.body || '')
  const textareaRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  const submit = event => {
    event?.preventDefault()
    if (!body.trim()) { textareaRef.current?.focus(); return }
    onSubmit({ type, body })
  }

  const statusMeta = relocateStatus ? RELOCATE_STATUS[relocateStatus] : null
  const meta = TYPE_MAP[type]

  return (
    <form className="cr-editor" onSubmit={submit}>
      <div className="cr-editor-head">
        <strong>{mode === 'create' ? '添加精读笔记' : '编辑笔记'}</strong>
        <button type="button" className="icon-btn cr-pop-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
      </div>

      {statusMeta && (
        <div className={`cr-relocate-tip cr-tone-${statusMeta.tone}`}>
          {relocateStatus === 'deleted'
            ? '这段原文在新版本中已被删除，笔记目前标记在删除位置，可重新指定。'
            : relocateStatus === 'fuzzy'
              ? '原文版本已变化，此位置依据上下文推测，可点右侧重新指定。'
              : '此笔记在当前版本中已无法定位。'}
          {onStartReanchor && (
            <button type="button" className="cr-card-btn" onClick={onStartReanchor}><Link2 size={13} />重新指定原文</button>
          )}
        </div>
      )}
      {sourceVariantLabel && !statusMeta && (
        <div className="cr-relocate-tip cr-tone-neutral"><FileWarning size={13} />该笔记写于「{sourceVariantLabel}」，已映射到当前版本。</div>
      )}

      <blockquote className="cr-editor-quote" style={{ '--mc': meta.color }}>
        <span className="cr-card-quote-bar" /><span>{quote}</span>
      </blockquote>

      <fieldset className="cr-type-grid" aria-label="笔记类型">
        {NOTE_TYPES.map(t => (
          <button
            key={t.id}
            type="button"
            className={`cr-type-option ${type === t.id ? 'is-selected' : ''}`}
            style={{ '--mc': t.color }}
            aria-pressed={type === t.id}
            title={t.hint}
            onClick={() => setType(t.id)}
          >
            <i style={{ background: t.color }} />{t.label}
          </button>
        ))}
      </fieldset>

      <textarea
        ref={textareaRef}
        className="cr-editor-body"
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={TYPE_MAP[type].hint}
        rows={4}
        aria-label="笔记内容"
      />

      <div className="cr-editor-actions">
        {mode === 'edit' && onDelete && (
          <button type="button" className="cr-card-btn cr-danger" onClick={() => onDelete(initial.id)}>
            <Trash2 size={13} />删除
          </button>
        )}
        <span className="cr-editor-hint">{body.trim() ? '' : '写下内容后才能保存'}</span>
        <button type="button" className="text-btn" onClick={onClose}>取消</button>
        <button type="submit" className="primary-btn" disabled={!body.trim()}>
          <Check size={14} />{mode === 'create' ? '保存笔记' : '保存修改'}
        </button>
      </div>
    </form>
  )
}
