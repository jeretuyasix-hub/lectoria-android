import type { ReaderContext, TutorMessage } from '../types'

export type AiModel = 'gpt-5-mini' | 'gpt-5'
export type AiResponseLength = 'short' | 'medium' | 'long'
export interface AiConfig {
  apiKey: string
  model: AiModel
  rememberKey: boolean
  responseLength: AiResponseLength
}

export interface AiUsageLedger {
  startingBalance: number
  spentText: number
  spentAudio: number
  requests: number
  inputTokens: number
  outputTokens: number
  updatedAt: number
}

const AI_CONFIG_KEY = 'lectoria-ai-config-v2'
const AI_SESSION_KEY = 'lectoria-ai-session-key'
const AI_USAGE_KEY = 'lectoria-ai-usage-v1'

const PRICES: Record<AiModel, { input: number; cached: number; output: number }> = {
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2 },
  'gpt-5': { input: 1.25, cached: 0.125, output: 10 }
}

export function getAiConfig(): AiConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || '{}') as Partial<AiConfig>
    const sessionKey = sessionStorage.getItem(AI_SESSION_KEY) || ''
    const responseLength: AiResponseLength = saved.responseLength === 'short' || saved.responseLength === 'long' ? saved.responseLength : 'medium'
    return {
      apiKey: saved.rememberKey ? String(saved.apiKey || '') : sessionKey,
      model: saved.model === 'gpt-5' ? 'gpt-5' : 'gpt-5-mini',
      rememberKey: Boolean(saved.rememberKey),
      responseLength
    }
  } catch {
    return { apiKey: '', model: 'gpt-5-mini', rememberKey: false, responseLength: 'medium' }
  }
}

export function saveAiConfig(config: AiConfig) {
  const cleanKey = config.apiKey.trim()
  const common = { model: config.model, rememberKey: config.rememberKey, responseLength: config.responseLength }
  if (config.rememberKey) {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ ...common, apiKey: cleanKey }))
    sessionStorage.removeItem(AI_SESSION_KEY)
  } else {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ ...common, apiKey: '' }))
    if (cleanKey) sessionStorage.setItem(AI_SESSION_KEY, cleanKey)
    else sessionStorage.removeItem(AI_SESSION_KEY)
  }
}

export function clearAiConfig() {
  const current = getAiConfig()
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ apiKey: '', model: current.model, rememberKey: false, responseLength: current.responseLength }))
  sessionStorage.removeItem(AI_SESSION_KEY)
}

export function isAiConfigured() { return Boolean(getAiConfig().apiKey) }

export function getAiUsageLedger(): AiUsageLedger {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_USAGE_KEY) || '{}') as Partial<AiUsageLedger>
    return {
      startingBalance: Number.isFinite(saved.startingBalance) ? Math.max(0, Number(saved.startingBalance)) : 5,
      spentText: Math.max(0, Number(saved.spentText || 0)),
      spentAudio: Math.max(0, Number(saved.spentAudio || 0)),
      requests: Math.max(0, Number(saved.requests || 0)),
      inputTokens: Math.max(0, Number(saved.inputTokens || 0)),
      outputTokens: Math.max(0, Number(saved.outputTokens || 0)),
      updatedAt: Number(saved.updatedAt || Date.now())
    }
  } catch {
    return { startingBalance: 5, spentText: 0, spentAudio: 0, requests: 0, inputTokens: 0, outputTokens: 0, updatedAt: Date.now() }
  }
}

function saveLedger(ledger: AiUsageLedger) {
  localStorage.setItem(AI_USAGE_KEY, JSON.stringify(ledger))
  window.dispatchEvent(new CustomEvent('lectoria-ai-usage', { detail: ledger }))
}

export function setAiStartingBalance(value: number) {
  const ledger = getAiUsageLedger()
  ledger.startingBalance = Math.max(0, Number.isFinite(value) ? value : ledger.startingBalance)
  ledger.updatedAt = Date.now(); saveLedger(ledger); return ledger
}

export function getAiEstimatedRemaining() {
  const ledger = getAiUsageLedger()
  return Math.max(0, ledger.startingBalance - ledger.spentText - ledger.spentAudio)
}

export function recordEstimatedAudioCost(cost: number) {
  if (!Number.isFinite(cost) || cost <= 0) return
  const ledger = getAiUsageLedger(); ledger.spentAudio += cost; ledger.updatedAt = Date.now(); saveLedger(ledger)
}

function recordResponseUsage(data: any, model: AiModel) {
  const usage = data?.usage
  if (!usage) return
  const inputTokens = Math.max(0, Number(usage.input_tokens || 0))
  const cachedTokens = Math.min(inputTokens, Math.max(0, Number(usage.input_tokens_details?.cached_tokens || 0)))
  const outputTokens = Math.max(0, Number(usage.output_tokens || 0))
  const price = PRICES[model]
  const cost = ((inputTokens - cachedTokens) * price.input + cachedTokens * price.cached + outputTokens * price.output) / 1_000_000
  const ledger = getAiUsageLedger()
  ledger.spentText += cost; ledger.requests += 1; ledger.inputTokens += inputTokens; ledger.outputTokens += outputTokens; ledger.updatedAt = Date.now(); saveLedger(ledger)
}

function clip(text: string | undefined, max: number) {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean
}

function lengthInstruction(length: AiResponseLength) {
  if (length === 'short') return 'EXTENSIÓN: CORTA. Ve al núcleo del problema. Aproximadamente 2–4 párrafos breves o su equivalente; omite desarrollos secundarios.'
  if (length === 'long') return 'EXTENSIÓN: LARGA. Desarrolla con profundidad, relaciones conceptuales, matices y ejemplos cuando aporten. Puede usar varias secciones, sin rellenar ni repetir.'
  return 'EXTENSIÓN: MEDIA. Explica suficientemente para comprender bien el pasaje, con 3–5 secciones o párrafos sustantivos, evitando tanto la telegráfica brevedad como la expansión innecesaria.'
}

function buildTutorInstructions(context: ReaderContext, responseLength: AiResponseLength) {
  return `Eres Tutor Lectoria, un tutor de lectura profunda en español. Tu trabajo no es resumir mecánicamente ni sustituir la lectura, sino ayudar a comprender con precisión el pasaje que el lector está trabajando.

REGLAS EPISTÉMICAS
1. TEXTO PRIMERO. El fragmento seleccionado es la evidencia principal. Analiza sus relaciones concretas, no una lista de palabras frecuentes.
2. Distingue entre: (a) lo que el autor afirma o puede sostenerse directamente por el texto; (b) tu inferencia interpretativa; (c) contexto externo. No atribuyas al autor una interpretación del lector o de la IA.
3. No uses contenido posterior al progreso actual cuando la política sea estricta.
4. Si el usuario pide EXPLICAR: abre con "### En otras palabras", reconstruye la tesis y luego muestra cómo se relacionan sus conceptos; termina con "### Por qué importa aquí" cuando sea útil.
5. Si pide SIMPLIFICAR: conserva todas las relaciones lógicas importantes y reescribe en lenguaje directo sin empobrecer la tesis.
6. Si pide PROFUNDIZAR: identifica presupuestos, oposición conceptual, consecuencia y problema teórico; señala qué parte es interpretación.
7. Si pide DEFINIR: define solo los conceptos decisivos y explica qué significan EN ESTE PASAJE.
8. Para EJEMPLOS, construye uno concreto y explica qué relación representa y dónde deja de servir.
9. Responde de forma fluida, pedagógica y específica. Evita listas de palabras sin relación y burocracia metadiscursiva.
10. Si la selección parece incompleta, dilo y trabaja con lo disponible sin inventar el resto.
11. FORMATO DIDÁCTICO: usa Markdown con ### para secciones, **negrita** para conceptos o conclusiones decisivas y *cursiva* para matices o títulos. Usa listas solo si aclaran. Evita paredes de texto.
12. No repitas innecesariamente el fragmento completo.
13. ${lengthInstruction(responseLength)}

LIBRO: ${context.title} — ${context.author}
TIPO: ${context.bookType || 'no especificado'}
CAPÍTULO ACTUAL: ${context.currentChapter || 'sin etiqueta'}
PROGRESO: ${Math.round(context.progress * 100)}%
POLÍTICA DE ADELANTOS: ${context.spoilerPolicy === 'strict' ? 'estricta: solo lo leído' : 'permitidos si son necesarios'}`
}

function buildTutorInput(context: ReaderContext, messages: TutorMessage[]) {
  const recent = messages.slice(-10).map(m => `${m.role === 'user' ? 'LECTOR' : 'TUTOR'}: ${clip(m.content, 1200)}`).join('\n\n')
  return `FRAGMENTO SELECCIONADO (fuente principal):\n${clip(context.selectedText, 5000) || '[No hay selección explícita]'}\n\nCONTEXTO CERCANO DE LA PÁGINA/CAPÍTULO:\n${clip(context.nearbyText, 4500) || '[No disponible]'}\n\nPASAJES ANTERIORES RECUPERADOS:\n${clip(context.retrievedText, 5000) || '[No se recuperaron pasajes adicionales]'}\n\nMEMORIA DE TRABAJO DEL LECTOR:\n${clip(context.memoryText, 2200) || '[Sin memoria relevante]'}\n\nCONVERSACIÓN RECIENTE:\n${recent || '[Primera intervención]'}\n\nResponde a la última petición del lector centrándote en el fragmento.`
}

function extractResponseText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim()
  const parts: string[] = []
  for (const item of data?.output || []) for (const content of item?.content || []) if ((content?.type === 'output_text' || content?.type === 'text') && typeof content?.text === 'string') parts.push(content.text)
  return parts.join('\n').trim()
}

function friendlyApiError(status: number, detail: string) {
  const lower = detail.toLowerCase()
  if (status === 429 && (lower.includes('quota') || lower.includes('billing'))) return 'La conexión funciona, pero la cuenta de API no tiene saldo disponible o alcanzó su cuota.'
  if (status === 401) return 'La clave API no es válida o fue revocada.'
  if (status === 429) return 'OpenAI está limitando temporalmente las solicitudes. Intenta de nuevo en unos segundos.'
  return detail || `OpenAI respondió ${status}.`
}

async function askOpenAI(context: ReaderContext, messages: TutorMessage[], config: AiConfig) {
  const maxTokens = config.responseLength === 'short' ? 700 : config.responseLength === 'long' ? 2600 : 1400
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, instructions: buildTutorInstructions(context, config.responseLength), input: buildTutorInput(context, messages), max_output_tokens: maxTokens, store: false })
  })
  if (!response.ok) {
    let detail = ''; try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(friendlyApiError(response.status, detail))
  }
  const data = await response.json(); recordResponseUsage(data, config.model)
  const answer = extractResponseText(data)
  if (!answer) throw new Error('La IA no devolvió texto.')
  return answer
}

export async function testAiConnection(config: AiConfig) {
  if (!config.apiKey.trim()) throw new Error('Escribe una clave API.')
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
    body: JSON.stringify({ model: config.model, input: 'Responde únicamente: Conexión correcta.', max_output_tokens: 30, store: false })
  })
  if (!response.ok) {
    let detail = ''; try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(friendlyApiError(response.status, detail))
  }
  const data = await response.json(); recordResponseUsage(data, config.model)
  return extractResponseText(data) || 'Conexión correcta.'
}

export async function askTutor(context: ReaderContext, messages: TutorMessage[]) {
  const config = getAiConfig()
  if (!config.apiKey) throw new Error('AI_NOT_CONFIGURED')
  return askOpenAI(context, messages, config)
}

function sentences(text: string) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 18)
}

export function localTutorFallback(context: ReaderContext, userPrompt: string) {
  const fragment = context.selectedText?.trim() || context.nearbyText?.trim() || context.retrievedText?.trim() || ''
  if (!fragment) return 'Selecciona un fragmento para que pueda trabajar sobre el texto concreto.'
  const s = sentences(fragment), central = s[0] || clip(fragment, 500), lower = userPrompt.toLowerCase()
  if (lower.includes('simplifica') || lower.includes('reformula')) return `### En otras palabras\n\n${s.slice(0, 4).join(' ') || clip(fragment, 700)}\n\n*Esta es una reformulación local; el análisis interpretativo completo requiere la IA conectada.*`
  if (lower.includes('defin')) return `### Conceptos\n\nEl pasaje gira alrededor de esta afirmación: **“${clip(central, 360)}”**.`
  if (lower.includes('profund')) return `### Punto de partida\n\n“${clip(central, 360)}”\n\nUna lectura más profunda debe reconstruir **qué oposición organiza esta afirmación**, qué presupone y qué consecuencia intenta establecer.`
  if (lower.includes('explica')) return `### En otras palabras\n\nEl pasaje parte de esta tesis: **“${clip(central, 420)}”**.`
  return `He recuperado el pasaje seleccionado, pero esta función necesita la IA generativa para responder de forma interpretativa. Abre **Aa → Tutor IA** y conecta tu proveedor.`
}
