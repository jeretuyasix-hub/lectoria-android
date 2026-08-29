import { AnimatePresence, motion } from 'framer-motion'
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
const MAX_EPUB_BYTES = 150 * 1024 * 1024
const INDEX_WORKERS = 2
type ResumeInfo = { fragment?: string; question?: string; chapter?: string; updatedAt?: number }

async function sha256(buffer: ArrayBuffer) {
  try {
    const hash = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(hash)).map(x => x.toString(16).padStart(2, '0')).join('')
  } catch { return '' }
}

export default function Library({ onOpen }: { onOpen: (book: BookRecord) => void }) {
  const [books, setBooks] = useState<BookRecord[]>([])
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [indexing, setIndexing] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'favorite' | 'queued' | 'reading' | 'read'>('all')
  const [editingBook, setEditingBook] = useState<BookRecord | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BookRecord | null>(null)
  const [habitOpen, setHabitOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [habitSettings, setHabitSettings] = useState<HabitSettings>(DEFAULT_HABIT_SETTINGS)
  const [habitStats, setHabitStats] = useState({ todayMinutes: 0, dailyGoalMinutes: DEFAULT_HABIT_SETTINGS.dailyGoalMinutes, progress: 0, streak: 0 })
  const [reminderBanner, setReminderBanner] = useState('')
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo>({})
  const [importing, setImporting] = useState(0)

  const refresh = async () => setBooks(await db.books.orderBy('lastOpenedAt').reverse().toArray())

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    void getHabitSettings().then(async settings => {
      setHabitSettings(settings)
      setHabitStats(await getHabitStats(settings))
      const nudge = await getOpeningNudge(settings)
      if (nudge) setReminderBanner(nudge)
    })
    const onReminder = (event: Event) => setReminderBanner((event as CustomEvent<{ body: string }>).detail?.body || 'Es un buen momento para continuar leyendo.')
    window.addEventListener('lector-ia-reminder', onReminder)
    return () => window.removeEventListener('lector-ia-reminder', onReminder)
  }, [])
  useEffect(() => startReminderEngine(habitSettings), [habitSettings])
  useEffect(() => {
    const closeOverlay = (event: Event | KeyboardEvent) => {
      if (pendingDelete) { setPendingDelete(null); event.preventDefault(); return }
      if (editingBook) { setEditingBook(null); event.preventDefault(); return }
      if (habitOpen) { setHabitOpen(false); event.preventDefault(); return }
      if (moreOpen) { setMoreOpen(false); event.preventDefault() }
    }
    const back = (event: Event) => closeOverlay(event)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') closeOverlay(event) }
    window.addEventListener('lectoria-back-request', back)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('lectoria-back-request', back)
      window.removeEventListener('keydown', key)
    }
  }, [pendingDelete, editingBook, habitOpen, moreOpen])

  const continueBook = useMemo(() => books.find(b => b.progress > .001 && b.progress < .985) || books[0], [books])
  useEffect(() => {
    if (!continueBook) { setResumeInfo({}); return }
    void Promise.all([
      db.tutorMemory.where('bookId').equals(continueBook.id).toArray(),
      db.readingEvents.where('bookId').equals(continueBook.id).reverse().sortBy('createdAt')
    ]).then(([memory, events]) => {
      const fragment = memory.find(m => m.key === 'Último fragmento trabajado')
      const question = memory.find(m => m.key === 'Última pregunta')
      const memoryChapter = memory.find(m => m.key === 'Último capítulo trabajado')
      const latestChapter = events.find(e => Boolean(e.chapter))
      setResumeInfo({
        fragment: fragment?.value,
        question: question?.value,
        chapter: memoryChapter?.value || latestChapter?.chapter,
        updatedAt: Math.max(fragment?.updatedAt || 0, question?.updatedAt || 0, memoryChapter?.updatedAt || 0, latestChapter?.createdAt || 0)
      })
    }).catch(() => setResumeInfo({}))
  }, [continueBook?.id])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return books.filter(book => {
      const textMatch = !q || `${book.title} ${book.author} ${book.collection || ''} ${(book.tags || []).join(' ')}`.toLowerCase().includes(q)
      const status = book.readingStatus || (book.progress >= .98 ? 'read' : book.progress > 0 ? 'reading' : 'queued')
      const filterMatch = filter === 'all' || (filter === 'favorite' ? Boolean(book.favorite) : status === filter)
      return textMatch && filterMatch
    })
  }, [books, query, filter])

  async function prepareImport(file: File) {
    if (!file.name.toLowerCase().endsWith('.epub')) throw new Error('El archivo no es un EPUB.')
    if (file.size <= 0) throw new Error('El archivo está vacío.')
    if (file.size > MAX_EPUB_BYTES) throw new Error('El EPUB supera el límite de 150 MB de esta versión.')
    const arrayBuffer = await file.arrayBuffer()
    const fingerprint = await sha256(arrayBuffer)
    let duplicate: BookRecord | undefined
    if (fingerprint) duplicate = await db.books.where('fingerprint').equals(fingerprint).first()
    if (!duplicate) duplicate = await db.books.filter(b => !b.fingerprint && b.file?.name === file.name && b.file?.size === file.size).first()
    if (duplicate) throw new Error(`Ese EPUB ya está en Lectoria como “${duplicate.title}”.`)

    const epub = ePub(arrayBuffer)
    await epub.ready
    const meta = await epub.loaded.metadata
    let cover: string | undefined
    try {
      const coverUrl = await epub.coverUrl()
      if (coverUrl) {
        const blob = await fetch(coverUrl).then(r => r.blob())
        cover = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      }
    } catch {}
    const record: BookRecord = {
      id: uid(), title: meta.title || file.name.replace(/\.epub$/i, ''), author: meta.creator || 'Autor desconocido', cover, file,
      fingerprint: fingerprint || undefined, progress: 0, addedAt: Date.now(), lastOpenedAt: Date.now(), indexingStatus: 'pending', type: 'essay', readingStatus: 'queued', favorite: false
    }
    await db.books.put(record)
    try { epub.destroy() } catch {}
    return record
  }

  async function reindex(book: BookRecord) {
    setIndexing(v => ({ ...v, [book.id]: 0 }))
    try { await indexBook(book, p => setIndexing(v => ({ ...v, [book.id]: p }))) }
    catch {
      await db.books.update(book.id, { indexingStatus: 'error' })
      setError(`No se pudo preparar el índice de “${book.title}”. El libro sigue disponible para leer.`)
    } finally {
      setIndexing(v => { const next = { ...v }; delete next[book.id]; return next })
      await refresh()
    }
  }

  async function indexQueue(records: BookRecord[]) {
    let cursor = 0
    const worker = async () => {
      while (cursor < records.length) {
        const item = records[cursor++]
        await reindex(item)
      }
    }
    await Promise.all(Array.from({ length: Math.min(INDEX_WORKERS, records.length) }, () => worker()))
  }

  async function importFiles(files: FileList | File[]) {
    setError('')
    const incoming = Array.from(files)
    if (!incoming.length) return
    setImporting(incoming.length)
    const failures: string[] = [], records: BookRecord[] = []
    try {
      for (const file of incoming) {
        try { records.push(await prepareImport(file)); await refresh() }
        catch (err) { failures.push(`${file.name}: ${err instanceof Error ? err.message : 'EPUB inválido'}`) }
        setImporting(v => Math.max(0, v - 1))
      }
      if (records.length) void indexQueue(records)
      if (failures.length) setError(failures.join(' · '))
    } finally { setImporting(0) }
  }

  async function restore(file: File) {
    setError('')
    try { const restored = await restoreBackup(file); await refresh(); void indexQueue(restored) }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo restaurar el respaldo.') }
  }

  async function removeBook(book: BookRecord) {
    await db.transaction('rw', [db.books, db.highlights, db.chunks, db.tutorMessages, db.tutorMemory, db.studyArtifacts, db.readingEvents, db.readingSessions], async () => {
      await Promise.all([
        db.books.delete(book.id), db.highlights.where('bookId').equals(book.id).delete(), db.chunks.where('bookId').equals(book.id).delete(),
        db.tutorMessages.where('bookId').equals(book.id).delete(), db.tutorMemory.where('bookId').equals(book.id).delete(), db.studyArtifacts.where('bookId').equals(book.id).delete(),
        db.readingEvents.where('bookId').equals(book.id).delete(), db.readingSessions.where('bookId').equals(book.id).delete()
      ])
    })
    setPendingDelete(null)
    await refresh()
  }

  return <main className="library-shell premium-library-shell">
    <section className="library-header redesigned" aria-labelledby="lectoria-home-title">
      <div className="library-heading"><div className="eyebrow" aria-hidden="true">LECTORIA</div><h1 id="lectoria-home-title">Lectoria</h1><p>Lee, piensa, anota y conversa con el texto.</p></div>
      <div className="library-actions-wrap">
        <div className="library-actions"><label className="import-button add-book">＋ Añadir libro<input type="file" multiple accept=".epub,application/epub+zip" hidden onChange={e => e.target.files && void importFiles(e.target.files)} /></label><button className="secondary-button more-button" onClick={() => setMoreOpen(v => !v)} aria-expanded={moreOpen}>••• <span>Más</span></button></div>
        <AnimatePresence>{moreOpen && <motion.div className="library-more-menu" initial={{ opacity: 0, y: -8, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: .97 }}><button onClick={() => { setMoreOpen(false); void downloadBackup() }}>Crear respaldo</button><label>Restaurar respaldo<input type="file" accept=".lectoria,application/octet-stream" hidden onChange={e => { setMoreOpen(false); if (e.target.files?.[0]) void restore(e.target.files[0]) }} /></label></motion.div>}</AnimatePresence>
      </div>
    </section>

    <AnimatePresence>{importing > 0 && <motion.div className="import-status" role="status" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><div className="import-pulse"><i/><i/><i/></div><span>Importando {importing} {importing === 1 ? 'libro' : 'libros'}… El índice del Tutor se preparará después.</span></motion.div>}</AnimatePresence>
    {error && <div className="error-banner" role="status">{error}<button aria-label="Cerrar aviso" onClick={() => setError('')}>×</button></div>}
    {reminderBanner && <motion.div className="reading-reminder-banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}><div><strong>Momento de leer</strong><span>{reminderBanner}</span></div><button onClick={() => setReminderBanner('')} aria-label="Cerrar recordatorio">×</button></motion.div>}

    {continueBook && <motion.section className="continue-reading-card premium-continue-card" onClick={() => onOpen(continueBook)} role="button" tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen(continueBook)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: .995 }}>
      <div className="continue-cover">{continueBook.cover ? <img src={continueBook.cover} alt="" /> : <span>{continueBook.title.slice(0, 1)}</span>}</div>
      <div className="continue-copy"><small>{continueBook.progress > .001 ? 'CONTINUAR LEYENDO' : 'EMPEZAR A LEER'}</small><strong>{continueBook.title}</strong><span>{continueBook.author}</span><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(continueBook.progress * 100)}%` }} /></div><em>{Math.round(continueBook.progress * 100)} % leído</em></div>
      <button>Continuar</button>
    </motion.section>}

    {continueBook && (resumeInfo.fragment || resumeInfo.question || resumeInfo.chapter) && <motion.section className="home-reentry-card premium-home-reentry" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="home-reentry-head"><div><small>DÓNDE ESTABAS</small><strong>Retoma el hilo antes de abrir el libro</strong></div><span>{Math.round(continueBook.progress * 100)}%</span></div>
      {resumeInfo.chapter && <p><b>Sección:</b> {resumeInfo.chapter}</p>}{resumeInfo.fragment && <blockquote>{resumeInfo.fragment}</blockquote>}{resumeInfo.question && <p className="home-reentry-question"><b>Última cuestión:</b> {resumeInfo.question}</p>}<button onClick={() => onOpen(continueBook)}>Continuar desde aquí</button>
    </motion.section>}

    <section className="habit-summary" onClick={() => setHabitOpen(true)} role="button" tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setHabitOpen(true)}>
      <div className="habit-ring" style={{ '--habit-progress': `${Math.round(habitStats.progress * 360)}deg` } as CSSProperties}><span>{habitStats.todayMinutes}</span></div><div><strong>{habitStats.todayMinutes} de {habitStats.dailyGoalMinutes} min hoy</strong><span>{habitStats.streak > 0 ? `🔥 ${habitStats.streak} días de continuidad` : 'Tu racha empieza cuando alcanzas tu meta.'}</span></div><button>Ver hábitos</button>
    </section>

    {books.length > 0 && <>
      <section className="library-tools"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar en tu biblioteca…" aria-label="Buscar en tu biblioteca"/><span>{filtered.length} de {books.length}</span></section>
      <nav className="library-filters" aria-label="Filtrar libros"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button><button className={filter === 'favorite' ? 'active' : ''} onClick={() => setFilter('favorite')}>★ Favoritos</button><button className={filter === 'reading' ? 'active' : ''} onClick={() => setFilter('reading')}>Leyendo</button><button className={filter === 'queued' ? 'active' : ''} onClick={() => setFilter('queued')}>Pendientes</button><button className={filter === 'read' ? 'active' : ''} onClick={() => setFilter('read')}>Leídos</button></nav>
      <section className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) void importFiles(e.dataTransfer.files) }}>Arrastra aquí uno o varios archivos EPUB</section>
    </>}

    {books.length === 0 ? <section className="empty-state">
      <div className="empty-book">Aa</div><h2>Aún no hay libros</h2><p>Añade un EPUB para comenzar a leer.</p><label className="import-button empty-import">＋ Añadir mi primer libro<input type="file" multiple accept=".epub,application/epub+zip" hidden onChange={e => e.target.files && void importFiles(e.target.files)} /></label>
    </section> : filtered.length === 0 ? <section className="filtered-empty">
      <div>⌕</div><h2>No hay coincidencias</h2><p>Prueba otro término o cambia el filtro.</p><button onClick={() => { setQuery(''); setFilter('all') }}>Mostrar toda la biblioteca</button>
    </section> : <motion.section className="book-grid" layout>
      {filtered.map((book, i) => {
        const p = indexing[book.id]
        const indexLabel = typeof p === 'number' ? `Indexando ${Math.round(p * 100)}%` : book.indexingStatus === 'ready' ? 'Tutor listo' : book.indexingStatus === 'error' ? 'Índice pendiente' : 'Preparando'
        return <motion.article key={book.id} className="book-card-wrap" layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(.14, i * .018) }}>
          <button className="book-card" onClick={() => onOpen(book)}>
            <div className="cover-wrap">{book.cover ? <img src={book.cover} alt="" className="cover" /> : <div className="cover placeholder">{book.title.slice(0, 1)}</div>}<span className={`index-badge ${book.indexingStatus ?? 'pending'}`}>{indexLabel}</span></div>
            <strong>{book.favorite ? '★ ' : ''}{book.title}</strong><span>{book.author}{book.collection ? ` · ${book.collection}` : ''}</span><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(book.progress * 100)}%` }} /></div><small>{Math.round(book.progress * 100)} % leído</small>
          </button>
          <div className="book-card-actions">{book.indexingStatus === 'error' && typeof p !== 'number' && <button className="reindex-button" onClick={() => void reindex(book)}>↻ Tutor</button>}<button className="book-menu" aria-label={`Organizar ${book.title}`} onClick={() => setEditingBook(book)}>•••</button></div>
        </motion.article>
      })}
    </motion.section>}

    <BookOrganizePanel book={editingBook} onClose={() => setEditingBook(null)} onSave={async changes => { if (!editingBook) return; await db.books.update(editingBook.id, changes); setEditingBook(null); await refresh() }} onDelete={async () => { if (!editingBook) return; const target = editingBook; setEditingBook(null); setPendingDelete(target) }} />
    <HabitPanel open={habitOpen} onClose={() => setHabitOpen(false)} onSaved={async next => { setHabitSettings(next); setHabitStats(await getHabitStats(next)) }} />

    <AnimatePresence>{pendingDelete && <><motion.button className="panel-backdrop delete-backdrop" aria-label="Cancelar eliminación" onClick={() => setPendingDelete(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /><motion.section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" initial={{ opacity: 0, scale: .94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 8 }} transition={{ type: 'spring', stiffness: 430, damping: 34 }}><div className="confirm-icon">!</div><h2 id="delete-title">Eliminar “{pendingDelete.title}”</h2><p>Se borrarán el EPUB local, subrayados, notas, conversaciones, memoria e historial asociados en este dispositivo.</p><div><button className="secondary-action" onClick={() => setPendingDelete(null)}>Cancelar</button><button className="danger-action" onClick={() => void removeBook(pendingDelete)}>Eliminar definitivamente</button></div></motion.section></>}</AnimatePresence>
  </main>
}
