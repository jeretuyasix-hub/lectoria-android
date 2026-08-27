let currentUtterance: SpeechSynthesisUtterance | null = null

export function getSpanishVoices() {
  if (!('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices().filter(v => /^es([_-]|$)/i.test(v.lang))
}

export function speak(text: string, rate = 1, voiceName?: string, onEnd?: () => void) {
  if (!('speechSynthesis' in window) || !text.trim()) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'es-ES'
  utterance.rate = rate
  const voices = window.speechSynthesis.getVoices()
  const preferred = voiceName ? voices.find(v => v.name === voiceName) : voices.find(v => /^es([_-]|$)/i.test(v.lang))
  if (preferred) utterance.voice = preferred
  utterance.onend = () => { currentUtterance = null; onEnd?.() }
  currentUtterance = utterance
  window.speechSynthesis.speak(utterance)
}

export function pauseSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.pause()
}

export function resumeSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.resume()
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  currentUtterance = null
}

export function isSpeaking() {
  return 'speechSynthesis' in window && window.speechSynthesis.speaking
}
