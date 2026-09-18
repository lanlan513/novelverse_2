import { Fragment, memo, useMemo } from 'react'
import { TYPE_MAP } from './constants'

// 检测浏览器是否支持文本选区 API（极旧浏览器 / 某些 webview 不支持）
export function selectionSupported() {
  return typeof window.getSelection === 'function' &&
    typeof document.createRange === 'function' &&
    typeof Range.prototype.getBoundingClientRect === 'function'
}

// 读取当前选区；仅支持落在同一段落内的选择
export function readSelection(articleEl) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const startP = range.startContainer.nodeType === 1
    ? range.startContainer.closest?.('p[data-p]')
    : range.startContainer.parentElement?.closest('p[data-p]')
  const endP = range.endContainer.nodeType === 1
    ? range.endContainer.closest?.('p[data-p]')
    : range.endContainer.parentElement?.closest('p[data-p]')
  if (!startP || !endP || !articleEl.contains(startP)) return null
  if (startP !== endP) return { crossParagraph: true, range }
  // 正文实际位于 .cr-paragraph-text 内（与 model 中纯段落文本一致）
  const textEl = startP.querySelector('.cr-paragraph-text') || startP
  const pLength = textEl.textContent.length
  const toOffset = (node, offset, edge) => {
    // 选区落在正文元素之外（如段末按钮）时，钳到段落边界
    if (!textEl.contains(node)) return edge === 'start' ? 0 : pLength
    const range = document.createRange()
    range.setStart(textEl, 0)
    range.setEnd(node, offset)
    return range.toString().length
  }
  const localStart = Math.min(pLength, toOffset(range.startContainer, range.startOffset, 'start'))
  const localEnd = Math.min(pLength, toOffset(range.endContainer, range.endOffset, 'end'))
  if (localEnd <= localStart) return null
  return { paragraphIndex: Number(startP.dataset.p), localStart, localEnd, range }
}

// 按精确 id 查找原文标记元素（data-note-ids 是逗号分隔列表，不能用子串匹配）
export function findNoteElement(noteId) {
  const els = document.querySelectorAll('[data-note-ids]')
  for (const el of els) {
    const ids = (el.getAttribute('data-note-ids') || '').split(',')
    if (ids.includes(noteId)) return el
  }
  return null
}

// 把相互重叠的标记切成互不嵌套的渲染段；零长度标记（原文被删）作为插入符单独返回
function buildParagraphSegments(pStart, pEnd, marks) {
  const inRange = marks
    .filter(m => m.end >= pStart && m.start <= pEnd)
    .map(m => {
      // 零长度删除点若落在段末换行符上，钳到本段末尾（下一段不再重复归属）
      const atBoundary = m.start === m.end && m.start === pEnd
      return { ...m, s: atBoundary ? pEnd : Math.max(m.start, pStart), e: Math.min(m.end, pEnd) }
    })
  if (!inRange.length) return null
  const carets = []
  const points = new Set([pStart, pEnd])
  for (const m of inRange) {
    if (m.s === m.e) {
      // 钳到段末的点只属于上一段；段首换行点归属当前段
      if (m.s === pEnd) carets.push(m)
      else if (m.s >= pStart) carets.push({ ...m, s: Math.max(m.s, pStart) })
      continue
    }
    points.add(m.s); points.add(m.e)
  }
  const cuts = [...points].sort((a, b) => a - b)
  const segments = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i], e = cuts[i + 1]
    if (e <= s) continue
    const covering = inRange
      .filter(m => m.s <= s && m.e >= e && m.e > m.s)
      .sort((a, b) => a.start - b.start || a.note.id.localeCompare(b.note.id))
    if (covering.length) segments.push({ s, e, covering })
  }
  // 去重（多个来源可能产生同一 carets）
  const seen = new Set()
  const uniqueCarets = carets.filter(m => !seen.has(m.note.id) && seen.add(m.note.id))
  return { segments, carets: uniqueCarets }
}

const CaretMark = memo(function CaretMark({ mark, dimmed, active, activeVariant, onOpen }) {
  const meta = TYPE_MAP[mark.note.type] || TYPE_MAP.plot
  return (
    <button
      type="button"
      className={[
        'cr-caret',
        mark.status === 'fuzzy' ? 'is-fuzzy' : '',
        dimmed ? 'is-dimmed' : '',
        active ? 'is-active' : '',
        mark.sourceVariant !== activeVariant ? 'is-crossvariant' : ''
      ].filter(Boolean).join(' ')}
      style={{ '--mc': meta.color }}
      data-note-ids={mark.note.id}
      title={`原文已删除的笔记（${meta.label}）：${mark.note.body?.slice(0, 40) || ''}`}
      onMouseDown={e => e.preventDefault()}
      onClick={e => { e.stopPropagation(); onOpen([mark.note.id]) }}
      aria-label="原文已删除位置的笔记"
    >
      <span className="cr-caret-glyph" />
    </button>
  )
})

const Mark = memo(function Mark({ text, covering, dimmed, active, activeVariant, onOpen }) {
  const primary = covering[0]
  const meta = TYPE_MAP[primary.note.type] || TYPE_MAP.plot
  const classes = [
    'cr-mark',
    covering.length > 1 ? 'is-multi' : '',
    primary.status === 'fuzzy' || primary.status === 'shifted' ? `is-${primary.status}` : '',
    dimmed ? 'is-dimmed' : '',
    active ? 'is-active' : '',
    primary.sourceVariant !== activeVariant ? 'is-crossvariant' : ''
  ].filter(Boolean).join(' ')
  return (
    <mark
      className={classes}
      style={{ '--mc': meta.color }}
      data-note-ids={covering.map(c => c.note.id).join(',')}
      onMouseDown={e => e.preventDefault()} // 按住标记时不破坏选区
      onClick={e => { e.stopPropagation(); onOpen(covering.map(c => c.note.id)) }}
    >
      {text}
      {covering.length > 1 && <span className="cr-mark-count">{covering.length}</span>}
    </mark>
  )
})

const Paragraph = memo(function Paragraph({ index, start, end, text, segments, activeNoteId, highlightIds, onOpen, onAnnotateParagraph, canSelect, activeVariant }) {
  const renderContent = () => {
    if (!segments) return text
    const { segments: segs, carets } = segments
    const nodes = []
    let cursor = start
    const caretAt = pos => carets
      .filter(m => m.s === pos)
      .map(m => (
        <CaretMark key={`caret-${m.note.id}`} mark={m}
          dimmed={highlightIds !== null && !highlightIds.has(m.note.id)}
          active={m.note.id === activeNoteId}
          activeVariant={activeVariant} onOpen={onOpen} />
      ))
    if (carets.some(m => m.s === start)) nodes.push(...caretAt(start))
    for (const seg of segs) {
      if (seg.s > cursor) {
        nodes.push(<Fragment key={`t-${cursor}-${seg.s}`}>{text.slice(cursor - start, seg.s - start)}</Fragment>)
      }
      const covering = seg.covering
      const anyActive = covering.some(c => c.note.id === activeNoteId)
      // highlightIds === null 表示无筛选；否则未命中的标记变淡
      const dimmed = highlightIds !== null && !covering.some(c => highlightIds.has(c.note.id))
      nodes.push(
        <Mark
          key={`m-${seg.s}-${seg.e}`}
          text={text.slice(seg.s - start, seg.e - start)}
          covering={covering}
          dimmed={dimmed}
          active={anyActive}
          onOpen={onOpen}
          activeVariant={activeVariant}
        />
      )
      if (carets.some(m => m.s === seg.e)) nodes.push(...caretAt(seg.e))
      cursor = seg.e
    }
    if (cursor < end) nodes.push(<Fragment key="t-end">{text.slice(cursor - start, end - start)}</Fragment>)
    return nodes
  }
  return (
    <p className="cr-paragraph" data-p={index}>
      <span className="cr-paragraph-text">{renderContent()}</span>
      <button
        type="button"
        className="cr-paragraph-note-btn"
        title="对整段添加笔记（不支持划词时的备用方式）"
        aria-label={`对第 ${index + 1} 段添加笔记`}
        onMouseDown={e => e.preventDefault()}
        onClick={() => onAnnotateParagraph(index)}
        tabIndex={canSelect ? -1 : 0}
      >＋</button>
    </p>
  )
})

function ReaderText({ text, offsets, resolved, activeNoteId, highlightIds, onOpen, onAnnotateParagraph, canSelect, articleRef, activeVariant }) {
  // 每段的渲染片段：resolved 已按位置排序，一次遍历分组避免 O(段落×笔记)
  const segmentMap = useMemo(() => {
    const located = resolved.filter(r => r.status !== 'lost' && r.end >= r.start && r.start != null)
    const map = new Map()
    let p = 0
    for (const r of located) {
      const zeroLen = r.start === r.end
      while (p < offsets.length && (zeroLen ? offsets[p].end < r.start : offsets[p].end < r.start)) p++
      for (let i = p; i < offsets.length && (zeroLen ? offsets[i].start <= r.start : offsets[i].start <= r.end); i++) {
        if (!map.has(i)) map.set(i, [])
        map.get(i).push(r)
        if (zeroLen) break // 零长度只归属一个段落
      }
    }
    for (const [i, marks] of map) {
      const { start, end } = offsets[i]
      map.set(i, buildParagraphSegments(start, end, marks.map(r => ({
        start: r.start, end: r.end, status: r.status, note: r.note,
        sourceVariant: r.sourceVariant
      }))))
    }
    return map
  }, [resolved, offsets])

  return (
    <article className="cr-article" ref={articleRef} aria-label="原文">
      {offsets.map(({ start, end }, i) => (
        <Paragraph
          key={i}
          index={i}
          start={start}
          end={end}
          text={text.slice(start, end)}
          segments={segmentMap.get(i)}
          activeNoteId={activeNoteId}
          highlightIds={highlightIds}
          onOpen={onOpen}
          onAnnotateParagraph={onAnnotateParagraph}
          canSelect={canSelect}
          activeVariant={activeVariant}
        />
      ))}
    </article>
  )
}

export default memo(ReaderText)
