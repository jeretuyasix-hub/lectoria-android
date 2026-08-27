import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { BookRecord } from '../types'

export default function BookOrganizePanel({ book, onClose, onSave, onDelete }: {
  book: BookRecord | null
  onClose: () => void
  onSave: (changes: Partial<BookRecord>) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [collection, setCollection] = useState('')
  const [tags, setTags] = useState('')
  const [status, setStatus] = useState<BookRecord['readingStatus']>('reading')
  const [favorite, setFavorite] = useState(false)

  useEffect(() => {
    if (!book) return
    setCollection(book.collection || '')
    setTags((book.tags || []).join(', '))
    setStatus(book.readingStatus || (book.progress >= .98 ? 'read' : book.progress > 0 ? 'reading' : 'queued'))
    setFavorite(Boolean(book.favorite))
  }, [book])

  return <AnimatePresence>{book && <motion.aside className="organize-sheet" initial={{ y: '105%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 370, damping: 34 }}>
    <div className="tutor-grabber"/>
    <header className="side-header"><div><strong>Organizar libro</strong><span>{book.title}</span></div><button onClick={onClose}>×</button></header>
    <div className="organize-form">
      <label><span>Estado</span><select value={status} onChange={e => setStatus(e.target.value as BookRecord['readingStatus'])}><option value="queued">Pendiente</option><option value="reading">Leyendo</option><option value="read">Leído</option></select></label>
      <label><span>Colección</span><input value={collection} onChange={e => setCollection(e.target.value)} placeholder="Ej. Filosofía, Trabajo, Literatura"/></label>
      <label><span>Etiquetas</span><input value={tags} onChange={e => setTags(e.target.value)} placeholder="marxismo, educación, pendiente…"/></label>
      <label className="toggle-row"><span>Favorito</span><input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)}/></label>
      <div className="organize-actions"><button className="danger-button" onClick={() => void onDelete()}>Eliminar libro</button><button className="primary-button" onClick={() => void onSave({ collection: collection.trim() || undefined, tags: tags.split(',').map(t => t.trim()).filter(Boolean), readingStatus: status, favorite })}>Guardar</button></div>
    </div>
  </motion.aside>}</AnimatePresence>
}
