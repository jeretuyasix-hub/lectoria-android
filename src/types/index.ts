export type ThemeMode = 'paper' | 'sepia' | 'dark' | 'oled'
export type PageMode = 'slide' | 'curl' | 'scroll'
export type FontFamilyMode = 'publisher' | 'literary' | 'modern' | 'accessible'
export type TextAlignMode = 'publisher' | 'left' | 'justify'
export type HighlightCategory = 'idea' | 'concept' | 'question' | 'quote' | 'argument' | 'evidence' | 'contradiction'
export type StudyArtifactType = 'page_preview' | 'chapter_review' | 'concept_map' | 'flashcards'
export type BookType = 'novel' | 'essay' | 'philosophy' | 'social_science' | 'science' | 'academic' | 'manual' | 'study'
export type ReadingEventType = 'session_start' | 'session_end' | 'progress' | 'chapter' | 'highlight' | 'note' | 'tutor_question' | 'tutor_answer' | 'recap'
export type ReadingSource = 'book' | 'reader' | 'ai' | 'system'

export interface BookRecord {
  id: string
  title: string
  author: string
  cover?: string
  file: Blob & { name?: string }
  fingerprint?: string
  progress: number
  cfi?: string
  addedAt: number
  lastOpenedAt: number
  indexedAt?: number
  indexingStatus?: 'pending' | 'indexing' | 'ready' | 'error'
  locations?: string
  type?: BookType
  collection?: string
  tags?: string[]
  favorite?: boolean
  readingStatus?: 'queued' | 'reading' | 'read'
}

export interface HighlightRecord {
  id?: number
  bookId: string
  cfiRange: string
  text: string
  note?: string
  category: HighlightCategory
  color?: string
  opacity?: number
  createdAt: number
}

export interface BookChunkRecord {
  id?: number
  bookId: string
  href: string
  chapterLabel: string
  spineIndex: number
  progress: number
  chunkIndex: number
  text: string
  normalized: string
}

export interface TutorContextRef {
  href: string
  chapterLabel: string
  progress: number
  excerpt: string
  score?: number
}

export interface TutorMessage {
  id?: number
  bookId?: string
  role: 'user' | 'assistant'
  content: string
  createdAt?: number
  source?: 'book' | 'reader' | 'ai' | 'external' | 'mixed'
  contextRefs?: TutorContextRef[]
}

export interface TutorMessageRecord extends TutorMessage {
  id?: number
  bookId: string
  createdAt: number
}

export interface TutorMemoryRecord {
  id?: number
  bookId: string
  key: string
  value: string
  createdAt: number
  updatedAt: number
}

export interface StudyArtifactRecord {
  id?: number
  bookId: string
  type: StudyArtifactType
  title: string
  content: string
  chapterHref?: string
  createdAt: number
}

export interface ReadingEventRecord {
  id?: number
  bookId: string
  type: ReadingEventType
  source: ReadingSource
  chapter?: string
  href?: string
  cfi?: string
  progress?: number
  text?: string
  createdAt: number
}

export interface ReadingSessionRecord {
  id?: number
  bookId: string
  startedAt: number
  endedAt?: number
  minutes: number
}

export interface PreferenceRecord {
  key: string
  value: string
  updatedAt: number
}

export interface HabitSettings {
  enabled: boolean
  dailyGoalMinutes: number
  reminderTime: string
  secondReminderTime: string
  secondReminderEnabled: boolean
  maxSessionMinutes: number
  reentryHours: number
  quietStart: string
  quietEnd: string
  motivationalNudges: boolean
  reminderText: string
}

export interface ReaderContext {
  bookId: string
  title: string
  author: string
  selectedText?: string
  nearbyText?: string
  currentChapter?: string
  currentHref?: string
  progress: number
  spoilerPolicy: 'strict' | 'allowed'
  bookType?: BookType
  retrievedText?: string
  memoryText?: string
}

export interface SearchResult {
  id?: number
  href: string
  chapterLabel: string
  progress: number
  text: string
  score: number
}

export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[]
}

export interface ReaderSettings {
  fontSize: number
  theme: ThemeMode
  pageMode: PageMode
  lineHeight: number
  margins: number
  spoilerPolicy: 'strict' | 'allowed'
  prepAudio: boolean
  ttsRate: number
  fontFamily: FontFamilyMode
  textAlign: TextAlignMode
  paragraphSpacing: boolean
}
