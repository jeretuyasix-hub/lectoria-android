import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { askTutor, localTutorFallback } from '../lib/ai'
import { db } from '../lib/db'
import { getTutorMemory, remember } from '../lib/memory'
import { recordReadingEvent } from '../lib/history'
import { retrieveContext } from '../lib/rag'
import { startSpeechRecognition, type SpeechRecognitionController } from '../lib/stt'
import { speak } from '../lib/tts'
import type { ReaderContext, TutorMessage } from '../types'

const quickPrompts = [
  ['Explicar', 'Explícame rigurosamente este fragmento. Distingue lo explícito, lo inferido y, si lo usas, el contexto externo.'],
  ['Simplificar', 'Reformula este fragmento con lenguaje más claro sin perder contenido ni relaciones conceptuales.'],
  ['Profundizar', 'Profundiza en los presupuestos, implicaciones y relaciones conceptuales de este fragmento sin adelantar contenido no leído.'],
  ['Definir', 'Identifica y define los conceptos técnicos decisivos de este fragmento según el uso que hace el autor.'],
  ['Ejemplo', 'Dame un ejemplo concreto que aclare este fragmento y señala dónde deja de servir la analogía.'],
  ['Contexto', 'Contextualiza históricamente o conceptualmente esta idea solo cuando sea necesario para comprenderla.'],
  ['Contrastar', 'Contrasta esta idea con una interpretación alternativa sólida, indicando qué explica mejor cada una.'],
  ['Conectar', 'Relaciona este fragmento con ideas anteriores del libro que ya he leído.'],
  ['Traducir', 'Traduce el fragmento seleccionado al español si está en otro idioma; si ya está en español, pregunta a qué idioma quiero traducirlo.'],
  ['Socrático', 'No me des todavía la respuesta. Hazme una sola pregunta socrática breve para comprobar si comprendí este fragmento.']
] as const

export default function TutorPanel({ open, onClose, context }: { open: boolean; onClose: () => void; context: ReaderContext }) {
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const recognition = useRef<SpeechRecognitionController | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void db.tutorMessages.where('bookId').equals(context.bookId).sortBy('createdAt').then(rows => {
      setMessages(rows.slice(-40).map(r => ({ role: r.role, content: r.content })))
    })
  }, [context.bookId])

  useEffect(() => () => recognition.current?.stop(), [])
  useEffect(() => { if (open) window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 80) }, [open, messages, busy])

  async function send(content: string) {
    const trimmed = content.trim()
    if (!trimmed || busy) return
    const userMessage: TutorMessage = { role: 'user', content: trimmed }
    const next: TutorMessage[] = [...messages, userMessage]
    setMessages(next); setInput(''); setBusy(true)
    await db.tutorMessages.add({ bookId: context.bookId, role: 'user', content: trimmed, createdAt: Date.now() })
    void recordReadingEvent(context.bookId, 'tutor_question', 'reader', { chapter: context.currentChapter, href: context.currentHref, progress: context.progress, text: trimmed.slice(0, 420) })

    try {
      const [retrievedText, memoryText] = await Promise.all([
        retrieveContext(context.bookId, `${trimmed} ${context.selectedText ?? ''}`, context.progress, context.spoilerPolicy === 'strict'),
        getTutorMemory(context.bookId)
      ])
      const enriched = { ...context, retrievedText, memoryText }
      let answer: string
      try { answer = await askTutor(enriched, next.slice(-12)) }
      catch { answer = localTutorFallback(enriched, trimmed) }
      const assistantMessage: TutorMessage = { role: 'assistant', content: answer }
      setMessages([...next, assistantMessage])
      await db.tutorMessages.add({ bookId: context.bookId, role: 'assistant', content: answer, createdAt: Date.now(), source: retrievedText ? 'book' : 'mixed' })
      void recordReadingEvent(context.bookId, 'tutor_answer', 'ai', { chapter: context.currentChapter, href: context.currentHref, progress: context.progress, text: answer.slice(0, 420) })
      await remember(context.bookId, 'Última pregunta', trimmed.slice(0, 260))
      if (context.selectedText) await remember(context.bookId, 'Último fragmento trabajado', context.selectedText.slice(0, 360))
    } finally {
      setBusy(false)
    }
  }

  function toggleVoice() {
    if (listening) {
      recognition.current?.stop(); recognition.current = null; setListening(false); return
    }
    const controller = startSpeechRecognition(
      text => { setInput(text); void send(text) },
      () => { setListening(false); recognition.current = null }
    )
    if (!controller) {
      setInput(v => v || 'El reconocimiento de voz no está disponible en este dispositivo.')
      return
    }
    recognition.current = controller
    setListening(true)
  }

  const visiblePrompts = showMore ? quickPrompts : quickPrompts.slice(0, 4)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button className="tutor-backdrop" aria-label="Cerrar tutor" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside className="tutor-panel" initial={{ y: '102%', opacity: .4 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '102%', opacity: 0 }} transition={{ type: 'spring', stiffness: 390, damping: 38 }}>
            <div className="tutor-grabber" />
            <header className="tutor-header">
              <div><strong>Tutor Lectoria</strong><span>Texto primero · contexto de lo leído · sin adelantos</span></div>
              <button onClick={onClose} aria-label="Cerrar tutor">×</button>
            </header>

            {context.selectedText && <section className="selection-preview"><div className="source-chip book">LIBRO</div><p>“{context.selectedText.slice(0, 420)}{context.selectedText.length > 420 ? '…' : ''}”</p></section>}

            <section className="tutor-tools" aria-label="Herramientas del tutor">
              <div className="quick-prompts">{visiblePrompts.map(([label, prompt]) => <button key={label} onClick={() => void send(prompt)} disabled={busy}>{label}</button>)}</div>
              <button className="more-tools" onClick={() => setShowMore(v => !v)}>{showMore ? 'Menos herramientas' : 'Más herramientas'}</button>
            </section>

            <div className="chat-log">
              {messages.length === 0 && <div className="chat-empty"><strong>¿Qué quieres trabajar?</strong><span>Selecciona un fragmento o escribe una pregunta. El tutor utilizará el texto leído, tus notas y el contexto disponible sin adelantarse al libro.</span></div>}
              {messages.map((m, i) => <article key={i} className={`message ${m.role}`}><span className={`source-chip ${m.role === 'assistant' ? 'ai' : 'reader'}`}>{m.role === 'assistant' ? 'IA' : 'TÚ'}</span><p>{m.content}</p>{m.role === 'assistant' && <button className="speak-mini" onClick={() => speak(m.content)}>Escuchar</button>}</article>)}
              {busy && <article className="message assistant"><span className="source-chip ai">IA</span><p>Recuperando contexto y analizando…</p></article>}
              <div ref={endRef} />
            </div>

            <form className="tutor-input" onSubmit={e => { e.preventDefault(); void send(input) }}>
              <button type="button" className={listening ? 'mic active' : 'mic'} onClick={toggleVoice} aria-label="Dictar pregunta">{listening ? '■' : '◉'}</button>
              <textarea rows={1} value={input} onChange={e => setInput(e.target.value)} placeholder="Pregunta sobre lo que estás leyendo…" />
              <button type="submit" aria-label="Enviar" disabled={!input.trim() || busy}>↑</button>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
