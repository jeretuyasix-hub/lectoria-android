import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { askTutor, localTutorFallback } from '../lib/ai'
import { buildReadingDigest, getReadingTimeline, recordReadingEvent } from '../lib/history'
import { retrieveContext } from '../lib/rag'
import { speak } from '../lib/tts'
import type { BookRecord, ReaderContext, ReadingEventRecord } from '../types'

type Digest = Awaited<ReturnType<typeof buildReadingDigest>>

const sourceLabels: Record<string, string> = { book: 'Libro', reader: 'Tú', ai: 'IA', system: 'Lectura' }
const eventLabels: Record<string, string> = {
  session_start: 'Empezaste a leer', session_end: 'Terminaste una sesión', progress: 'Avanzaste', chapter: 'Entraste en un capítulo',
  highlight: 'Subrayaste', note: 'Escribiste una nota', tutor_question: 'Preguntaste al tutor', tutor_answer: 'El tutor respondió', recap: 'Revisaste tu recorrido'
}

function when(time: number) {
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(time))
}

function localRecap(digest: Digest, title: string) {
  const parts = [`Has retomado «${title}» después de ${digest.elapsed}. Vas aproximadamente por el ${digest.progress}% del libro.`]
  if (digest.lastChapter) parts.push(`La última zona registrada corresponde a “${digest.lastChapter}”.`)
  if (digest.bookEvidence[0]) parts.push(`Entre los pasajes que más marcaste aparece: “${digest.bookEvidence[0].text}”.`)
  if (digest.readerNotes[0]) parts.push(`Tu nota más reciente decía: “${digest.readerNotes[0].text}”.`)
  if (digest.questions[0]) parts.push(`Una de tus últimas preguntas fue: “${digest.questions[0].text}”.`)
  if (digest.pending[0]) parts.push(`Quedó pendiente esta duda: “${digest.pending[0]}”.`)
  return parts.join(' ')
}

export default function ReadingHistoryPanel({ open, onClose, book, context }: { open: boolean; onClose: () => void; book: BookRecord; context: ReaderContext }) {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [timeline, setTimeline] = useState<ReadingEventRecord[]>([])
  const [aiRecap, setAiRecap] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void Promise.all([buildReadingDigest(book), getReadingTimeline(book.id)]).then(([d, t]) => { setDigest(d); setTimeline(t) })
    void recordReadingEvent(book.id, 'recap', 'system', { chapter: context.currentChapter, progress: context.progress })
  }, [open, book.id])

  const recap = useMemo(() => digest ? localRecap(digest, book.title) : '', [digest, book.title])

  async function generateAiRecap() {
    if (!digest || busy) return
    setBusy(true)
    const evidence = [
      `Progreso: ${digest.progress}%`,
      `Capítulo: ${digest.lastChapter || context.currentChapter || 'sin identificar'}`,
      `Pasajes subrayados: ${digest.bookEvidence.map(x => x.text).join(' | ') || 'ninguno'}`,
      `Notas del lector: ${digest.readerNotes.map(x => x.text).join(' | ') || 'ninguna'}`,
      `Preguntas previas: ${digest.questions.map(x => x.text).join(' | ') || 'ninguna'}`,
      `Pendientes: ${digest.pending.join(' | ') || 'ninguno'}`
    ].join('\n')
    const prompt = `Haz una reentrada intelectual breve, rigurosa y sin spoilers para retomar la lectura. Distingue claramente: (1) lo que aparece en el libro, (2) lo que anotó o preguntó el lector y (3) cualquier inferencia tuya. Resume el tramo ya leído del capítulo, no el libro completo. Incluye máximo 6 puntos y una frase final sobre qué conviene observar al continuar. Evidencia del lector:\n${evidence}`
    try {
      const retrievedText = await retrieveContext(context.bookId, `ideas centrales del capítulo ${digest.lastChapter || context.currentChapter || ''} hasta la posición actual; retomar lectura`, context.progress, context.spoilerPolicy === 'strict')
      const answer = await askTutor({ ...context, memoryText: evidence, retrievedText }, [{ role: 'user', content: prompt }])
      setAiRecap(answer)
    } catch {
      setAiRecap(localTutorFallback({ ...context, memoryText: evidence }, prompt))
    } finally { setBusy(false) }
  }

  return <AnimatePresence>{open && <motion.aside className="history-panel side-panel" initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }} transition={{ type: 'spring', stiffness: 340, damping: 34 }}>
    <header className="panel-header"><div><div className="eyebrow">MEMORIA LONGITUDINAL</div><h2>Historia de lectura</h2><p>Libro, tus ideas y la IA permanecen separados.</p></div><button onClick={onClose} aria-label="Cerrar">×</button></header>
    {!digest ? <div className="panel-loading">Reconstruyendo tu recorrido…</div> : <div className="history-content">
      <section className="reentry-card">
        <span className="source-chip system">Reentrada</span><h3>Recuérdame dónde estaba</h3><p>{recap}</p>
        <div className="history-actions"><button onClick={() => speak(aiRecap || recap)}>▶ Escuchar</button><button onClick={() => void generateAiRecap()} disabled={busy}>{busy ? 'Analizando…' : 'Profundizar con IA'}</button></div>
        {aiRecap && <div className="ai-recap"><span className="source-chip ai">IA</span><p>{aiRecap}</p></div>}
      </section>

      <section><h3>Lo que te ha llamado la atención</h3><div className="interest-row">{digest.interests.length ? digest.interests.map(i => <span key={i.name}>{i.name} · {i.count}</span>) : <span>Aún no hay suficientes marcas.</span>}</div></section>

      <section className="source-section"><h3>Según el libro</h3>{digest.bookEvidence.length ? digest.bookEvidence.map((item, i) => <article key={i}><span className="source-chip book">Libro</span><p>“{item.text}”</p><small>{item.category}</small></article>) : <p className="muted">Aún no has subrayado pasajes.</p>}</section>
      <section className="source-section"><h3>Tus notas e interpretaciones</h3>{digest.readerNotes.length ? digest.readerNotes.map((item, i) => <article key={i}><span className="source-chip reader">Tú</span><p>{item.text}</p><small>Sobre: “{item.quote}”</small></article>) : <p className="muted">Aún no has escrito notas.</p>}</section>
      <section className="source-section"><h3>Preguntas que has venido trabajando</h3>{digest.questions.length ? digest.questions.map((item, i) => <article key={i}><span className="source-chip reader">Tú</span><p>{item.text}</p></article>) : <p className="muted">Todavía no hay preguntas registradas.</p>}</section>
      {digest.pending.length > 0 && <section className="pending-section"><h3>Asuntos pendientes</h3>{digest.pending.map((p, i) => <p key={i}>○ {p}</p>)}</section>}

      <section><h3>Línea temporal</h3><div className="timeline">{timeline.length ? timeline.map((event, i) => <article key={event.id ?? i} className="timeline-item"><div className="timeline-dot"/><div><div className="timeline-meta"><span className={`source-chip ${event.source}`}>{sourceLabels[event.source] || event.source}</span><time>{when(event.createdAt)}</time></div><strong>{eventLabels[event.type] || event.type}</strong>{event.chapter && <span>{event.chapter}</span>}{event.text && <p>{event.text}</p>}{typeof event.progress === 'number' && <small>{Math.round(event.progress * 100)}% del libro</small>}</div></article>) : <p className="muted">La línea temporal comenzará a crecer con tus próximas sesiones.</p>}</div></section>
    </div>}
  </motion.aside>}</AnimatePresence>
}
