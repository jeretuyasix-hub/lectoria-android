import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { askTutor, getAiConfig, getAiEstimatedRemaining, getAiModelLabel, isAiConfigured, localTutorFallback, saveAiConfig, type AiResponseLength } from '../lib/ai'
import { db } from '../lib/db'
import { getTutorMemory, rememberTutorTurn } from '../lib/memory'
import { recordReadingEvent } from '../lib/history'
import { retrieveContextDetailed } from '../lib/rag'
import { startSpeechRecognition, type SpeechRecognitionController } from '../lib/stt'
import { speak, stopSpeaking } from '../lib/tts'
import type { ReaderContext, TutorContextRef, TutorMessage } from '../types'

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

type LastRequest = { content: string; label?: string }

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

function sourceLabel(source: TutorMessage['source'], role: TutorMessage['role']) {
  if (role === 'user') return 'TÚ'
  if (source === 'mixed') return 'IA + LIBRO'
  if (source === 'book') return 'LIBRO'
  if (source === 'external') return 'IA + CONTEXTO'
  return 'IA'
}

export default function TutorPanel({ open, onClose, context, onConfigureAi, onNavigateEvidence }: {
  open: boolean
  onClose: () => void
  context: ReaderContext
  onConfigureAi?: () => void
  onNavigateEvidence?: (ref: TutorContextRef) => void
}) {
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
  const [online, setOnline] = useState(() => navigator.onLine)
  const [operationStatus, setOperationStatus] = useState('')
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null)
  const recognition = useRef<SpeechRecognitionController | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const requestAbort = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    void db.tutorMessages.where('bookId').equals(context.bookId).sortBy('createdAt')
      .then(rows => setMessages(rows.slice(-60).map(row => ({ ...row }))))
      .catch(() => setMessages([]))
  }, [context.bookId])

  useEffect(() => {
    const update = () => setRemaining(getAiEstimatedRemaining())
    window.addEventListener('lectoria-ai-usage', update)
    return () => window.removeEventListener('lectoria-ai-usage', update)
  }, [])

  useEffect(() => {
    const yes = () => setOnline(true), no = () => setOnline(false)
    window.addEventListener('online', yes); window.addEventListener('offline', no)
    return () => { window.removeEventListener('online', yes); window.removeEventListener('offline', no) }
  }, [])

  useEffect(() => {
    if (open) {
      setAiReady(isAiConfigured())
      setRemaining(getAiEstimatedRemaining())
      setResponseLength(getAiConfig().responseLength)
      window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 90)
      return
    }
    recognition.current?.stop(); recognition.current = null; setListening(false)
    stopSpeaking(); requestAbort.current?.abort(); requestAbort.current = null
  }, [open])

  useEffect(() => () => { recognition.current?.stop(); requestAbort.current?.abort(); stopSpeaking() }, [])
  useEffect(() => { if (open) window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'end', behavior: busy ? 'auto' : 'smooth' }), 80) }, [open, messages, busy])

  function chooseLength(length: AiResponseLength) {
    const config = getAiConfig()
    saveAiConfig({ ...config, responseLength: length })
    setResponseLength(length)
  }

  async function safeStore(message: TutorMessage) {
    try {
      return await db.tutorMessages.add({ bookId: context.bookId, role: message.role, content: message.content, createdAt: message.createdAt || Date.now(), source: message.source, contextRefs: message.contextRefs })
    } catch { return undefined }
  }

  function cancelGeneration() {
    requestAbort.current?.abort()
    setOperationStatus('Consulta detenida. Puedes reformularla o volver a intentarlo.')
  }

  async function send(content: string, visibleLabel?: string) {
    const trimmed = content.trim()
    if (!trimmed || busy) return
    const displayText = visibleLabel ? `${visibleLabel} este fragmento` : trimmed
    const now = Date.now()
    const uiUserMessage: TutorMessage = { role: 'user', content: displayText, source: 'reader', createdAt: now }
    const uiNext = [...messages, uiUserMessage]
    const modelNext: TutorMessage[] = [...messages, { role: 'user', content: trimmed, source: 'reader', createdAt: now }]
    setMessages(uiNext); setInput(''); setBusy(true); setDictationStatus(''); setOperationStatus(''); setLastRequest({ content: trimmed, label: visibleLabel })

    const controller = new AbortController()
    requestAbort.current?.abort()
    requestAbort.current = controller
    try {
      await safeStore(uiUserMessage)
      void recordReadingEvent(context.bookId, 'tutor_question', 'reader', { chapter: context.currentChapter, href: context.currentHref, progress: context.progress, text: displayText.slice(0, 420) }).catch(() => undefined)
      const [retrievedResult, memoryResult] = await Promise.allSettled([
        retrieveContextDetailed(context.bookId, `${trimmed} ${context.selectedText ?? ''}`, context.progress, context.spoilerPolicy === 'strict', 5),
        getTutorMemory(context.bookId)
      ])
      if (controller.signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
      const retrieval = retrievedResult.status === 'fulfilled' ? retrievedResult.value : { text: '', refs: [] as TutorContextRef[] }
      const memoryText = memoryResult.status === 'fulfilled' ? memoryResult.value : ''
      const enriched: ReaderContext = { ...context, retrievedText: retrieval.text, memoryText }
      let answer: string
      let usedAi = false
      try {
        answer = await askTutor(enriched, modelNext.slice(-14), { signal: controller.signal })
        usedAi = true
        setAiReady(true)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        const configured = isAiConfigured()
        setAiReady(configured)
        const fallback = localTutorFallback(enriched, trimmed)
        answer = configured ? `### No se pudo completar la consulta\n\n${error instanceof Error && error.message && error.message !== 'AI_NOT_CONFIGURED' ? `**Detalle:** ${error.message}\n\n` : ''}${fallback}` : fallback
      }
      if (controller.signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
      const source: TutorMessage['source'] = usedAi ? (retrieval.refs.length || memoryText || context.selectedText ? 'mixed' : 'ai') : (retrieval.refs.length ? 'book' : 'ai')
      const assistantMessage: TutorMessage = { role: 'assistant', content: answer, source, contextRefs: retrieval.refs, createdAt: Date.now() }
      setMessages([...uiNext, assistantMessage]); setRemaining(getAiEstimatedRemaining()); await safeStore(assistantMessage)
      void recordReadingEvent(context.bookId, 'tutor_answer', usedAi ? 'ai' : 'system', { chapter: context.currentChapter, href: context.currentHref, progress: context.progress, text: answer.slice(0, 420) }).catch(() => undefined)
      await rememberTutorTurn(context.bookId, { chapter: context.currentChapter, task: visibleLabel || trimmed.slice(0, 80), question: displayText, selectedText: context.selectedText, progress: context.progress })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { setOperationStatus('Consulta detenida. No se guardó una respuesta incompleta.'); return }
      console.warn('Lectoria Tutor:', error)
      const message = '### No se pudo completar la operación\n\nOcurrió un problema local al preparar o guardar la consulta. **Tu lectura no se ha perdido.** Inténtalo nuevamente.'
      setMessages([...uiNext, { role: 'assistant', content: message, source: 'ai', createdAt: Date.now() }])
    } finally {
      if (requestAbort.current === controller) requestAbort.current = null
      setBusy(false)
    }
  }

  function toggleVoice() {
    if (listening) { recognition.current?.stop(); setDictationStatus('Transcribiendo…'); return }
    setDictationStatus('Escuchando… toca de nuevo para terminar')
    const controller = startSpeechRecognition(
      text => { setInput(v => v ? `${v.trim()} ${text}` : text); setDictationStatus('Dictado transcrito. Revísalo y envíalo cuando quieras.'); window.setTimeout(() => inputRef.current?.focus(), 40) },
      () => { setListening(false); recognition.current = null },
      message => setDictationStatus(message)
    )
    if (!controller) { setDictationStatus('El reconocimiento de voz no está disponible.'); return }
    recognition.current = controller; setListening(true)
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setOperationStatus('Respuesta copiada.') }
    catch { setOperationStatus('No se pudo copiar la respuesta en este dispositivo.') }
  }

  const cfg = getAiConfig(), modelLabel = getAiModelLabel(cfg.model)
  return <AnimatePresence>{open && <>
    <motion.button className="tutor-backdrop" aria-label="Cerrar tutor" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
    <motion.aside role="dialog" aria-modal="true" aria-label="Tutor Lectoria" tabIndex={-1} className="tutor-panel premium-tutor-panel" initial={{ y: '102%', opacity: .35, scale: .985 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: '102%', opacity: 0, scale: .99 }} transition={{ type: 'spring', stiffness: 410, damping: 39, mass: .82 }}>
      <div className="tutor-grabber" aria-hidden="true" />
      <header className="tutor-header"><div><strong>Tutor Lectoria</strong><span>Texto primero · evidencia visible · sin adelantos</span></div><button onClick={onClose} aria-label="Cerrar tutor">×</button></header>
      <div className="tutor-context-strip"><span className={online ? 'network-dot online' : 'network-dot'}>{online ? 'En línea' : 'Sin conexión'}</span><span>{context.currentChapter || 'Sección actual'}</span><b>{Math.round(context.progress * 100)}%</b><span className="spoiler-lock">{context.spoilerPolicy === 'strict' ? '🔒 Estricto' : 'Adelantos permitidos'}</span></div>
      <div className={`ai-status ${aiReady ? 'connected' : 'local'}`} aria-live="polite"><span><b>{aiReady ? modelLabel : 'Modo local'}</b>{aiReady ? `Saldo estimado: $${remaining.toFixed(2)}` : 'Conecta la IA para análisis interpretativo completo.'}</span>{!aiReady && onConfigureAi && <button onClick={onConfigureAi}>Conectar IA</button>}</div>

      {context.selectedText && <section className={`selection-preview ${showSelection ? 'expanded' : ''}`}><div className="selection-preview-head"><div className="source-chip book">LIBRO</div><button onClick={() => setShowSelection(v => !v)}>{showSelection ? 'Contraer' : 'Ver fragmento'}</button></div><p>“{showSelection ? context.selectedText.slice(0, 1800) : context.selectedText.slice(0, 260)}{context.selectedText.length > (showSelection ? 1800 : 260) ? '…' : ''}”</p></section>}

      <section className="tutor-tools" aria-label="Herramientas del tutor">
        <div className="response-length-control"><span>Extensión</span><button className={responseLength === 'short' ? 'active' : ''} onClick={() => chooseLength('short')}>Corta</button><button className={responseLength === 'medium' ? 'active' : ''} onClick={() => chooseLength('medium')}>Media</button><button className={responseLength === 'long' ? 'active' : ''} onClick={() => chooseLength('long')}>Larga</button></div>
        <div className="quick-prompts primary">{primaryPrompts.map(([label, prompt]) => <button key={label} onClick={() => void send(prompt, label)} disabled={busy}>{label}</button>)}</div>
        <button className="more-tools" onClick={() => setShowMore(v => !v)} aria-expanded={showMore}>{showMore ? 'Ocultar herramientas' : 'Más herramientas'}</button>
        <AnimatePresence>{showMore && <motion.div className="quick-prompts extras" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>{extraPrompts.map(([label, prompt]) => <button key={label} onClick={() => void send(prompt, label)} disabled={busy}>{label}</button>)}</motion.div>}</AnimatePresence>
      </section>

      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && <div className="chat-empty"><div className="tutor-orbit" aria-hidden="true"><i/><i/><i/></div><strong>Trabaja directamente sobre el texto.</strong><span>Selecciona un fragmento o pregunta por algo del tramo ya leído. El Tutor mostrará qué evidencia consultó.</span></div>}
        {messages.map((message, index) => <motion.article key={message.id ?? `${message.createdAt ?? 0}-${index}`} className={`message ${message.role} source-${message.source || message.role}`} initial={{ opacity: 0, y: 10, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
          <span className={`source-chip ${message.source || message.role}`}>{sourceLabel(message.source, message.role)}</span>
          {message.role === 'assistant' ? <TutorRichText text={message.content}/> : <p>{message.content}</p>}
          {message.role === 'assistant' && <>
            <div className="message-actions"><button onClick={() => void speak(message.content)}>Escuchar</button><button onClick={() => void copy(message.content)}>Copiar</button></div>
            {message.contextRefs?.length ? <div className="evidence-tray"><span>Evidencia consultada</span>{message.contextRefs.slice(0, 5).map((ref, j) => <button key={`${ref.href}-${ref.progress}-${j}`} onClick={() => onNavigateEvidence?.(ref)}><b>{ref.chapterLabel}</b><small>{Math.round(ref.progress * 100)}%</small><em>{ref.excerpt.slice(0, 120)}{ref.excerpt.length > 120 ? '…' : ''}</em></button>)}</div> : null}
          </>}
        </motion.article>)}
        {busy && <article className="message assistant thinking"><span className="source-chip ai">IA</span><div className="thinking-wave"><i/><i/><i/></div><p>Reconstruyendo el pasaje, su contexto alcanzado y tu memoria de lectura…</p><button className="stop-generation" onClick={cancelGeneration}>Detener</button></article>}
        <div ref={endRef}/>
      </div>

      {(operationStatus || dictationStatus) && <div className={`dictation-status ${listening ? 'recording' : ''}`} aria-live="polite">{dictationStatus || operationStatus}</div>}
      {!busy && lastRequest && operationStatus && <button className="retry-last" onClick={() => void send(lastRequest.content, lastRequest.label)}>↻ Reintentar última consulta</button>}
      <form className="tutor-input premium-tutor-input" onSubmit={event => { event.preventDefault(); void send(input) }}>
        <button type="button" className={listening ? 'mic active' : 'mic'} onClick={toggleVoice} aria-label={listening ? 'Terminar dictado' : 'Dictar pregunta'}>{listening ? '■' : '🎙'}</button>
        <textarea ref={inputRef} rows={1} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send(input) } }} placeholder="Pregunta sobre lo leído…" aria-label="Pregunta para el tutor"/>
        <button type="submit" aria-label="Enviar" disabled={!input.trim() || busy}>↑</button>
      </form>
    </motion.aside>
  </>}</AnimatePresence>
}
