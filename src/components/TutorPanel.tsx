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
]

export default function TutorPanel({ open, onClose, context }: { open: boolean; onClose: () => void; context: ReaderContext }) {
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const recognition = useRef<SpeechRecognitionController | null>(null)

  useEffect(() => {
    void db.tutorMessages.where('bookId').equals(context.bookId).sortBy('createdAt').then(rows => {
      setMessages(rows.slice(-40).map(r => ({ role: r.role, content: r.content })))
    })
  }, [context.bookId])

  useEffect(() => () => recognition.current?.stop(), [])

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
      setInput(v => v || 'El reconocimiento de voz no está disponible en este navegador.')
      return
    }
    recognition.current = controller
    setListening(true)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside className="tutor-panel" initial={{ y: '105%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 34 }}>
          <div className="tutor-grabber" />
          <header className="tutor-header"><div><strong>Tutor</strong><span>Texto primero · contexto recuperado · antiespóiler</span></div><button onClick={onClose} aria-label="Cerrar tutor">×</button></header>

          {context.selectedText && <blockquote className="selection-preview">“{context.selectedText.slice(0, 300)}{context.selectedText.length > 300 ? '…' : ''}”</blockquote>}

          <div className="quick-prompts">{quickPrompts.map(([label, prompt]) => <button key={label} onClick={() => void send(prompt)}>{label}</button>)}</div>

          <div className="chat-log">
            {messages.length === 0 && <div className="chat-empty">Selecciona un pasaje o pregunta sobre lo leído. El tutor recuperará contexto del libro sin adelantarse a tu progreso.</div>}
            {messages.map((m, i) => <div key={i} className={`message ${m.role}`}><p>{m.content}</p>{m.role === 'assistant' && <button className="speak-mini" onClick={() => speak(m.content)}>Escuchar</button>}</div>)}
            {busy && <div className="message assistant"><p>Recuperando contexto y analizando…</p></div>}
          </div>

          <form className="tutor-input" onSubmit={e => { e.preventDefault(); void send(input) }}>
            <button type="button" className={listening ? 'mic active' : 'mic'} onClick={toggleVoice} aria-label="Dictar pregunta">{listening ? '■' : '◉'}</button>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Pregunta sobre lo que estás leyendo…" />
            <button type="submit" aria-label="Enviar">↑</button>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
