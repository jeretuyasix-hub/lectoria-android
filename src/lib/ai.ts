import type { ReaderContext, TutorMessage } from '../types'

export type AiModel = 'gpt-5-mini' | 'gpt-5'
export interface AiConfig {
  apiKey: string
  model: AiModel
  rememberKey: boolean
}

const AI_CONFIG_KEY = 'lectoria-ai-config-v2'
const AI_SESSION_KEY = 'lectoria-ai-session-key'

export function getAiConfig(): AiConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || '{}') as Partial<AiConfig>
    const sessionKey = sessionStorage.getItem(AI_SESSION_KEY) || ''
    return {
      apiKey: saved.rememberKey ? String(saved.apiKey || '') : sessionKey,
      model: saved.model === 'gpt-5' ? 'gpt-5' : 'gpt-5-mini',
      rememberKey: Boolean(saved.rememberKey)
    }
  } catch {
    return { apiKey: '', model: 'gpt-5-mini', rememberKey: false }
  }
}

export function saveAiConfig(config: AiConfig) {
  const cleanKey = config.apiKey.trim()
  if (config.rememberKey) {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ apiKey: cleanKey, model: config.model, rememberKey: true }))
    sessionStorage.removeItem(AI_SESSION_KEY)
  } else {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ apiKey: '', model: config.model, rememberKey: false }))
    if (cleanKey) sessionStorage.setItem(AI_SESSION_KEY, cleanKey)
    else sessionStorage.removeItem(AI_SESSION_KEY)
  }
}

export function clearAiConfig() {
  localStorage.removeItem(AI_CONFIG_KEY)
  sessionStorage.removeItem(AI_SESSION_KEY)
}

export function isAiConfigured() {
  return Boolean(getAiConfig().apiKey)
}

function clip(text: string | undefined, max: number) {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean
}

function buildTutorInstructions(context: ReaderContext) {
  return `Eres Tutor Lectoria, un tutor de lectura profunda en español. Tu trabajo no es resumir mecánicamente ni sustituir la lectura, sino ayudar a comprender con precisión el pasaje que el lector está trabajando.

REGLAS EPISTÉMICAS
1. TEXTO PRIMERO. El fragmento seleccionado es la evidencia principal. Analiza sus relaciones concretas, no una lista de palabras frecuentes.
2. Distingue siempre entre: (a) lo que el autor afirma o puede sostenerse directamente por el texto; (b) tu inferencia interpretativa; (c) contexto externo. No atribuyas al autor una interpretación del lector o de la IA.
3. No uses contenido posterior al progreso actual cuando la política sea estricta. No adelantes tesis, hechos narrativos ni desarrollos de capítulos futuros.
4. Si el usuario pide EXPLICAR: empieza con "En otras palabras" y reformula la tesis del pasaje; luego explica paso a paso cómo se relacionan sus conceptos; termina con "Por qué importa aquí". Evita definiciones de diccionario si no ayudan al argumento.
5. Si pide SIMPLIFICAR: conserva todas las relaciones lógicas importantes y reescribe en lenguaje más directo. No empobrezcas la tesis.
6. Si pide PROFUNDIZAR: identifica presupuestos, oposición conceptual, consecuencia y problema filosófico/teórico que está en juego. Señala qué parte es interpretación.
7. Si pide DEFINIR: define solo los conceptos decisivos y explica qué significan EN ESTE PASAJE, no solo en abstracto.
8. Para EJEMPLOS, construye uno concreto y explica exactamente qué relación del pasaje representa y dónde deja de servir.
9. Responde de forma fluida, pedagógica y específica. Evita bloques burocráticos, listas de términos sin relación y frases del tipo "configura el servidor".
10. Si la selección parece incompleta, dilo y trabaja con lo disponible sin inventar el resto.

LIBRO: ${context.title} — ${context.author}
TIPO: ${context.bookType || 'no especificado'}
CAPÍTULO ACTUAL: ${context.currentChapter || 'sin etiqueta'}
PROGRESO: ${Math.round(context.progress * 100)}%
POLÍTICA DE ADELANTOS: ${context.spoilerPolicy === 'strict' ? 'estricta: solo lo leído' : 'permitidos si son necesarios'}`
}

function buildTutorInput(context: ReaderContext, messages: TutorMessage[]) {
  const recent = messages.slice(-10).map(m => `${m.role === 'user' ? 'LECTOR' : 'TUTOR'}: ${clip(m.content, 1200)}`).join('\n\n')
  return `FRAGMENTO SELECCIONADO (fuente principal):\n${clip(context.selectedText, 5000) || '[No hay selección explícita]'}\n\nCONTEXTO CERCANO DE LA PÁGINA/CAPÍTULO:\n${clip(context.nearbyText, 4500) || '[No disponible]'}\n\nPASAJES ANTERIORES RECUPERADOS (solo contenido permitido por el progreso):\n${clip(context.retrievedText, 5000) || '[No se recuperaron pasajes adicionales]'}\n\nMEMORIA DE TRABAJO DEL LECTOR:\n${clip(context.memoryText, 2200) || '[Sin memoria relevante]'}\n\nCONVERSACIÓN RECIENTE:\n${recent || '[Primera intervención]'}\n\nResponde ahora a la última petición del lector, centrándote en el fragmento seleccionado.`
}

function extractResponseText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim()
  const parts: string[] = []
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content?.text === 'string') parts.push(content.text)
    }
  }
  return parts.join('\n').trim()
}

async function askOpenAI(context: ReaderContext, messages: TutorMessage[], config: AiConfig) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      instructions: buildTutorInstructions(context),
      input: buildTutorInput(context, messages),
      max_output_tokens: 1600,
      store: false
    })
  })
  if (!response.ok) {
    let detail = ''
    try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(detail || `OpenAI respondió ${response.status}`)
  }
  const answer = extractResponseText(await response.json())
  if (!answer) throw new Error('La IA no devolvió texto.')
  return answer
}

export async function testAiConnection(config: AiConfig) {
  if (!config.apiKey.trim()) throw new Error('Escribe una clave API.')
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
    body: JSON.stringify({ model: config.model, input: 'Responde únicamente: Conexión correcta.', max_output_tokens: 30, store: false })
  })
  if (!response.ok) {
    let detail = ''
    try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(detail || `No se pudo conectar (${response.status}).`)
  }
  return extractResponseText(await response.json()) || 'Conexión correcta.'
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
  const s = sentences(fragment)
  const central = s[0] || clip(fragment, 500)
  const lower = userPrompt.toLowerCase()
  if (lower.includes('simplifica') || lower.includes('reformula')) return `En otras palabras:\n\n${s.slice(0, 4).join(' ') || clip(fragment, 700)}\n\nEsta es una reformulación local del pasaje; para una explicación interpretativa completa conecta la IA desde Ajustes.`
  if (lower.includes('defin')) return `El pasaje gira alrededor de una afirmación concreta: “${clip(central, 360)}”. Para definir los conceptos según el uso preciso del autor —y no mediante definiciones genéricas— conecta la IA desde Ajustes.`
  if (lower.includes('profund')) return `El punto de partida es: “${clip(central, 360)}”. Una lectura más profunda debe reconstruir qué oposición organiza esta afirmación, qué presupone y qué consecuencia intenta establecer. Para hacerlo específicamente sobre este pasaje, conecta la IA desde Ajustes.`
  if (lower.includes('explica')) return `En otras palabras, el pasaje parte de esta tesis: “${clip(central, 420)}”.\n\nPuedo recuperar y organizar el texto localmente, pero el análisis interpretativo fluido requiere conectar la IA desde Ajustes.`
  return `He recuperado el pasaje seleccionado, pero esta función necesita la IA generativa para responder de forma interpretativa. Abre Aa → Tutor IA y conecta tu proveedor.`
}
