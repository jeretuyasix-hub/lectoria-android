import { db } from './db'
import type { BookRecord } from '../types'

const MAGIC = 'LECTORIA1\n'
const LENGTH_WIDTH = 12

interface BackupBook extends Omit<BookRecord, 'file'> {
  fileName: string
  fileSize: number
  fileType: string
}

interface BackupHeader {
  version: 1 | 2
  exportedAt: number
  books: BackupBook[]
  highlights: unknown[]
  tutorMessages: unknown[]
  tutorMemory: unknown[]
  studyArtifacts: unknown[]
  readingEvents?: unknown[]
  readingSessions?: unknown[]
  preferences?: unknown[]
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export async function createBackupBlob() {
  const books = await db.books.toArray()
  const header: BackupHeader = {
    version: 2,
    exportedAt: Date.now(),
    books: books.map(book => {
      const { file, ...rest } = book
      return { ...rest, indexingStatus: 'pending', indexedAt: undefined, fileName: (file as File)?.name || `${book.title}.epub`, fileSize: file.size, fileType: file.type || 'application/epub+zip' }
    }),
    highlights: await db.highlights.toArray(),
    tutorMessages: await db.tutorMessages.toArray(),
    tutorMemory: await db.tutorMemory.toArray(),
    studyArtifacts: await db.studyArtifacts.toArray(),
    readingEvents: await db.readingEvents.toArray(),
    readingSessions: await db.readingSessions.toArray(),
    preferences: await db.preferences.toArray()
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const lengthLine = `${String(headerBytes.byteLength).padStart(LENGTH_WIDTH, '0')}\n`
  return new Blob([MAGIC, lengthLine, headerBytes, ...books.map(b => b.file)], { type: 'application/octet-stream' })
}

export async function downloadBackup() {
  download(await createBackupBlob(), `lector-ia-${new Date().toISOString().slice(0, 10)}.lectoria`)
}

export async function restoreBackup(file: File): Promise<BookRecord[]> {
  const prefixSize = MAGIC.length + LENGTH_WIDTH + 1
  const prefix = await file.slice(0, prefixSize).text()
  if (!prefix.startsWith(MAGIC)) throw new Error('El archivo no es un respaldo válido de Lector IA.')
  const lengthText = prefix.slice(MAGIC.length, MAGIC.length + LENGTH_WIDTH)
  const headerLength = Number(lengthText)
  if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > 64 * 1024 * 1024) throw new Error('Cabecera de respaldo inválida.')

  const headerStart = prefixSize
  const header = JSON.parse(await file.slice(headerStart, headerStart + headerLength).text()) as BackupHeader
  if (![1, 2].includes(header.version) || !Array.isArray(header.books)) throw new Error('Versión de respaldo no compatible.')

  let cursor = headerStart + headerLength
  const restoredBooks: BookRecord[] = []
  for (const meta of header.books) {
    const bookBlob = file.slice(cursor, cursor + meta.fileSize, meta.fileType)
    cursor += meta.fileSize
    const { fileName: _fileName, fileSize: _fileSize, fileType: _fileType, ...record } = meta
    restoredBooks.push({ ...record, file: bookBlob, indexingStatus: 'pending', indexedAt: undefined })
  }

  await db.transaction('rw', [db.books, db.highlights, db.tutorMessages, db.tutorMemory, db.studyArtifacts, db.chunks, db.readingEvents, db.readingSessions, db.preferences], async () => {
    await db.books.bulkPut(restoredBooks)
    if (header.highlights.length) await db.highlights.bulkPut(header.highlights as any[])
    if (header.tutorMessages.length) await db.tutorMessages.bulkPut(header.tutorMessages as any[])
    if (header.tutorMemory.length) await db.tutorMemory.bulkPut(header.tutorMemory as any[])
    if (header.studyArtifacts.length) await db.studyArtifacts.bulkPut(header.studyArtifacts as any[])
    if (header.readingEvents?.length) await db.readingEvents.bulkPut(header.readingEvents as any[])
    if (header.readingSessions?.length) await db.readingSessions.bulkPut(header.readingSessions as any[])
    if (header.preferences?.length) await db.preferences.bulkPut(header.preferences as any[])
    for (const book of restoredBooks) await db.chunks.where('bookId').equals(book.id).delete()
  })
  return restoredBooks
}
