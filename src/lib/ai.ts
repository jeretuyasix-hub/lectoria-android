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
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 18)
}

const stopwords = new Set([
  'para','como','desde','hasta','entre','sobre','bajo','ante','tras','contra','durante','mediante','hacia','según','esta','este','estos','estas','esto','esas','esos','aquello','aquella','aquellos','aquellas','pero','porque','aunque','cuando','donde','quien','cual','cuales','todo','toda','todos','todas','solo','sólo','muy','más','menos','también','además','mismo','misma','mismos','mismas','otro','otra','otros','otras','cada','algún','alguna','algunos','algunas','ningún','ninguna','ser','estar','haber','tener','hacer','puede','pueden','debe','deben','forma','modo','parte','texto','fragmento','autor','libro','una','uno','unos','unas','del','las','los','que','por','con','sin','sus','sea','son','fue','han','hay','esa','ese','así','sino','ya','se','el','la','un','al','lo','en','y','o','a','e','u','de'
])

function keyTerms(text: string, max = 6) {
  const words = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-záéíóúñü]{5,}/gi) || []
  const counts = new Map<string, number>()
  for (const raw of words) {
    const word = raw.toLowerCase()
    if (stopwords.has(word)) continue
    counts.set(word, (counts.get(word) || 0) + 1)
  }
  return [...counts.entries()].sort((a,b) => b[1] - a[1] || b[0].length - a[0].length).slice(0,max).map(([word]) => word)
}

function compact(text: string, max = 900) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean
}

function simplifiedLines(text: string) {
  const source = sentences(text).slice(0, 4)
  if (!source.length) return [compact(text, 420)]
  return source.map(sentence => sentence
    .replace(/[—–]/g, ', ')
    .replace(/\(([^)]{0,120})\)/g, '$1')
    .replace(/;\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim())
}

const glossary: Record<string, string> = {
  epistemologia: 'estudio de qué cuenta como conocimiento, cómo se justifica y cuáles son sus límites',
  idealismo: 'familia de posiciones que concede un papel constitutivo o prioritario a la mente, las ideas o las formas de conciencia en la explicación de la realidad',
  materialismo: 'familia de posiciones que explica la realidad partiendo de condiciones materiales y de procesos que no dependen de una conciencia que los constituya',
  praxis: 'actividad práctica transformadora; en tradición marxista, unidad de acción, condiciones materiales y elaboración consciente',
  dialectica: 'modo de análisis centrado en relaciones, tensiones, contradicciones y transformaciones históricas',
  alienacion: 'separación o extrañamiento respecto de la propia actividad, sus productos, otras personas o las condiciones que organizan esa actividad',
  ideologia: 'conjunto de representaciones y categorías socialmente situadas que pueden organizar la comprensión de la realidad y legitimar determinadas relaciones',
  ontologia: 'estudio de qué tipos de entidades o formas de ser se consideran reales',
  metafisica: 'investigación de los principios más generales de la realidad, su estructura y sus fundamentos',
  empirismo: 'posición que concede un papel central a la experiencia sensible en la formación y justificación del conocimiento',
  racionalismo: 'posición que concede un papel central a la razón y a estructuras conceptuales no reducibles a la experiencia inmediata',
  fenomenologia: 'tradición que describe estructuras de la experiencia y de la aparición de los fenómenos desde la perspectiva de la conciencia'
}

function defineTerms(text: string) {
  const terms = keyTerms(text, 7)
  const rows = terms.map(term => {
    const definition = glossary[term]
    return definition ? `• ${term}: ${definition}.` : `• ${term}: término relevante en el pasaje; su sentido preciso debe fijarse por el uso que hace el autor en este contexto.`
  })
  return rows.length ? rows.join('\n') : `• No pude aislar términos técnicos con suficiente seguridad en este fragmento.`
}

export function localTutorFallback(context: ReaderContext, userPrompt: string) {
  const fragment = context.selectedText?.trim() || context.nearbyText?.trim() || context.retrievedText?.trim() || ''
  if (!fragment) return 'Selecciona un fragmento o avanza en el libro para que pueda responder con contexto textual.'

  const clean = compact(fragment)
  const s = sentences(fragment)
  const terms = keyTerms(fragment)
  const lower = userPrompt.toLowerCase()
  const central = s[0] || clean
  const termLine = terms.length ? terms.join(', ') : 'los conceptos que aparecen en el pasaje'

  if (lower.includes('explícame') || lower.includes('explica')) {
    return `EXPLICACIÓN LOCAL\n\nIdea central del pasaje:\n${central}\n\nCómo está construido:\nEl fragmento articula su afirmación alrededor de ${termLine}. Conviene leerlo distinguiendo qué tesis formula, contra qué posición se dirige y qué relación establece entre esos conceptos.\n\nTexto de apoyo:\n“${clean}”`
  }

  if (lower.includes('reformula') || lower.includes('simplifica') || lower.includes('lenguaje más claro')) {
    const lines = simplifiedLines(fragment).map(x => `• ${x}`).join('\n')
    return `SIMPLIFICACIÓN LOCAL\n\nEn frases más directas:\n${lines}\n\nLa simplificación conserva el orden de las afirmaciones del pasaje; no añade contexto externo.`
  }

  if (lower.includes('profundiza') || lower.includes('presupuestos') || lower.includes('implicaciones')) {
    const second = s[1] ? `\nUna segunda afirmación importante es: ${s[1]}` : ''
    return `PROFUNDIZACIÓN LOCAL\n\nNúcleo conceptual: ${termLine}.\n\nLa pregunta de fondo que conviene hacerle al pasaje es qué tiene que aceptar previamente el autor para que la afirmación “${compact(central, 280)}” funcione como argumento.${second}\n\nPara profundizar sin adelantar el libro, revisa tres niveles: 1) qué oposición conceptual organiza el fragmento; 2) qué consecuencia se sigue si aceptamos la tesis; 3) qué cambiaría si negáramos esa premisa.`
  }

  if (lower.includes('identifica y define') || lower.includes('definir') || lower.includes('conceptos técnicos')) {
    return `CONCEPTOS DEL PASAJE\n\n${defineTerms(fragment)}\n\nLas definiciones generales sirven como orientación. El sentido decisivo debe comprobarse siempre en el uso específico que hace el autor.`
  }

  if (lower.includes('ejemplo')) {
    return `EJEMPLO — MODO LOCAL\n\nPuedo aislar la estructura del pasaje, pero no quiero inventar un ejemplo que altere su tesis. La afirmación que habría que ejemplificar es:\n“${compact(central, 360)}”\n\nÚsala como esquema: situación concreta → relación entre ${termLine} → consecuencia que muestra la tesis. Con un proveedor generativo conectado podré construir y evaluar el ejemplo completo.`
  }

  if (lower.includes('contextualiza') || lower.includes('contexto')) {
    return `CONTEXTO — MODO LOCAL\n\nEl pasaje está trabajando principalmente con ${termLine}. En modo local puedo mantenerme dentro de lo ya leído, pero no añadiré datos históricos externos que no pueda verificar aquí.\n\nDentro del texto, la referencia principal es:\n“${compact(central, 420)}”`
  }

  if (lower.includes('contrasta') || lower.includes('alternativa')) {
    return `CONTRASTE — MODO LOCAL\n\nTesis que debemos contrastar:\n“${compact(central, 360)}”\n\nContraste mínimo útil: pregunta qué explicación resultaría si se negara la prioridad que el pasaje concede a ${terms.slice(0,3).join(', ') || 'sus conceptos centrales'}. Después compara cuál de las dos posiciones explica más elementos del fragmento con menos supuestos añadidos.`
  }

  if (lower.includes('relaciona') || lower.includes('conectar') || lower.includes('ideas anteriores')) {
    const memory = compact(context.memoryText || context.retrievedText || '', 600)
    return memory
      ? `CONEXIÓN CON LO YA LEÍDO\n\nEste fragmento gira alrededor de ${termLine}. En tu contexto recuperado aparecen estas pistas para conectarlo:\n${memory}`
      : `CONEXIÓN CON LO YA LEÍDO\n\nEste fragmento gira alrededor de ${termLine}. Todavía no hay suficiente memoria recuperada para establecer una conexión fiable con pasajes anteriores sin inventarla.`
  }

  if (lower.includes('traduce')) {
    return 'TRADUCCIÓN — MODO LOCAL\n\nLa traducción fiable requiere el proveedor generativo o un motor de traducción conectado. No voy a sustituir términos técnicos automáticamente y arriesgarme a cambiar su sentido.'
  }

  if (lower.includes('socrát') || lower.includes('no me des todavía la respuesta')) {
    return `PREGUNTA SOCRÁTICA\n\nSi tuvieras que expresar en una sola frase qué relación establece este fragmento entre ${terms.slice(0,3).join(', ') || 'sus conceptos principales'}, ¿qué dirías y qué parte exacta del texto usarías como evidencia?`
  }

  if (lower.includes('resumen') || lower.includes('prepár') || lower.includes('prepar')) {
    return `RESUMEN LOCAL\n\n${s.slice(0,4).map(x => `• ${x}`).join('\n') || clean}\n\nConceptos recurrentes: ${termLine}.`
  }

  return `RESPUESTA LOCAL\n\nHe recuperado el fragmento y su contexto textual. La afirmación principal disponible es:\n“${clean}”\n\nPara una respuesta interpretativa abierta necesito el proveedor generativo; mientras tanto, puedo Explicar, Simplificar, Profundizar, Definir y formular preguntas socráticas usando solo el texto disponible.`
}
