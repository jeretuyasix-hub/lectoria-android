import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { clearTutorMemory } from '../lib/memory'
import type { HighlightRecord, StudyArtifactRecord, TutorMemoryRecord, TutorMessageRecord } from '../types'

export default function NotebookPanel({ open, onClose, bookId, onNavigateHighlight, onDeleteHighlight }: { open: boolean; onClose: () => void; bookId: string; onNavigateHighlight: (cfi: string) => void; onDeleteHighlight?: (cfi:string)=>void }) {
  const [tab, setTab] = useState<'highlights' | 'conversation' | 'study' | 'memory'>('highlights')
  const [highlights, setHighlights] = useState<HighlightRecord[]>([])
  const [messages, setMessages] = useState<TutorMessageRecord[]>([])
  const [artifacts, setArtifacts] = useState<StudyArtifactRecord[]>([])
  const [memory, setMemory] = useState<TutorMemoryRecord[]>([])

  async function refresh() {
    const [h, m, a, mem] = await Promise.all([
      db.highlights.where('bookId').equals(bookId).reverse().sortBy('createdAt'),
      db.tutorMessages.where('bookId').equals(bookId).sortBy('createdAt'),
      db.studyArtifacts.where('bookId').equals(bookId).reverse().sortBy('createdAt'),
      db.tutorMemory.where('bookId').equals(bookId).reverse().sortBy('updatedAt')
    ])
    setHighlights(h); setMessages(m); setArtifacts(a); setMemory(mem)
  }

  useEffect(() => { if (open) void refresh() }, [open, bookId])

  function downloadMarkdown() {
    const body = [
      '# Cuaderno de lectura',
      '',
      '## Subrayados y notas',
      ...highlights.flatMap(h => [`### ${h.category}`, `> ${h.text}`, h.note ? `\n${h.note}` : '', '']),
      '## Material de estudio',
      ...artifacts.flatMap(a => [`### ${a.title}`, a.content, ''])
    ].join('\n')
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'cuaderno-lectoria.md'; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(()=>URL.revokeObjectURL(url),1500)
  }

  async function deleteHighlight(h:HighlightRecord){
    onDeleteHighlight?.(h.cfiRange)
    if(h.id)await db.highlights.delete(h.id)
    await refresh()
  }

  async function clearMemory(){
    if(!window.confirm('¿Borrar la memoria de este libro? Las notas y subrayados no se eliminarán.'))return
    await clearTutorMemory(bookId);await refresh()
  }

  return <AnimatePresence>{open && <motion.aside role="dialog" aria-modal="true" aria-label="Cuaderno de lectura" tabIndex={-1} className="side-panel notebook-panel" initial={{ x: '105%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 370, damping: 35 }}>
    <header className="side-header"><div><strong>Cuaderno</strong><span>Tu trabajo intelectual con el libro</span></div><button onClick={onClose} aria-label="Cerrar cuaderno">×</button></header>
    <div className="segmented four" role="tablist" aria-label="Secciones del cuaderno"><button role="tab" aria-selected={tab === 'highlights'} className={tab === 'highlights' ? 'active' : ''} onClick={() => setTab('highlights')}>Notas</button><button role="tab" aria-selected={tab === 'conversation'} className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}>Tutor</button><button role="tab" aria-selected={tab === 'study'} className={tab === 'study' ? 'active' : ''} onClick={() => setTab('study')}>Estudio</button><button role="tab" aria-selected={tab === 'memory'} className={tab === 'memory' ? 'active' : ''} onClick={() => setTab('memory')}>Memoria</button></div>
    <div className="panel-scroll">
      {tab === 'highlights' && <>{highlights.map(h => <article className="notebook-card" key={h.id}><button className="card-main" onClick={() => onNavigateHighlight(h.cfiRange)}><small>{h.category}</small><p>“{h.text}”</p>{h.note && <strong>{h.note}</strong>}</button><button className="danger-mini" aria-label={`Eliminar subrayado ${h.text.slice(0,50)}`} onClick={() => void deleteHighlight(h)}>Eliminar</button></article>)}{!highlights.length && <p className="muted">Todavía no hay subrayados.</p>}</>}
      {tab === 'conversation' && <>{messages.map(m => <article className={`notebook-card chat-${m.role}`} key={m.id}><small>{m.role === 'user' ? 'Tú' : 'Tutor'}</small><p>{m.content}</p></article>)}{!messages.length && <p className="muted">La conversación con el tutor aparecerá aquí.</p>}</>}
      {tab === 'study' && <>{artifacts.map(a => <article className="notebook-card" key={a.id}><small>{a.type}</small><strong>{a.title}</strong><p className="prewrap">{a.content}</p></article>)}{!artifacts.length && <p className="muted">Genera un cierre de capítulo, mapa o fichas desde el panel de estudio.</p>}</>}
      {tab === 'memory' && <>{memory.map(m => <article className="notebook-card" key={m.id}><strong>{m.key}</strong><p>{m.value}</p></article>)}{!memory.length && <p className="muted">El tutor aún no ha guardado memoria de este libro.</p>}<button className="secondary-action" onClick={() => void clearMemory()}>Borrar memoria del libro</button></>}
    </div>
    <footer className="panel-footer"><button onClick={downloadMarkdown}>Exportar cuaderno .md</button></footer>
  </motion.aside>}</AnimatePresence>
}
