export const NOTE_TYPES = [
  { id: 'character', label: '人物', hint: '人物性格、关系、出场与口吻', color: '#c05a6b' },
  { id: 'narrative', label: '叙事', hint: '视角、节奏、伏笔、结构', color: '#7a6bb0' },
  { id: 'language', label: '语言', hint: '炼字、句式、语气与修辞', color: '#2f8a78' },
  { id: 'symbol', label: '象征', hint: '意象、象征与互文', color: '#c08a2e' },
  { id: 'plot', label: '情节', hint: '事件、因果与冲突推进', color: '#3f7aae' }
]

export const TYPE_MAP = Object.fromEntries(NOTE_TYPES.map(t => [t.id, t]))

export const RELOCATE_STATUS = {
  exact: { label: '原位', tone: 'ok' },
  shifted: { label: '已随文本移动', tone: 'ok' },
  fuzzy: { label: '依据上下文推测', tone: 'warn' },
  deleted: { label: '原文此处已删除', tone: 'warn' },
  lost: { label: '原文已变动，无法定位', tone: 'bad' }
}

export function statusOf(resolved) {
  if (resolved.status === 'fuzzy' && resolved.deleted) return 'deleted'
  return resolved.status
}

export function formatTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value))
}
