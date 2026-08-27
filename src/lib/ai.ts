import type { ReaderContext, TutorMessage } from '../types'

export async function askTutor(context: ReaderContext, messages: TutorMessage[]) {
  const response = await fetch('/api/tutor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, messages })
  })

  if (!response.ok) throw new Error('No se pudo consultar al tutor')
  const data = await response.json()
  return String(data.answer ?? '')
}

function sentences(text: string) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(s => s.length > 28)
}

export function localTutorFallback(context: ReaderContext, userPrompt: string) {
  const fragment = context.selectedText?.trim() || context.nearbyText?.trim() || context.retrievedText?.trim() || ''
  if (!fragment) return 'Selecciona un fragmento o avanza en el libro para que pueda responder con contexto textual.'

  const s = sentences(fragment).slice(0, 4)
  const clean = fragment.replace(/\s+/g, ' ').slice(0, 850)
  const lower = userPrompt.toLowerCase()
  if (lower.includes('resumen') || lower.includes('prepár') || lower.includes('prepar')) {
    return `Modo local. En este tramo aparecen estas ideas: ${s.join(' ')}${s.length ? '' : clean}. Lee buscando la relación entre la afirmación principal y los conceptos que la justifican.`
  }
  if (lower.includes('ejemplo')) {
    return `Modo local. Puedo recuperar el pasaje, pero para generar un ejemplo interpretativo fiable necesitas configurar un modelo de IA. Texto de referencia: “${clean}”.`
  }
  return `Modo local: recuperé el contexto pertinente del libro, pero no hay un proveedor generativo configurado. Fragmento activo: “${clean}”. Configura el servidor para explicación, ejemplos, contraste, mapas conceptuales y tutoría socrática.`
}
