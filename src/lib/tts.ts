import { getAiConfig, recordEstimatedAudioCost } from './ai'

let currentUtterance: SpeechSynthesisUtterance | null = null
let currentAudio: HTMLAudioElement | null = null
let currentAudioUrl = ''
let speechAbort: AbortController | null = null

export function getSpanishVoices() {
  if (!('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices().filter(v => /^es([_-]|$)/i.test(v.lang))
}

function cleanForSpeech(text: string) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-•]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitForSpeech(text: string, max = 3400) {
  const clean = cleanForSpeech(text)
  if (clean.length <= max) return clean ? [clean] : []
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const part = sentence.trim()
    if (!part) continue
    if (current && current.length + part.length + 1 > max) {
      chunks.push(current)
      current = part
    } else current = current ? `${current} ${part}` : part
  }
  if (current) chunks.push(current)
  return chunks
}

function nativeSpeak(text: string, rate = 1, voiceName?: string, onEnd?: () => void) {
  if (!('speechSynthesis' in window) || !text.trim()) return false
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(cleanForSpeech(text))
  utterance.lang = 'es-419'
  utterance.rate = rate
  const voices = window.speechSynthesis.getVoices()
  const preferred = voiceName ? voices.find(v => v.name === voiceName) : voices.find(v => /^es([_-]|$)/i.test(v.lang))
  if (preferred) utterance.voice = preferred
  utterance.onend = () => { currentUtterance = null; onEnd?.() }
  utterance.onerror = () => { currentUtterance = null; onEnd?.() }
  currentUtterance = utterance
  window.speechSynthesis.speak(utterance)
  return true
}

function clearAudioUrl(){if(currentAudioUrl){URL.revokeObjectURL(currentAudioUrl);currentAudioUrl=''}}

function playAudioBlob(blob: Blob) {
  return new Promise<void>((resolve, reject) => {
    clearAudioUrl()
    currentAudioUrl = URL.createObjectURL(blob)
    const audio = new Audio(currentAudioUrl)
    currentAudio = audio
    const cleanup=()=>{currentAudio=null;clearAudioUrl()}
    audio.onended = () => { cleanup(); resolve() }
    audio.onerror = () => { cleanup(); reject(new Error('No se pudo reproducir el audio.')) }
    void audio.play().catch(error=>{cleanup();reject(error)})
  })
}

async function fetchSpeech(url:string,init:RequestInit,controller:AbortController){
  const timer=window.setTimeout(()=>controller.abort(),30000)
  try{return await fetch(url,{...init,signal:controller.signal})}
  finally{window.clearTimeout(timer)}
}

async function openAiSpeak(text: string, rate = 1) {
  const config = getAiConfig()
  if (!config.apiKey) throw new Error('AI_NOT_CONFIGURED')
  const chunks = splitForSpeech(text)
  if (!chunks.length) return
  speechAbort?.abort()
  const controller = new AbortController()
  speechAbort = controller
  try{
    for (const chunk of chunks) {
      if (controller.signal.aborted) return
      const response = await fetchSpeech('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice: 'cedar',
          input: chunk,
          instructions: 'Habla en español latinoamericano con voz natural, clara y pedagógica. Respeta la puntuación, enfatiza conceptos importantes con moderación y evita un tono publicitario.',
          speed: Math.max(0.75, Math.min(1.5, rate))
        })
      },controller)
      if (!response.ok) throw new Error(`No se pudo generar voz (${response.status}).`)
      const blob = await response.blob()
      const estimatedMinutes = Math.max(0.05, chunk.length / 900)
      recordEstimatedAudioCost(estimatedMinutes * 0.015)
      await playAudioBlob(blob)
    }
  }finally{if(speechAbort===controller)speechAbort=null}
}

/** Voz inmediata del dispositivo. Úsala para el libro y selecciones donde la latencia importa. */
export function speakInstant(text: string, rate = 1, voiceName?: string, onEnd?: () => void) {
  if (!text.trim()) return false
  stopSpeaking()
  return nativeSpeak(text, rate, voiceName, onEnd)
}

/** Voz de mayor calidad: intenta OpenAI y cae a la voz local si falla. */
export async function speak(text: string, rate = 1, voiceName?: string, onEnd?: () => void) {
  if (!text.trim()) return
  stopSpeaking()
  const config = getAiConfig()
  if (config.apiKey) {
    try {
      await openAiSpeak(text, rate)
      onEnd?.()
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  nativeSpeak(text, rate, voiceName, onEnd)
}

export function pauseSpeaking() {
  if (currentAudio) currentAudio.pause()
  if ('speechSynthesis' in window) window.speechSynthesis.pause()
}

export function resumeSpeaking() {
  if (currentAudio) void currentAudio.play()
  if ('speechSynthesis' in window) window.speechSynthesis.resume()
}

export function stopSpeaking() {
  speechAbort?.abort(); speechAbort = null
  if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null }
  clearAudioUrl()
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  currentUtterance = null
}

export function isSpeaking() {
  return Boolean(currentAudio && !currentAudio.paused) || ('speechSynthesis' in window && window.speechSynthesis.speaking)
}
