import { db } from './db'

export async function getTutorMemory(bookId: string) {
  const rows = await db.tutorMemory.where('bookId').equals(bookId).toArray()
  return rows
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12)
    .map(r => `${r.key}: ${r.value}`)
    .join('\n')
}

export async function remember(bookId: string, key: string, value: string) {
  const existing = await db.tutorMemory.where('[bookId+key]').equals([bookId, key]).first()
  const now = Date.now()
  if (existing?.id) {
    await db.tutorMemory.update(existing.id, { value, updatedAt: now })
  } else {
    await db.tutorMemory.add({ bookId, key, value, createdAt: now, updatedAt: now })
  }
}

export async function clearTutorMemory(bookId: string) {
  await db.tutorMemory.where('bookId').equals(bookId).delete()
}
