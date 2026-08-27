export interface SpeechRecognitionController {
  stop: () => void
}

export function startSpeechRecognition(onText: (text: string) => void, onEnd?: () => void): SpeechRecognitionController | null {
  const w = window as any
  const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!Recognition) return null

  const recognition = new Recognition()
  recognition.lang = 'es-ES'
  recognition.interimResults = false
  recognition.continuous = false
  recognition.maxAlternatives = 1
  recognition.onresult = (event: any) => {
    const text = event.results?.[0]?.[0]?.transcript?.trim()
    if (text) onText(text)
  }
  recognition.onend = () => onEnd?.()
  recognition.onerror = () => onEnd?.()
  recognition.start()
  return { stop: () => recognition.stop() }
}
