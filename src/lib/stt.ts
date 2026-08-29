import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition'
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

function nativeRecognition(
  onText: (text: string) => void,
  onEnd?: () => void,
  onError?: (message: string) => void
): SpeechRecognitionController {
  let latest = ''
  let finished = false
  let ready = false
  let stopRequested = false
  const handles: Array<{ remove: () => Promise<void> }> = []

  const clean = () => { for (const handle of handles.splice(0)) void handle.remove().catch(() => undefined) }
  const finish = () => {
    if (finished) return
    finished = true
    clean()
    onEnd?.()
  }
  const emitLatestAndFinish = async () => {
    if (finished) return
    try {
      const last = await SpeechRecognition.getLastPartialResult()
      const text = String(last?.text || last?.matches?.[0] || latest || '').trim()
      if (text) onText(text)
      else if (!latest) onError?.('No escuché suficiente voz. Inténtalo de nuevo.')
    } catch {
      if (latest) onText(latest)
    } finally { finish() }
  }
  const stopNative = async () => {
    if (finished) return
    if (!ready) { stopRequested = true; return }
    try { await SpeechRecognition.forceStop({ timeout: 900 }) }
    catch { try { await SpeechRecognition.stop() } catch {} }
    window.setTimeout(() => { void emitLatestAndFinish() }, 120)
  }

  void (async () => {
    try {
      const permissions = await SpeechRecognition.requestPermissions()
      if (permissions.speechRecognition !== 'granted') throw new Error('Permiso de micrófono denegado.')
      const support = await SpeechRecognition.available()
      if (!support.available) throw new Error('El reconocimiento de voz no está disponible en este dispositivo.')
      let useOnDeviceRecognition = false
      try { useOnDeviceRecognition = (await SpeechRecognition.isOnDeviceRecognitionAvailable({ language: 'es-EC' })).available }
      catch {}

      handles.push(await SpeechRecognition.addListener('partialResults', event => {
        const text = String(event.accumulatedText || event.matches?.[0] || event.accumulated || '').trim()
        if (text) latest = text
      }))
      handles.push(await SpeechRecognition.addListener('error', event => {
        if (finished) return
        const code = String(event.code || '').toLowerCase()
        if (code.includes('no_match') || code.includes('speech_timeout')) onError?.('No escuché suficiente voz. Inténtalo de nuevo.')
        else onError?.('El reconocimiento de voz se interrumpió. Vuelve a intentarlo.')
      }))
      handles.push(await SpeechRecognition.addListener('listeningState', event => {
        if (event.status === 'stopped' || event.state === 'stopped') void emitLatestAndFinish()
      }))

      ready = true
      await SpeechRecognition.start({
        language: 'es-EC',
        maxResults: 1,
        partialResults: true,
        popup: false,
        useOnDeviceRecognition,
        allowForSilence: 1800,
        muteRecognizerBeep: true
      })
      if (stopRequested) void stopNative()
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'No se pudo iniciar el dictado.')
      finish()
    }
  })()

  return { stop: () => { void stopNative() } }
}

async function transcribeWithTimeout(form:FormData,apiKey:string){
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),30000)
  try{
    const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`},body:form,signal:controller.signal})
    if(!response.ok)throw new Error(`La transcripción no está disponible en este momento (${response.status}).`)
    return await response.json()
  }catch(error){
    if(error instanceof DOMException&&error.name==='AbortError')throw new Error('La transcripción tardó demasiado. Comprueba tu conexión e inténtalo otra vez.')
    if(error instanceof Error)throw error
    throw new Error('No se pudo conectar con el servicio de transcripción.')
  }finally{window.clearTimeout(timer)}
}

export function startSpeechRecognition(
  onText: (text: string) => void,
  onEnd?: () => void,
  onError?: (message: string) => void
): SpeechRecognitionController | null {
  if (Capacitor.isNativePlatform()) return nativeRecognition(onText, onEnd, onError)

  const config = getAiConfig()
  const canRecord = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices) && Boolean(config.apiKey)
  if (!canRecord) return browserRecognition(onText, onEnd, onError)

  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: BlobPart[] = []
  let stoppedBeforeReady = false
  let finished = false
  let fallbackController: SpeechRecognitionController | null = null

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
          const data = await transcribeWithTimeout(form,config.apiKey)
          const text = String(data?.text || '').trim()
          if (text) onText(text)
          else onError?.('No pude entender el dictado.')
        } catch (error) {
          onError?.(error instanceof Error ? error.message : 'No se pudo transcribir el dictado.')
        } finally { finish() }
      }
      recorder.start(180)
    } catch {
      fallbackController = browserRecognition(onText, onEnd, onError)
      if (!fallbackController) { onError?.('El micrófono no está disponible en este dispositivo.'); finish() }
    }
  })()

  return {
    stop: () => {
      if (fallbackController) { fallbackController.stop(); return }
      if (!recorder) { stoppedBeforeReady = true; return }
      if (recorder.state !== 'inactive') recorder.stop()
    }
  }
}
