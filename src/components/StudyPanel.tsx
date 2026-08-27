import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { askTutor, localTutorFallback } from '../lib/ai'
import { db } from '../lib/db'
import { getChapterText, retrieveContext } from '../lib/rag'
import type { ReaderContext, StudyArtifactType } from '../types'

const actions: Array<{ type: StudyArtifactType; label: string; title: string; prompt: string }> = [
  { type: 'chapter_review', label: 'Cerrar capítulo', title: 'Cierre de capítulo', prompt: 'Analiza únicamente el capítulo o sección actual. Produce: 1) 3–5 ideas centrales, 2) conceptos nuevos, 3) argumento principal, 4) relaciones entre conceptos, 5) una posible duda, 6) una pregunta de comprobación. Sé preciso y evita información posterior.' },
  { type: 'concept_map', label: 'Mapa conceptual', title: 'Mapa conceptual', prompt: 'Construye un mapa conceptual textual del material leído hasta aquí. Usa el formato CONCEPTO → RELACIÓN → CONCEPTO, agrupa por niveles y distingue tesis, argumentos, evidencias y objeciones cuando proceda.' },
  { type: 'flashcards', label: 'Fichas de estudio', title: 'Fichas de estudio', prompt: 'Crea entre 5 y 8 fichas de estudio solo con contenido del tramo leído. Formato: PREGUNTA: ... / RESPUESTA: ... Incluye definiciones, relaciones y una pregunta de transferencia. No inventes información.' }
]

export default function StudyPanel({ open, onClose, context }: { open: boolean; onClose: () => void; context: ReaderContext }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState('')

  async function generate(action: typeof actions[number]) {
    setBusy(action.type); setResult('')
    const chapter = (await getChapterText(context.bookId, context.currentHref, context.progress)).slice(0, 18000)
    const retrieved = await retrieveContext(context.bookId, action.prompt, context.progress, context.spoilerPolicy === 'strict')
    const enriched: ReaderContext = { ...context, nearbyText: chapter || context.nearbyText, retrievedText: retrieved }
    let answer = ''
    try { answer = await askTutor(enriched, [{ role: 'user', content: action.prompt }]) }
    catch { answer = localTutorFallback(enriched, action.prompt) }
    setResult(answer)
    await db.studyArtifacts.add({ bookId: context.bookId, type: action.type, title: action.title, content: answer, chapterHref: context.currentHref, createdAt: Date.now() })
    setBusy(null)
  }

  return <AnimatePresence>{open && <motion.aside className="study-sheet" initial={{ y: '105%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 34 }}>
    <div className="tutor-grabber"/><header className="side-header"><div><strong>Estudio</strong><span>Procesar lo leído, no sustituirlo</span></div><button onClick={onClose}>×</button></header>
    <div className="study-actions">{actions.map(a => <button key={a.type} disabled={!!busy} onClick={() => void generate(a)}>{busy === a.type ? 'Generando…' : a.label}</button>)}</div>
    <div className="study-result">{result ? <p className="prewrap">{result}</p> : <p className="muted">Elige una operación. El resultado quedará guardado en el Cuaderno.</p>}</div>
  </motion.aside>}</AnimatePresence>
}
