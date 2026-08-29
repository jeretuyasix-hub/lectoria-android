import Dexie, { type Table } from 'dexie'
import type {
  BookChunkRecord,
  BookRecord,
  HighlightRecord,
  PreferenceRecord,
  ReadingEventRecord,
  ReadingSessionRecord,
  StudyArtifactRecord,
  TutorMemoryRecord,
  TutorMessageRecord
} from '../types'

class ReaderDB extends Dexie {
  books!: Table<BookRecord, string>
  highlights!: Table<HighlightRecord, number>
  chunks!: Table<BookChunkRecord, number>
  tutorMessages!: Table<TutorMessageRecord, number>
  tutorMemory!: Table<TutorMemoryRecord, number>
  studyArtifacts!: Table<StudyArtifactRecord, number>
  readingEvents!: Table<ReadingEventRecord, number>
  readingSessions!: Table<ReadingSessionRecord, number>
  preferences!: Table<PreferenceRecord, string>

  constructor() {
    super('lector-ia-db')
    this.version(1).stores({
      books: 'id, title, author, lastOpenedAt, addedAt',
      highlights: '++id, bookId, createdAt, category'
    })
    this.version(2).stores({
      books: 'id, title, author, lastOpenedAt, addedAt, indexingStatus',
      highlights: '++id, bookId, createdAt, category',
      chunks: '++id, bookId, href, progress, [bookId+spineIndex], [bookId+progress]',
      tutorMessages: '++id, bookId, createdAt, [bookId+createdAt]',
      tutorMemory: '++id, bookId, key, [bookId+key], updatedAt',
      studyArtifacts: '++id, bookId, type, createdAt, [bookId+type]'
    })
    this.version(3).stores({
      books: 'id, title, author, lastOpenedAt, addedAt, indexingStatus',
      highlights: '++id, bookId, createdAt, category',
      chunks: '++id, bookId, href, progress, [bookId+spineIndex], [bookId+progress]',
      tutorMessages: '++id, bookId, createdAt, [bookId+createdAt]',
      tutorMemory: '++id, bookId, key, [bookId+key], updatedAt',
      studyArtifacts: '++id, bookId, type, createdAt, [bookId+type]',
      readingEvents: '++id, bookId, createdAt, type, source, [bookId+createdAt]',
      readingSessions: '++id, bookId, startedAt, endedAt, [bookId+startedAt]',
      preferences: 'key, updatedAt'
    })
    this.version(4).stores({
      books: 'id, title, author, lastOpenedAt, addedAt, indexingStatus, fingerprint',
      highlights: '++id, bookId, createdAt, category',
      chunks: '++id, bookId, href, progress, [bookId+spineIndex], [bookId+progress]',
      tutorMessages: '++id, bookId, createdAt, [bookId+createdAt]',
      tutorMemory: '++id, bookId, key, [bookId+key], updatedAt',
      studyArtifacts: '++id, bookId, type, createdAt, [bookId+type]',
      readingEvents: '++id, bookId, createdAt, type, source, [bookId+createdAt]',
      readingSessions: '++id, bookId, startedAt, endedAt, [bookId+startedAt]',
      preferences: 'key, updatedAt'
    })
  }
}

export const db = new ReaderDB()
