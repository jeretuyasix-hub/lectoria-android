import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import ePub from 'epubjs'
import { db } from '../lib/db'
import { indexBook } from '../lib/rag'
import { DEFAULT_HABIT_SETTINGS, getHabitSettings, getHabitStats, getOpeningNudge, startReminderEngine } from '../lib/habit'
import { downloadBackup, restoreBackup } from '../lib/sync'
import type { BookRecord, HabitSettings } from '../types'
import BookOrganizePanel from './BookOrganizePanel'
import HabitPanel from './HabitPanel'

function uid() { return crypto.randomUUID() }

export default function Library({ onOpen }: { onOpen: (book: BookRecord) => void }) {
  const [books, setBooks] = useState<BookRecord[]>([])
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [indexing, setIndexing] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'favorite' | 'queued' | 'reading' | 'read'>('all')
  const [editingBook, setEditingBook] = useState<BookRecord | null>(null)
  const [habitOpen, setHabitOpen] = useState(false)
  const [habitSettings, setHabitSettings] = useState<HabitSettings>(DEFAULT_HABIT_SETTINGS)
  const [habitStats, setHabitStats] = useState({ todayMinutes: 0, dailyGoalMinutes: DEFAULT_HABIT_SETTINGS.dailyGoalMinutes, progress: 0, streak: 0 })
  const [reminderBanner, setReminderBanner] = useState('')

  const refresh = async () => setBooks(await db.books.orderBy('lastOpenedAt').reverse().toArray())
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    void getHabitSettings().then(async settings => { setHabitSettings(settings); setHabitStats(await getHabitStats(settings)); const nudge = await getOpeningNudge(settings); if (nudge) setReminderBanner(nudge) })
    const onReminder = (event: Event) => setReminderBanner((event as CustomEvent<{ body: string }>).detail?.body || 'Es un buen momento para continuar leyendo.')
    window.addEventListener('lector-ia-reminder', onReminder)
    return () => window.removeEventListener('lector-ia-reminder', onReminder)
  }, [])
  useEffect(() => startReminderEngine(habitSettings), [habitSettings])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return books.filter(b => {
      const textMatch = !q || `${b.title} ${b.author} ${b.collection || ''} ${(b.tags || []).join(' ')}`.toLowerCase().includes(q)
      const inferredStatus = b.readingStatus || (b.progress >= .98 ? 'read' : b.progress > 0 ? 'reading' : 'queued')
      const filterMatch = filter === 'all' || (filter === 'favorite' ? Boolean(b.favorite) : inferredStatus === filter)
      return textMatch && filterMatch
    })
  }, [books, query, filter])

  async function importFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.epub')) return
    const arrayBuffer = await file.arrayBuffer()
    const book = ePub(arrayBuffer)
    await book.ready
    const meta = await book.loaded.metadata
    let cover: string | undefined
    try {
      const coverUrl = await book.coverUrl()
      if (coverUrl) {
        const blob = await fetch(coverUrl).then(r => r.blob())
        cover = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob)
        })
      }
    } catch { /* optional */ }

    const record: BookRecord = {
      id: uid(),
      title: meta.title || file.name.replace(/\.epub$/i, ''),
      author: meta.creator || 'Autor desconocido',
      cover,
      file,
      progress: 0,
      addedAt: Date.now(),
      lastOpenedAt: Date.now(),
      indexingStatus: 'pending',
      type: 'essay',
      readingStatus: 'queued',
      favorite: false,
    }
    await db.books.put(record)
    try { book.destroy() } catch { /* noop */ }
    await refresh()

    setIndexing(v => ({ ...v, [record.id]: 0 }))
    try {
      await indexBook(record, p => setIndexing(v => ({ ...v, [record.id]: p })))
    } finally {
      setIndexing(v => { const next = { ...v }; delete next[record.id]; return next })
      await refresh()
    }
  }

  async function importFiles(files: FileList | File[]) {
    setError('')
    for (const file of Array.from(files)) {
      try { await importFile(file) } catch (err) { setError(`No se pudo importar ${file.name}: ${err instanceof Error ? err.message : 'EPUB inválido'}`) }
    }
  }

  async function restore(file: File) {
    setError('')
    try {
      const restored = await restoreBackup(file)
      await refresh()
      for (const book of restored) {
        setIndexing(v => ({ ...v, [book.id]: 0 }))
        try { await indexBook(book, p => setIndexing(v => ({ ...v, [book.id]: p }))) }
        catch { /* the book remains readable even if indexing fails */ }
        finally { setIndexing(v => { const next = { ...v }; delete next[book.id]; return next }); await refresh() }
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo restaurar el respaldo.') }
  }


  async function importDemo() {
    setError('')
    try {
      const response = await fetch('/demo.epub')
      if (!response.ok) throw new Error('No se encontró el EPUB de demostración.')
      const blob = await response.blob()
      await importFile(new File([blob], 'demostracion-lector-ia.epub', { type: 'application/epub+zip' }))
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo abrir la demostración.') }
  }

  async function removeBook(book: BookRecord) {
    if (!window.confirm(`Eliminar “${book.title}” y sus anotaciones locales?`)) return
    await db.transaction('rw', [db.books, db.highlights, db.chunks, db.tutorMessages, db.tutorMemory, db.studyArtifacts, db.readingEvents, db.readingSessions], async () => {
      await Promise.all([
        db.books.delete(book.id),
        db.highlights.where('bookId').equals(book.id).delete(),
        db.chunks.where('bookId').equals(book.id).delete(),
        db.tutorMessages.where('bookId').equals(book.id).delete(),
        db.tutorMemory.where('bookId').equals(book.id).delete(),
        db.studyArtifacts.where('bookId').equals(book.id).delete(),
        db.readingEvents.where('bookId').equals(book.id).delete(),
        db.readingSessions.where('bookId').equals(book.id).delete()
      ])
    })
    await refresh()
  }

  return <main className="library-shell">
    <section className="library-header">
      <div><div className="eyebrow">LECTOR IA</div><h1>Tu biblioteca</h1><p>Lectura profunda, voz y tutoría contextual sin abandonar el libro.</p></div>
      <div className="library-actions"><button className="secondary-button habit-button" onClick={() => setHabitOpen(true)}>◷ Hábito</button><button className="secondary-button" onClick={() => void importDemo()}>Demo</button><button className="secondary-button" onClick={() => void downloadBackup()}>Respaldar</button><label className="secondary-button restore-button">Restaurar<input type="file" accept=".lectoria,application/octet-stream" hidden onChange={e => e.target.files?.[0] && void restore(e.target.files[0])}/></label><label className="import-button">Importar EPUB<input type="file" multiple accept=".epub,application/epub+zip" hidden onChange={e => e.target.files && void importFiles(e.target.files)} /></label></div>
    </section>

    {error && <div className="error-banner">{error}</div>}
    {reminderBanner && <div className="reading-reminder-banner"><div><strong>Momento de leer</strong><span>{reminderBanner}</span></div><button onClick={() => setReminderBanner('')}>×</button></div>}
    <section className="habit-summary" onClick={() => setHabitOpen(true)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setHabitOpen(true)}><div className="habit-ring" style={{ '--habit-progress': `${Math.round(habitStats.progress * 360)}deg` } as CSSProperties}><span>{habitStats.todayMinutes}</span></div><div><strong>{habitStats.todayMinutes} de {habitStats.dailyGoalMinutes} min hoy</strong><span>{habitStats.streak > 0 ? `🔥 ${habitStats.streak} días de continuidad` : 'Tu racha empieza cuando alcanzas tu meta.'}</span></div><button>Configurar</button></section>
    <section className="library-tools"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por título, autor, colección o etiqueta…"/><span>{books.length} {books.length === 1 ? 'libro' : 'libros'}</span></section>
    <nav className="library-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button><button className={filter === 'favorite' ? 'active' : ''} onClick={() => setFilter('favorite')}>★ Favoritos</button><button className={filter === 'reading' ? 'active' : ''} onClick={() => setFilter('reading')}>Leyendo</button><button className={filter === 'queued' ? 'active' : ''} onClick={() => setFilter('queued')}>Pendientes</button><button className={filter === 'read' ? 'active' : ''} onClick={() => setFilter('read')}>Leídos</button></nav>

    <section className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) void importFiles(e.dataTransfer.files) }}>Arrastra aquí uno o varios archivos EPUB</section>

    {books.length === 0 ? <section className="empty-state"><div className="empty-book">Aa</div><h2>Aún no hay libros</h2><p>Importa tu primer EPUB para comenzar.</p></section> : <section className="book-grid">
      {filtered.map(book => {
        const p = indexing[book.id]
        return <article key={book.id} className="book-card-wrap"><button className="book-card" onClick={() => onOpen(book)}>
          <div className="cover-wrap">{book.cover ? <img src={book.cover} alt="" className="cover" /> : <div className="cover placeholder">{book.title.slice(0, 1)}</div>}<span className={`index-badge ${book.indexingStatus ?? 'pending'}`}>{typeof p === 'number' ? `Indexando ${Math.round(p * 100)}%` : book.indexingStatus === 'ready' ? 'IA lista' : book.indexingStatus === 'error' ? 'Índice pendiente' : 'Preparando'}</span></div>
          <strong>{book.favorite ? '★ ' : ''}{book.title}</strong><span>{book.author}{book.collection ? ` · ${book.collection}` : ''}</span><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(book.progress * 100)}%` }} /></div><small>{Math.round(book.progress * 100)}% leído</small>
        </button><button className="book-menu" aria-label="Organizar libro" onClick={() => setEditingBook(book)}>•••</button></article>
      })}
    </section>}
    <BookOrganizePanel book={editingBook} onClose={() => setEditingBook(null)} onSave={async changes => { if (!editingBook) return; await db.books.update(editingBook.id, changes); setEditingBook(null); await refresh() }} onDelete={async () => { if (!editingBook) return; const target = editingBook; setEditingBook(null); await removeBook(target) }} />
    <HabitPanel open={habitOpen} onClose={() => setHabitOpen(false)} onSaved={async next => { setHabitSettings(next); setHabitStats(await getHabitStats(next)) }} />
  </main>
}
