import { db } from './db'

export async function getTutorMemoryRows(bookId: string, limit = 16) {
  const rows = await db.tutorMemory.where('bookId').equals(bookId).toArray()
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

export async function getTutorMemory(bookId: string) {
  return (await getTutorMemoryRows(bookId)).map(r => `${r.key}: ${r.value}`).join('\n')
}

export async function remember(bookId: string, key: string, value: string) {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return
  const existing = await db.tutorMemory.where('[bookId+key]').equals([bookId, key]).first()
  const now = Date.now()
  if (existing?.id) await db.tutorMemory.update(existing.id, { value: clean, updatedAt: now })
  else await db.tutorMemory.add({ bookId, key, value: clean, createdAt: now, updatedAt: now })
}

export async function rememberMany(bookId: string, entries: Array<[string, string | undefined]>) {
  await Promise.all(entries.filter((entry): entry is [string, string] => Boolean(entry[1]?.trim())).map(([key, value]) => remember(bookId, key, value)))
}

export async function rememberTutorTurn(bookId: string, data: { chapter?: string; task?: string; question?: string; selectedText?: string; progress?: number }) {
  await rememberMany(bookId, [
    ['Último capítulo trabajado', data.chapter],
    ['Última operación del tutor', data.task],
    ['Última pregunta', data.question?.slice(0, 320)],
    ['Último fragmento trabajado', data.selectedText?.slice(0, 620)],
    ['Última posición intelectual', typeof data.progress === 'number' ? `${Math.round(data.progress * 100)}% del libro` : undefined]
  ])
}

export async function clearTutorMemory(bookId: string) {
  await db.tutorMemory.where('bookId').equals(bookId).delete()
}
