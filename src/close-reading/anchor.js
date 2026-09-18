// 笔记锚点：以「章节内偏移 + 原文引用 + 前后文上下文」定位。
// 原文版本变化时，用前后文上下文做序列对齐（LCS）模糊重定位。

const OFFSET_TABLE_CACHE = new Map()
const OFFSET_CACHE_LIMIT = 24

// 把段落数组拼成带 \n 的全文，并记录每段起止偏移（用于按段渲染与定位）
export function buildTextModel(chapter) {
  const offsets = []
  let text = ''
  for (const paragraph of chapter.paragraphs) {
    offsets.push({ start: text.length, end: text.length + paragraph.length })
    text += paragraph + '\n'
  }
  return { text: text.slice(0, -1), offsets }
}

// 归一化：忽略空白与常见标点差异，用于模糊匹配
const PUNCTUATION = new Set([
  '，', '。', '！', '？', '；', '：', '、',
  '“', '”', '‘', '’', '"', "'",
  '（', '）', '《', '》', '〈', '〉', '【', '】', '〔', '〕',
  '…', '—', '·', '.', ',', '!', '?', ';', ':', '(', ')', '[', ']'
])
export function normalizeChar(ch) {
  if (/\s/.test(ch)) return ''
  if (PUNCTUATION.has(ch)) return ''
  return ch.toLowerCase()
}

export function normalizeText(text) {
  let out = ''
  for (const ch of text) {
    const n = normalizeChar(ch)
    if (n) out += n
  }
  return out
}

// 原始偏移 -> 归一化偏移表
function getOffsetTable(text) {
  const cached = OFFSET_TABLE_CACHE.get(text)
  if (cached) return cached
  const map = new Map()
  let norm = ''
  let i = 0
  for (const ch of text) {
    const n = normalizeChar(ch)
    if (n) { map.set(norm.length, i); norm += n }
    i++
  }
  const built = { norm, map, text }
  if (OFFSET_TABLE_CACHE.size >= OFFSET_CACHE_LIMIT) OFFSET_TABLE_CACHE.clear()
  OFFSET_TABLE_CACHE.set(text, built)
  return built
}

// 计算 normA[i] 是否等于 normB[j] 的“运行匹配”，返回 A 中每段匹配到 B 的区间。
// 使用 LCS（两段上下文通常都很短，O(n*m) 足够；长上下文降级为直接搜索）。
function lcsAlign(aNorm, bNorm, maxMatrixSize = 200 * 200) {
  if (aNorm.length * bNorm.length > maxMatrixSize) return null
  const n = aNorm.length, m = bNorm.length
  // 滚动数组 LCS 长度表 + 回溯
  const rows = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      rows[i][j] = aNorm[i] === bNorm[j]
        ? rows[i + 1][j + 1] + 1
        : Math.max(rows[i + 1][j], rows[i][j + 1])
    }
  }
  const pairs = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (aNorm[i] === bNorm[j]) { pairs.push([i, j]); i++; j++ }
    else if (rows[i + 1][j] >= rows[i][j + 1]) i++
    else j++
  }
  return pairs
}

function indexOfNorm(haystackNorm, needleNorm) {
  if (!needleNorm.length) return -1
  outer: for (let k = 0; k <= haystackNorm.length - needleNorm.length; k++) {
    for (let t = 0; t < needleNorm.length; t++) {
      if (haystackNorm[k + t] !== needleNorm[t]) continue outer
    }
    return k
  }
  return -1
}

// 归一化位置 -> 原文位置
function denorm(table, normPos, edge = 'start') {
  const exact = table.map.get(normPos)
  if (exact !== undefined) return exact
  // 找最接近的已记录位置
  let best = null
  for (const p of table.map.keys()) {
    if (best === null || Math.abs(p - normPos) < Math.abs(best - normPos)) best = p
  }
  if (best !== null) return table.map.get(best)
  return edge === 'start' ? 0 : table.norm.length
}

// 区间起始：归一化下标 nStart 对应的原文位置（若落在标点/空白上，向前吸收）
function denormStart(table, nStart) {
  if (table.map.has(nStart)) return table.map.get(nStart)
  if (nStart >= table.norm.length) {
    const last = table.map.get(table.norm.length - 1)
    return last === undefined ? 0 : last + 1
  }
  let p = nStart
  while (p >= 0 && !table.map.has(p)) p--
  if (p < 0) { // 开头是标点
    let q = nStart + 1
    while (q < table.norm.length && !table.map.has(q)) q++
    return table.map.has(q) ? table.map.get(q) : 0
  }
  return table.map.get(p) + 1
}

// 区间结束：归一化最后一个字符 nEnd-1 之后的原文位置（向后吸收标点/空白）
function denormEnd(table, nEnd) {
  const lastN = nEnd - 1
  if (table.map.has(lastN)) return table.map.get(lastN) + 1
  if (nEnd <= 0) {
    return table.map.has(0) ? table.map.get(0) : 0
  }
  let p = lastN
  while (p >= 0 && !table.map.has(p)) p--
  if (p < 0) {
    let q = nEnd
    while (q < table.norm.length && !table.map.has(q)) q++
    return table.map.has(q) ? table.map.get(q) : 0
  }
  let raw = table.map.get(p) + 1
  // 把紧随其后的标点、空白一并吞进区间
  while (raw < table.text.length) {
    const ch = table.text[raw]
    if (/\s/.test(ch) || PUNCTUATION.has(ch)) raw++
    else break
  }
  return raw
}

const CONTEXT_RADIUS = 24

// 创建锚点
export function createAnchor(text, start, end) {
  const safeStart = Math.max(0, Math.min(start, text.length))
  const safeEnd = Math.max(safeStart, Math.min(end, text.length))
  const ctxStart = Math.max(0, safeStart - CONTEXT_RADIUS)
  const ctxEnd = Math.min(text.length, safeEnd + CONTEXT_RADIUS)
  return {
    start: safeStart,
    end: safeEnd,
    quote: text.slice(safeStart, safeEnd),
    context: text.slice(ctxStart, ctxEnd),
    contextOffset: safeStart - ctxStart
  }
}

// 在新文本中重定位锚点。
// 返回 { status: 'exact'|'shifted'|'fuzzy'|'lost', start, end }；
// status='fuzzy' 且 start===end 表示原文已被删除，位置指向“删除点”。
export function relocate(anchor, oldText, newText) {
  if (newText === oldText && anchor.end <= newText.length) {
    return { status: 'exact', start: anchor.start, end: anchor.end }
  }

  const newTable = getOffsetTable(newText)
  const quoteNorm = normalizeText(anchor.quote || '')

  // 0) 原文引用（含标点）精确搜索：唯一命中时边界最准
  if (anchor.quote) {
    const hits = []
    let from = 0
    while (hits.length < 3) {
      const idx = newText.indexOf(anchor.quote, from)
      if (idx === -1) break
      hits.push(idx)
      from = idx + anchor.quote.length
    }
    if (hits.length === 1) {
      const start = hits[0], end = start + anchor.quote.length
      const status = start === anchor.start && end === anchor.end ? 'exact' : 'shifted'
      return { status, start, end }
    }
  }

  // 1) 归一化引用搜索：忽略空白/标点差异，新文本中唯一命中
  if (quoteNorm.length) {
    const hits = []
    let from = 0
    while (hits.length < 3) {
      const idx = indexOfNorm(newTable.norm.slice(from), quoteNorm)
      if (idx === -1) break
      hits.push(from + idx)
      from += idx + 1
    }
    if (hits.length === 1) {
      const ns = hits[0], ne = ns + quoteNorm.length
      const start = denormStart(newTable, ns)
      const end = denormEnd(newTable, ne)
      const status = start === anchor.start && end === anchor.end ? 'exact' : 'shifted'
      return { status, start, end: Math.min(end, newText.length) }
    }
  }

  // 2) 上下文对齐：把旧上下文与新文本中“旧锚点附近”的窗口对齐
  const ctxRawStart = Math.max(0, anchor.start - CONTEXT_RADIUS)
  const ctxRawEnd = Math.min(oldText.length, anchor.end + CONTEXT_RADIUS)
  const ctxNorm = normalizeText(oldText.slice(ctxRawStart, ctxRawEnd))
  const quoteInCtxStart = normalizeText(oldText.slice(ctxRawStart, anchor.start)).length
  const quoteInCtxEnd = quoteInCtxStart + quoteNorm.length

  // 先在锚点原位置附近取窗口；找不到再全量搜索
  const windowCenter = Math.min(anchor.start, newText.length)
  const windowRadius = Math.max(120, ctxRawEnd - ctxRawStart + 200)
  const winRawStart = Math.max(0, windowCenter - windowRadius)
  const winRawEnd = Math.min(newText.length, windowCenter + windowRadius)
  const winText = newText.slice(winRawStart, winRawEnd)
  const windowNorm = normalizeText(winText)

  let ctxNormPos = indexOfNorm(windowNorm, ctxNorm)
  let globalSearch = false
  if (ctxNormPos === -1) {
    ctxNormPos = indexOfNorm(newTable.norm, ctxNorm)
    globalSearch = true
  }

  const resolvePoint = (table, offset, base = 0) => base + denormStart(table, offset)

  if (ctxNormPos !== -1 && ctxNorm.length >= 4) {
    const table = globalSearch ? newTable : getOffsetTable(winText)
    const base = globalSearch ? 0 : winRawStart
    const ns = ctxNormPos + quoteInCtxStart
    const ne = ctxNormPos + quoteInCtxEnd
    if (ns < ne) {
      const startRaw = resolvePoint(table, ns, base)
      const endRaw = base + denormEnd(table, ne)
      if (endRaw > startRaw) {
        return { status: 'fuzzy', start: startRaw, end: Math.min(endRaw, newText.length) }
      }
    }
    // 引用本身被删空，但上下文还在：落在引用的删除点（零长度锚点）
    if (quoteNorm.length > 0) {
      const point = resolvePoint(table, ns, base)
      return { status: 'fuzzy', start: point, end: point, deleted: true }
    }
  }

  // 3) 上下文本身也被改动：LCS 对齐，看引用主体覆盖率
  const pairs = lcsAlign(ctxNorm, windowNorm)
  if (pairs && pairs.length) {
    const inQuote = pairs.filter(([a]) => a >= quoteInCtxStart && a < quoteInCtxEnd)
    const quoteLen = Math.max(1, quoteInCtxEnd - quoteInCtxStart)
    const winTable = getOffsetTable(winText)
    if (inQuote.length / quoteLen >= 0.6 && inQuote.length > 0) {
      const bs = inQuote.map(([, b]) => b)
      const ns = Math.min(...bs), ne = Math.max(...bs) + 1
      const start = winRawStart + denormStart(winTable, ns)
      const end = winRawStart + denormEnd(winTable, ne)
      if (end > start) return { status: 'fuzzy', start, end: Math.min(end, newText.length) }
    }
    // 引用全删，但上下文通过 LCS 仍可定位：取删除点两侧的间隙
    const before = pairs.filter(([a]) => a < quoteInCtxStart)
    const after = pairs.filter(([a]) => a >= quoteInCtxEnd)
    const surrounding = before.length + after.length
    if (quoteNorm.length > 0 && surrounding >= 6 &&
        before.length / Math.max(1, quoteInCtxStart) >= 0.5 &&
        after.length / Math.max(1, ctxNorm.length - quoteInCtxEnd) >= 0.5) {
      const rightB = after.length ? Math.min(...after.map(([, b]) => b)) : windowNorm.length
      const point = winRawStart + denormStart(winTable, rightB)
      return { status: 'fuzzy', start: point, end: point, deleted: true }
    }
  }

  // 4) 彻底找不到
  return { status: 'lost', start: null, end: null }
}

export function excerptAt(text, start, end, radius = 28) {
  const s = Math.max(0, start - radius)
  const e = Math.min(text.length, end + radius)
  return (s > 0 ? '…' : '') + text.slice(s, e) + (e < text.length ? '…' : '')
}
