import ePub from 'epubjs'
import { db } from './db'
import type { BookChunkRecord, BookRecord, SearchResult, TutorContextRef } from '../types'

const STOPWORDS = new Set([
  'de','la','el','los','las','un','una','unos','unas','y','o','a','en','que','por','para','con','sin','del','al','se','su','sus','es','son','fue','como','más','menos','lo','le','les','ya','pero','si','no','este','esta','estos','estas','ese','esa','eso','entre','sobre','desde','hasta','muy','también','todo','toda','todos','todas','ha','han','hay','ser','estar','the','of','and','to','in','a','is','that','for','as','with'
])

export function normalizeText(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9áéíóúüñ\s]/gi, ' ').replace(/\s+/g, ' ').trim()
}

function terms(text: string) {
  return normalizeText(text).split(' ').filter(t => t.length > 2 && !STOPWORDS.has(t))
}

function splitIntoChunks(text: string, targetWords = 220, overlapWords = 35) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return []
  const chunks: string[] = []
  const step = Math.max(40, targetWords - overlapWords)
  for (let i = 0; i < words.length; i += step) {
    const chunk = words.slice(i, i + targetWords).join(' ').trim()
    if (chunk.length > 120) chunks.push(chunk)
    if (i + targetWords >= words.length) break
  }
  return chunks
}

function chapterLabelFromHref(href: string, toc: any[]): string {
  const clean = href.split('#')[0]
  const stack = [...toc]
  while (stack.length) {
    const item = stack.shift()
    if (!item) continue
    const itemHref = String(item.href ?? '').split('#')[0]
    if (itemHref && (clean.endsWith(itemHref) || itemHref.endsWith(clean))) return String(item.label ?? 'Capítulo')
    if (Array.isArray(item.subitems)) stack.push(...item.subitems)
  }
  return 'Sección'
}

function chunkProgress(spineIndex: number, chunkIndex: number, chunkCount: number, spineCount: number) {
  if (spineCount <= 0) return 0
  const within = chunkCount > 0 ? Math.min(.999, (chunkIndex + .5) / chunkCount) : 0
  return Math.max(0, Math.min(1, (spineIndex + within) / spineCount))
}

export async function indexBook(record: BookRecord, onProgress?: (value: number) => void) {
  await db.books.update(record.id, { indexingStatus: 'indexing' })
  await db.chunks.where('bookId').equals(record.id).delete()

  try {
    const buffer = await record.file.arrayBuffer()
    const book = ePub(buffer)
    await book.ready
    const navigation = await book.loaded.navigation
    const toc = navigation?.toc ?? []
    const items: any[] = (book.spine as any)?.spineItems ?? []
    const rows: BookChunkRecord[] = []

    for (let i = 0; i < items.length; i++) {
      const section = items[i]
      try {
        const loaded = await section.load(book.load.bind(book))
        const doc: Document | undefined = loaded?.nodeType === 9 ? loaded : section.document
        const raw = doc?.body?.innerText || doc?.documentElement?.textContent || ''
        const text = raw.replace(/\s+/g, ' ').trim()
        const pieces = splitIntoChunks(text)
        const chapterLabel = chapterLabelFromHref(section.href || '', toc)
        pieces.forEach((piece, chunkIndex) => {
          rows.push({
            bookId: record.id,
            href: section.href || '',
            chapterLabel,
            spineIndex: i,
            progress: chunkProgress(i, chunkIndex, pieces.length, Math.max(1, items.length)),
            chunkIndex,
            text: piece,
            normalized: normalizeText(piece)
          })
        })
        try { section.unload() } catch {}
      } catch {
        // Un XHTML defectuoso no debe invalidar el resto del EPUB.
      }
      onProgress?.((i + 1) / Math.max(1, items.length))
    }

    if (rows.length) {
      const batch = 700
      for (let i = 0; i < rows.length; i += batch) await db.chunks.bulkAdd(rows.slice(i, i + batch))
    }
    let locations: string | undefined
    try { await book.locations.generate(1500); locations = book.locations.save() } catch {}
    await db.books.update(record.id, { indexedAt: Date.now(), indexingStatus: 'ready', locations })
    try { book.destroy() } catch {}
    return rows.length
  } catch (error) {
    await db.books.update(record.id, { indexingStatus: 'error' })
    throw error
  }
}

function scoreChunk(queryTerms: string[], chunk: BookChunkRecord) {
  if (!queryTerms.length) return 0
  const haystack = chunk.normalized
  const chunkTerms = new Set(terms(chunk.text))
  let score = 0
  for (const term of queryTerms) {
    if (chunkTerms.has(term)) score += 3
    else if (haystack.includes(term)) score += 1
  }
  const phrase = queryTerms.join(' ')
  if (phrase.length > 6 && haystack.includes(phrase)) score += 8
  return score / Math.sqrt(Math.max(1, chunk.text.length / 500))
}

async function eligibleChunks(bookId: string, currentProgress: number, strictSpoilers: boolean) {
  if (!strictSpoilers) return db.chunks.where('bookId').equals(bookId).toArray()
  const max = Math.max(0, Math.min(1, currentProgress + .008))
  return db.chunks.where('[bookId+progress]').between([bookId, 0], [bookId, max], true, true).toArray()
}

export async function searchBook(bookId: string, query: string, currentProgress = 1, strictSpoilers = false, limit = 8): Promise<SearchResult[]> {
  const queryTerms = terms(query)
  if (!queryTerms.length) return []
  const all = await eligibleChunks(bookId, currentProgress, strictSpoilers)
  return all.map(c => ({ id: c.id, href: c.href, chapterLabel: c.chapterLabel, progress: c.progress, text: c.text, score: scoreChunk(queryTerms, c) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || Math.abs(b.progress - currentProgress) - Math.abs(a.progress - currentProgress))
    .slice(0, limit)
}

export async function retrieveContextDetailed(bookId: string, query: string, progress: number, strictSpoilers: boolean, limit = 5) {
  const results = await searchBook(bookId, query, progress, strictSpoilers, limit)
  const refs: TutorContextRef[] = results.map(r => ({ href: r.href, chapterLabel: r.chapterLabel, progress: r.progress, excerpt: r.text.slice(0, 360), score: r.score }))
  const text = results.map((r, i) => `[Fragmento ${i + 1} — ${r.chapterLabel} — ${Math.round(r.progress * 100)}%]\n${r.text}`).join('\n\n')
  return { text, refs }
}

export async function retrieveContext(bookId: string, query: string, progress: number, strictSpoilers: boolean) {
  return (await retrieveContextDetailed(bookId, query, progress, strictSpoilers)).text
}

export async function getChapterText(bookId: string, href?: string, progress?: number) {
  let rows = await db.chunks.where('bookId').equals(bookId).toArray()
  if (href) {
    const clean = href.split('#')[0]
    const byHref = rows.filter(r => r.href.split('#')[0] === clean || r.href.endsWith(clean) || clean.endsWith(r.href.split('#')[0]))
    if (byHref.length) rows = byHref
  } else if (typeof progress === 'number') {
    const nearest = [...rows].sort((a, b) => Math.abs(a.progress - progress) - Math.abs(b.progress - progress))[0]
    if (nearest) rows = rows.filter(r => r.spineIndex === nearest.spineIndex)
  }
  if (typeof progress === 'number') rows = rows.filter(r => r.progress <= Math.min(1, progress + .008))
  return rows.sort((a, b) => a.chunkIndex - b.chunkIndex).map(r => r.text).join('\n\n')
}
