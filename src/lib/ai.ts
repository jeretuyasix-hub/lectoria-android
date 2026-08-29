import type { ReaderContext, TutorMessage } from '../types'

export type AiModel = 'gpt-5.6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-sol'
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

const AI_CONFIG_KEY = 'lectoria-ai-config-v3'
const LEGACY_CONFIG_KEYS = ['lectoria-ai-config-v2', 'lectoria-ai-config-v1']
const AI_SESSION_KEY = 'lectoria-ai-session-key'
const AI_USAGE_KEY = 'lectoria-ai-usage-v1'
const DEFAULT_MODEL: AiModel = 'gpt-5.6-terra'

// Precios públicos por millón de tokens. Para una estimación conservadora,
// los tokens de entrada cacheados se contabilizan al precio normal de entrada.
const PRICES: Record<AiModel, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: .20, output: 1.20 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-sol': { input: 4, output: 20 }
}

export function getAiModelLabel(model: AiModel) {
  if (model === 'gpt-5.6-luna') return 'GPT-5.6 Luna'
  if (model === 'gpt-5.6-sol') return 'GPT-5.6 Sol'
  return 'GPT-5.6 Terra'
}

function normalizeModel(value: unknown): AiModel {
  if (value === 'gpt-5.6-luna' || value === 'gpt-5.6-terra' || value === 'gpt-5.6-sol') return value
  if (value === 'gpt-5-mini') return 'gpt-5.6-luna'
  if (value === 'gpt-5') return 'gpt-5.6-terra'
  return DEFAULT_MODEL
}

function normalizeLength(value: unknown): AiResponseLength {
  return value === 'short' || value === 'long' ? value : 'medium'
}

function migrateLegacyConfig() {
  if (localStorage.getItem(AI_CONFIG_KEY)) return
  for (const key of LEGACY_CONFIG_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const old = JSON.parse(raw) as Partial<AiConfig>
      const legacyKey = String(old.apiKey || '').trim()
      if (legacyKey && !sessionStorage.getItem(AI_SESSION_KEY)) sessionStorage.setItem(AI_SESSION_KEY, legacyKey)
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ apiKey: '', model: normalizeModel(old.model), rememberKey: false, responseLength: normalizeLength(old.responseLength) }))
      break
    } catch {}
  }
  for (const key of LEGACY_CONFIG_KEYS) localStorage.removeItem(key)
}

export function getAiConfig(): AiConfig {
  try {
    migrateLegacyConfig()
    const saved = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || '{}') as Partial<AiConfig>
    return { apiKey: sessionStorage.getItem(AI_SESSION_KEY) || '', model: normalizeModel(saved.model), rememberKey: false, responseLength: normalizeLength(saved.responseLength) }
  } catch {
    return { apiKey: sessionStorage.getItem(AI_SESSION_KEY) || '', model: DEFAULT_MODEL, rememberKey: false, responseLength: 'medium' }
  }
}

export function saveAiConfig(config: AiConfig) {
  const cleanKey = config.apiKey.trim()
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ model: normalizeModel(config.model), rememberKey: false, responseLength: normalizeLength(config.responseLength), apiKey: '' }))
  if (cleanKey) sessionStorage.setItem(AI_SESSION_KEY, cleanKey)
  else sessionStorage.removeItem(AI_SESSION_KEY)
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
  const outputTokens = Math.max(0, Number(usage.output_tokens || 0))
  const price = PRICES[model]
  const cost = (inputTokens * price.input + outputTokens * price.output) / 1_000_000
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
  return 'EXTENSIÓN: MEDIA. Explica suficientemente para comprender bien el pasaje, con 3–5 secciones o párrafos sustantivos, evitando tanto la brevedad telegráfica como la expansión innecesaria.'
}

function buildTutorInstructions(context: ReaderContext, responseLength: AiResponseLength) {
  return `Eres Tutor Lectoria, un tutor de lectura profunda en español. Tu función es aumentar la comprensión del lector sin reemplazar su lectura.

REGLAS EPISTÉMICAS
1. TEXTO PRIMERO. El fragmento seleccionado es la evidencia principal.
2. Separa con rigor: AUTOR/LIBRO, LECTOR y TU INFERENCIA. Nunca atribuyas al autor una interpretación del lector o de la IA.
3. Cuando la política sea estricta, no uses material posterior a la posición actual, aunque aparezca en la misma sección EPUB.
4. Si EXPLICAS, reconstruye la tesis, las relaciones entre conceptos y por qué importan en este pasaje.
5. Si SIMPLIFICAS, conserva las relaciones lógicas importantes.
6. Si PROFUNDIZAS, identifica presupuestos, oposiciones, consecuencias y problemas teóricos; marca lo interpretativo.
7. Si DEFINES, explica el significado de los conceptos EN ESTE PASAJE.
8. Para EJEMPLOS, explica qué relación representa el ejemplo y dónde deja de servir.
9. Si el fragmento es incompleto, dilo y trabaja solo con lo disponible.
10. Usa Markdown legible: ### para secciones, **negrita** para conceptos decisivos y listas solo cuando aclaren.
11. No repitas el fragmento completo sin necesidad.
12. ${lengthInstruction(responseLength)}

LIBRO: ${context.title} — ${context.author}
TIPO: ${context.bookType || 'no especificado'}
CAPÍTULO ACTUAL: ${context.currentChapter || 'sin etiqueta'}
PROGRESO: ${Math.round(context.progress * 100)}%
POLÍTICA DE ADELANTOS: ${context.spoilerPolicy === 'strict' ? 'estricta: exclusivamente material alcanzado' : 'permitidos cuando sean necesarios y se indiquen'}`
}

function buildTutorInput(context: ReaderContext, messages: TutorMessage[]) {
  const recent = messages.slice(-10).map(m => `${m.role === 'user' ? 'LECTOR' : 'TUTOR'}: ${clip(m.content, 1200)}`).join('\n\n')
  return `FRAGMENTO SELECCIONADO (fuente principal):\n${clip(context.selectedText, 5000) || '[No hay selección explícita]'}\n\nCONTEXTO CERCANO DE LA PÁGINA/CAPÍTULO:\n${clip(context.nearbyText, 4500) || '[No disponible]'}\n\nPASAJES ANTERIORES RECUPERADOS:\n${clip(context.retrievedText, 5200) || '[No se recuperaron pasajes adicionales]'}\n\nMEMORIA DE TRABAJO DEL LECTOR:\n${clip(context.memoryText, 2600) || '[Sin memoria relevante]'}\n\nCONVERSACIÓN RECIENTE:\n${recent || '[Primera intervención]'}\n\nResponde a la última petición centrándote en el texto y manteniendo la separación de procedencias.`
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
  if (status === 403) return 'La cuenta o el proyecto no tienen permiso para usar este modelo.'
  if (status === 404) return 'El modelo solicitado no está disponible para esta cuenta.'
  if (status === 429) return 'OpenAI está limitando temporalmente las solicitudes. Intenta de nuevo en unos segundos.'
  if (status >= 500) return 'El servicio de IA está temporalmente indisponible. Intenta de nuevo en unos minutos.'
  return detail || `OpenAI respondió ${status}.`
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController()
  const abortFromOutside = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', abortFromOutside, { once: true })
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (externalSignal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
      throw new Error('La consulta tardó demasiado y fue cancelada. Comprueba tu conexión e inténtalo de nuevo.')
    }
    throw new Error('No se pudo conectar con el servicio de IA. Comprueba tu conexión a Internet.')
  } finally {
    window.clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abortFromOutside)
  }
}

async function askOpenAI(context: ReaderContext, messages: TutorMessage[], config: AiConfig, signal?: AbortSignal) {
  const maxTokens = config.responseLength === 'short' ? 700 : config.responseLength === 'long' ? 2800 : 1500
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, instructions: buildTutorInstructions(context, config.responseLength), input: buildTutorInput(context, messages), max_output_tokens: maxTokens, store: false })
  }, 50000, signal)
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
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
    body: JSON.stringify({ model: config.model, input: 'Responde únicamente: Conexión correcta.', max_output_tokens: 30, store: false })
  }, 20000)
  if (!response.ok) {
    let detail = ''; try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(friendlyApiError(response.status, detail))
  }
  const data = await response.json(); recordResponseUsage(data, config.model)
  return extractResponseText(data) || 'Conexión correcta.'
}

export async function askTutor(context: ReaderContext, messages: TutorMessage[], options?: { signal?: AbortSignal }) {
  const config = getAiConfig()
  if (!config.apiKey) throw new Error('AI_NOT_CONFIGURED')
  return askOpenAI(context, messages, config, options?.signal)
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
  return `He recuperado el pasaje seleccionado, pero esta función necesita la IA generativa para responder de forma interpretativa. Abre **Apariencia → Tutor IA** y conecta tu proveedor.`
}
