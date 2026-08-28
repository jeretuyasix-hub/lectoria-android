import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { askTutor, getAiConfig, getAiEstimatedRemaining, isAiConfigured, localTutorFallback, saveAiConfig, type AiResponseLength } from '../lib/ai'
import { db } from '../lib/db'
import { getTutorMemory, remember } from '../lib/memory'
import { recordReadingEvent } from '../lib/history'
import { retrieveContext } from '../lib/rag'
import { startSpeechRecognition, type SpeechRecognitionController } from '../lib/stt'
import { speak } from '../lib/tts'
import type { ReaderContext, TutorMessage } from '../types'

const primaryPrompts = [
  ['Explicar', 'Explícame rigurosamente este fragmento. Distingue lo explícito, lo inferido y, si lo usas, el contexto externo.'],
  ['Simplificar', 'Reformula este fragmento con lenguaje más claro sin perder contenido ni relaciones conceptuales.'],
  ['Profundizar', 'Profundiza en los presupuestos, implicaciones y relaciones conceptuales de este fragmento sin adelantar contenido no leído.'],
  ['Definir', 'Identifica y define los conceptos técnicos decisivos de este fragmento según el uso que hace el autor.']
] as const

const extraPrompts = [
  ['Ejemplo', 'Dame un ejemplo concreto que aclare este fragmento y explica exactamente qué relación representa y dónde deja de servir.'],
  ['Contexto', 'Contextualiza histórica o conceptualmente esta idea solo cuando sea necesario para comprender el pasaje seleccionado.'],
  ['Contrastar', 'Contrasta la tesis de este fragmento con una interpretación alternativa sólida e indica qué explica mejor cada una.'],
  ['Conectar', 'Relaciona este fragmento con ideas anteriores del libro que ya he leído. No uses contenido posterior.'],
  ['Traducir', 'Traduce el fragmento seleccionado al español si está en otro idioma; si ya está en español, pregunta a qué idioma quiero traducirlo.'],
  ['Socrático', 'No me des todavía la respuesta. Hazme una sola pregunta socrática breve que compruebe si comprendí este fragmento.']
] as const

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    return part
  })
}

function TutorRichText({ text }: { text: string }) {
  return <div className="tutor-rich-text">{text.split('\n').map((raw, index) => {
    const line = raw.trim()
    if (!line) return <div className="rich-gap" key={index}/>
    if (line.startsWith('### ')) return <h4 key={index}>{renderInline(line.slice(4))}</h4>
    if (line.startsWith('## ')) return <h3 key={index}>{renderInline(line.slice(3))}</h3>
    if (line.startsWith('# ')) return <h2 key={index}>{renderInline(line.slice(2))}</h2>
    if (/^[-•]\s+/.test(line)) return <div className="rich-bullet" key={index}><span>•</span><p>{renderInline(line.replace(/^[-•]\s+/, ''))}</p></div>
    const numbered = line.match(/^(\d+)[.)]\s+(.+)$/)
    if (numbered) return <div className="rich-bullet numbered" key={index}><span>{numbered[1]}.</span><p>{renderInline(numbered[2])}</p></div>
    return <p key={index}>{renderInline(line)}</p>
  })}</div>
}

export default function TutorPanel({ open, onClose, context, onConfigureAi }: { open: boolean; onClose: () => void; context: ReaderContext; onConfigureAi?: () => void }) {
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [dictationStatus, setDictationStatus] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [showSelection, setShowSelection] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  const [remaining, setRemaining] = useState(getAiEstimatedRemaining())
  const [responseLength, setResponseLength] = useState<AiResponseLength>(() => getAiConfig().responseLength)
  const recognition = useRef<SpeechRecognitionController | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void db.tutorMessages.where('bookId').equals(context.bookId).sortBy('createdAt').then(rows => setMessages(rows.slice(-40).map(r => ({ role: r.role, content: r.content }))))
  }, [context.bookId])

  useEffect(() => () => recognition.current?.stop(), [])
  useEffect(() => {
    const update = () => setRemaining(getAiEstimatedRemaining())
    window.addEventListener('lectoria-ai-usage', update)
    return () => window.removeEventListener('lectoria-ai-usage', update)
  }, [])
  useEffect(() => {
    if (open) {
      setAiReady(isAiConfigured()); setRemaining(getAiEstimatedRemaining()); setResponseLength(getAiConfig().responseLength)
      window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 80)
    }
  }, [open, messages, busy])

  function chooseLength(length: AiResponseLength) {
    const config = getAiConfig(); saveAiConfig({ ...config, responseLength: length }); setResponseLength(length)
  }

  async function send(content: string, visibleLabel?: string) {
    const trimmed = content.trim()
    if (!trimmed || busy) return
    const displayText = visibleLabel ? `${visibleLabel} este fragmento` : trimmed
    const uiUserMessage: TutorMessage = { role: 'user', content: displayText }
    const uiNext: TutorMessage[] = [...messages, uiUserMessage]
    const modelNext: TutorMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(uiNext); setInput(''); setBusy(true); setDictationStatus('')
    await db.tutorMessages.add({ bookId: context.bookId, role: 'user', content: displayText, createdAt: Date.now() })
    void recordReadingEvent(context.bookId, 'tutor_question', 'reader', { chapter: context.currentChapter, href: context.currentHref, progress: context.progress, text: displayText.slice(0, 420) })

    try {
      const [retrievedText, memoryText] = await Promise.all([
        retrieveContext(context.bookId, `${trimmed} ${context.selectedText ?? ''}`, context.progress, context.spoilerPolicy === 'strict'),
        getTutorMemory(context.bookId)
      ])
      const enriched = { ...context, retrievedText, memoryText }
      let answer: string
      try { answer = await askTutor(enriched, modelNext.slice(-12)); setAiReady(true) }
      catch (error) {
        const configured = isAiConfigured(); setAiReady(configured)
        const fallback = localTutorFallback(enriched, trimmed)
        answer = configured ? `### No se pudo completar la consulta\n\n${error instanceof Error && error.message && error.message !== 'AI_NOT_CONFIGURED' ? `**Detalle:** ${error.message}\n\n` : ''}${fallback}` : fallback
      }
      const assistantMessage: TutorMessage = { role: 'assistant', content: answer }
      setMessages([...uiNext, assistantMessage]); setRemaining(getAiEstimatedRemaining())
      await db.tutorMessages.add({ bookId: context.bookId, role: 'assistant', content: answer, createdAt: Date.now(), source: retrievedText ? 'book' : 'mixed' })
      void recordReadingEvent(context.bookId, 'tutor_answer', 'ai', { chapter: context.currentChapter, href: context.currentHref, progress: context.progress, text: answer.slice(0, 420) })
      await remember(context.bookId, 'Última pregunta', displayText.slice(0, 260))
      if (context.selectedText) await remember(context.bookId, 'Último fragmento trabajado', context.selectedText.slice(0, 520))
    } finally { setBusy(false) }
  }

  function toggleVoice() {
    if (listening) { recognition.current?.stop(); setDictationStatus('Transcribiendo…'); return }
    setDictationStatus('Escuchando… toca de nuevo para terminar')
    const controller = startSpeechRecognition(
      text => { setInput(v => v ? `${v.trim()} ${text}` : text); setDictationStatus('Dictado transcrito. Revísalo y envíalo cuando quieras.') },
      () => { setListening(false); recognition.current = null },
      message => setDictationStatus(message)
    )
    if (!controller) { setDictationStatus('El reconocimiento de voz no está disponible.'); return }
    recognition.current = controller; setListening(true)
  }

  return <AnimatePresence>{open && <>
    <motion.button className="tutor-backdrop" aria-label="Cerrar tutor" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
    <motion.aside className="tutor-panel" initial={{ y: '102%', opacity: .4 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '102%', opacity: 0 }} transition={{ type: 'spring', stiffness: 390, damping: 38 }}>
      <div className="tutor-grabber" />
      <header className="tutor-header"><div><strong>Tutor Lectoria</strong><span>Texto primero · contexto de lo leído · sin adelantos</span></div><button onClick={onClose} aria-label="Cerrar tutor">×</button></header>

      <div className={`ai-status ${aiReady ? 'connected' : 'local'}`}><span><b>{aiReady ? 'IA generativa conectada' : 'Modo local'}</b>{aiReady ? `Saldo estimado: $${remaining.toFixed(2)}` : 'Conecta la IA para explicaciones interpretativas completas.'}</span>{!aiReady && onConfigureAi && <button onClick={onConfigureAi}>Conectar IA</button>}</div>

      {context.selectedText && <section className={`selection-preview ${showSelection ? 'expanded' : ''}`}><div className="selection-preview-head"><div className="source-chip book">LIBRO</div><button onClick={() => setShowSelection(v => !v)}>{showSelection ? 'Contraer' : 'Ver fragmento'}</button></div><p>“{showSelection ? context.selectedText.slice(0, 1600) : context.selectedText.slice(0, 240)}{context.selectedText.length > (showSelection ? 1600 : 240) ? '…' : ''}”</p></section>}

      <section className="tutor-tools" aria-label="Herramientas del tutor">
        <div className="response-length-control"><span>Extensión</span><button className={responseLength === 'short' ? 'active' : ''} onClick={() => chooseLength('short')}>Corta</button><button className={responseLength === 'medium' ? 'active' : ''} onClick={() => chooseLength('medium')}>Media</button><button className={responseLength === 'long' ? 'active' : ''} onClick={() => chooseLength('long')}>Larga</button></div>
        <div className="quick-prompts primary">{primaryPrompts.map(([label, prompt]) => <button key={label} onClick={() => void send(prompt, label)} disabled={busy}>{label}</button>)}</div>
        <button className="more-tools" onClick={() => setShowMore(v => !v)}>{showMore ? 'Ocultar herramientas' : 'Más herramientas'}</button>
        <AnimatePresence>{showMore && <motion.div className="quick-prompts extras" initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}>{extraPrompts.map(([label, prompt]) => <button key={label} onClick={() => void send(prompt, label)} disabled={busy}>{label}</button>)}</motion.div>}</AnimatePresence>
      </section>

      <div className="chat-log">
        {messages.length === 0 && <div className="chat-empty"><strong>Trabaja directamente sobre el texto.</strong><span>Selecciona un fragmento y pide una explicación, simplificación o lectura más profunda.</span></div>}
        {messages.map((m, i) => <article key={i} className={`message ${m.role}`}><span className={`source-chip ${m.role === 'assistant' ? 'ai' : 'reader'}`}>{m.role === 'assistant' ? 'IA' : 'TÚ'}</span>{m.role === 'assistant' ? <TutorRichText text={m.content}/> : <p>{m.content}</p>}{m.role === 'assistant' && <button className="speak-mini" onClick={() => void speak(m.content)}>Escuchar</button>}</article>)}
        {busy && <article className="message assistant thinking"><span className="source-chip ai">IA</span><p>Analizando el pasaje, su contexto y tu historial de lectura…</p></article>}
        <div ref={endRef} />
      </div>

      {dictationStatus && <div className={`dictation-status ${listening ? 'recording' : ''}`}>{dictationStatus}</div>}
      <form className="tutor-input" onSubmit={e => { e.preventDefault(); void send(input) }}>
        <button type="button" className={listening ? 'mic active' : 'mic'} onClick={toggleVoice} aria-label={listening ? 'Terminar dictado' : 'Dictar pregunta'}>{listening ? '■' : '🎙'}</button>
        <textarea rows={1} value={input} onChange={e => setInput(e.target.value)} placeholder="Escribe o dicta tu pregunta…" />
        <button type="submit" aria-label="Enviar" disabled={!input.trim() || busy}>↑</button>
      </form>
    </motion.aside>
  </>}</AnimatePresence>
}
