import { getAiConfig } from './ai'

export interface SpeechRecognitionController {
  stop: () => void
}

function browserRecognition(onText: (text: string) => void, onEnd?: () => void, onError?: (message: string) => void): SpeechRecognitionController | null {
  const w = window as any
  const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!Recognition) return null
  const recognition = new Recognition()
  recognition.lang = 'es-419'
  recognition.interimResults = false
  recognition.continuous = false
  recognition.maxAlternatives = 1
  recognition.onresult = (event: any) => {
    const text = event.results?.[0]?.[0]?.transcript?.trim()
    if (text) onText(text)
  }
  recognition.onend = () => onEnd?.()
  recognition.onerror = () => { onError?.('No se pudo reconocer la voz.'); onEnd?.() }
  recognition.start()
  return { stop: () => recognition.stop() }
}

export function startSpeechRecognition(
  onText: (text: string) => void,
  onEnd?: () => void,
  onError?: (message: string) => void
): SpeechRecognitionController | null {
  const config = getAiConfig()
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && 'MediaRecorder' in window && config.apiKey)
  if (!canRecord) return browserRecognition(onText, onEnd, onError)

  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: BlobPart[] = []
  let stoppedBeforeReady = false
  let finished = false

  const finish = () => {
    if (finished) return
    finished = true
    stream?.getTracks().forEach(track => track.stop())
    onEnd?.()
  }

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (stoppedBeforeReady) { finish(); return }
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream)
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => { onError?.('No se pudo grabar el audio.'); finish() }
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
          if (blob.size < 400) { onError?.('No se detectó suficiente audio.'); return }
          const extension = blob.type.includes('mp4') ? 'm4a' : 'webm'
          const form = new FormData()
          form.append('model', 'gpt-4o-mini-transcribe')
          form.append('language', 'es')
          form.append('file', blob, `dictado.${extension}`)
          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.apiKey}` },
            body: form
          })
          if (!response.ok) throw new Error(`Transcripción no disponible (${response.status}).`)
          const data = await response.json()
          const text = String(data?.text || '').trim()
          if (text) onText(text)
          else onError?.('No pude entender el dictado.')
        } catch (error) {
          onError?.(error instanceof Error ? error.message : 'No se pudo transcribir el dictado.')
        } finally { finish() }
      }
      recorder.start(180)
    } catch {
      const fallback = browserRecognition(onText, onEnd, onError)
      if (!fallback) { onError?.('El micrófono no está disponible en este dispositivo.'); finish() }
      else recorder = null
    }
  })()

  return {
    stop: () => {
      if (!recorder) { stoppedBeforeReady = true; return }
      if (recorder.state !== 'inactive') recorder.stop()
    }
  }
}
