import { db } from './db'
import type { BookRecord, ReadingEventRecord, ReadingEventType, ReadingSource } from '../types'

export async function recordReadingEvent(bookId: string, type: ReadingEventType, source: ReadingSource, data: Partial<ReadingEventRecord> = {}) {
  await db.readingEvents.add({ bookId, type, source, createdAt: Date.now(), ...data })
}

function elapsedLabel(since: number) {
  const ms = Math.max(0, Date.now() - since)
  const hours = Math.floor(ms / 3600000)
  if (hours < 1) return 'menos de una hora'
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} ${days === 1 ? 'día' : 'días'}`
  const months = Math.floor(days / 30)
  return `${months} ${months === 1 ? 'mes' : 'meses'}`
}

function concise(text: string, max = 220) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function topCategories(rows: { category: string }[]) {
  const map = new Map<string, number>()
  rows.forEach(row => map.set(row.category, (map.get(row.category) || 0) + 1))
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }))
}

export async function shouldOfferReentry(book: BookRecord, reentryHours: number) {
  const elapsedHours = Math.max(0, (Date.now() - book.lastOpenedAt) / 3600000)
  const [highlights, messages, events] = await Promise.all([
    db.highlights.where('bookId').equals(book.id).toArray(),
    db.tutorMessages.where('bookId').equals(book.id).toArray(),
    db.readingEvents.where('bookId').equals(book.id).toArray()
  ])
  const recentCutoff = Date.now() - 30 * 86400000
  const recentHighlights = highlights.filter(h => h.createdAt >= recentCutoff)
  const recentQuestions = messages.filter(m => m.role === 'user' && m.createdAt >= recentCutoff)
  const lastRecap = events.filter(e => e.type === 'recap').sort((a, b) => b.createdAt - a.createdAt)[0]
  const distance = Math.max(0, (book.progress || 0) - (lastRecap?.progress || 0))
  const conceptualDensity = recentHighlights.filter(h => ['concept', 'argument', 'evidence'].includes(h.category)).length
  const difficulty = recentHighlights.filter(h => ['question', 'contradiction'].includes(h.category)).length + recentQuestions.length
  const notes = recentHighlights.filter(h => Boolean(h.note)).length
  const score = Math.min(3, elapsedHours / Math.max(1, reentryHours) * 3) + Math.min(2, conceptualDensity * .28) + Math.min(2, difficulty * .36) + Math.min(1.5, notes * .25) + (distance >= .08 ? 1 : 0)
  const offer = book.progress > .001 && (elapsedHours >= reentryHours || (elapsedHours >= Math.min(24, reentryHours / 2) && score >= 4.2))
  const reasons: string[] = []
  if (elapsedHours >= reentryHours) reasons.push('tiempo transcurrido')
  if (distance >= .08) reasons.push('distancia de lectura acumulada')
  if (conceptualDensity >= 3) reasons.push('densidad conceptual')
  if (difficulty >= 2) reasons.push('dudas o dificultad registrada')
  if (notes >= 2) reasons.push('cantidad de notas')
  return { offer, score, reasons, elapsedHours }
}

export async function buildReadingDigest(book: BookRecord) {
  const [highlights, messages, events, memory] = await Promise.all([
    db.highlights.where('bookId').equals(book.id).toArray(),
    db.tutorMessages.where('bookId').equals(book.id).toArray(),
    db.readingEvents.where('bookId').equals(book.id).toArray(),
    db.tutorMemory.where('bookId').equals(book.id).toArray()
  ])
  const recentHighlights = highlights.sort((a, b) => b.createdAt - a.createdAt).slice(0, 6)
  const readerNotes = recentHighlights.filter(h => h.note).slice(0, 4)
  const questions = messages.filter(m => m.role === 'user').sort((a, b) => b.createdAt - a.createdAt).slice(0, 4)
  const answers = messages.filter(m => m.role === 'assistant').sort((a, b) => b.createdAt - a.createdAt).slice(0, 2)
  const recentEvents = events.sort((a, b) => b.createdAt - a.createdAt).slice(0, 18)
  const lastChapter = recentEvents.find(e => e.chapter)?.chapter || ''
  const pending = recentHighlights.filter(h => h.category === 'question').map(h => concise(h.note || h.text, 180)).slice(0, 3)
  const memories = memory.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map(m => `${m.key}: ${concise(m.value, 180)}`)

  return {
    elapsed: elapsedLabel(book.lastOpenedAt),
    progress: Math.round((book.progress || 0) * 100),
    lastChapter,
    bookEvidence: recentHighlights.map(h => ({ text: concise(h.text), category: h.category, createdAt: h.createdAt })),
    readerNotes: readerNotes.map(h => ({ text: concise(h.note || ''), quote: concise(h.text, 130), createdAt: h.createdAt })),
    questions: questions.map(q => ({ text: concise(q.content), createdAt: q.createdAt })),
    aiResponses: answers.map(a => ({ text: concise(a.content, 260), createdAt: a.createdAt })),
    pending,
    interests: topCategories(highlights),
    memories,
    events: recentEvents
  }
}

export async function getReadingTimeline(bookId: string) {
  return (await db.readingEvents.where('bookId').equals(bookId).toArray()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 80)
}
