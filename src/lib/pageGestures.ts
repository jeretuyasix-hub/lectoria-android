import html2canvas from 'html2canvas'
import { PageCurlRenderer, type CurlDirection } from './pageCurlRenderer'

type GestureState = {
  active: boolean
  blocked: boolean
  dragging: boolean
  preparing: boolean
  ready: boolean
  ended: boolean
  commitWanted: boolean
  underlyingMoved: boolean
  startX: number
  startY: number
  lastX: number
  lastY: number
  lastAt: number
  velocityX: number
  width: number
  height: number
  direction: CurlDirection
  sourceDocument: Document | null
  generation: number
}

const gesture: GestureState = {
  active: false,
  blocked: false,
  dragging: false,
  preparing: false,
  ready: false,
  ended: false,
  commitWanted: false,
  underlyingMoved: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  lastAt: 0,
  velocityX: 0,
  width: 1,
  height: 1,
  direction: 'next',
  sourceDocument: null,
  generation: 0,
}

const seenDocuments = new WeakSet<Document>()
const seenStages = new WeakSet<HTMLElement>()
const seenFrames = new WeakSet<HTMLIFrameElement>()
let renderer: PageCurlRenderer | null = null
let manualClick = false
let suppressClickUntil = 0

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const delay = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms))

function paginatedMode(): boolean {
  try {
    const settings = JSON.parse(localStorage.getItem('lectoria-settings') || '{}') as { pageMode?: string }
    return settings.pageMode !== 'scroll'
  } catch {
    return true
  }
}

function readerStage(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.reader-stage')
}

function viewer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.epub-viewer')
}

function frameForDocument(doc: Document): HTMLIFrameElement | null {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('.epub-viewer iframe')) {
    try {
      if (frame.contentDocument === doc) return frame
    } catch {
      // Ignore inaccessible frames.
    }
  }
  return null
}

function averageColorDifference(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || canvas.width < 4 || canvas.height < 4) return 0
  const stepX = Math.max(8, Math.floor(canvas.width / 28))
  const stepY = Math.max(8, Math.floor(canvas.height / 40))
  const base = ctx.getImageData(2, 2, 1, 1).data
  let samples = 0
  let different = 0
  for (let y = 2; y < canvas.height; y += stepY) {
    for (let x = 2; x < canvas.width; x += stepX) {
      const pixel = ctx.getImageData(x, y, 1, 1).data
      const delta = Math.abs(pixel[0] - base[0]) + Math.abs(pixel[1] - base[1]) + Math.abs(pixel[2] - base[2])
      if (delta > 42) different += 1
      samples += 1
    }
  }
  return samples ? different / samples : 0
}

async function captureCurrentPage(sourceDocument: Document): Promise<HTMLCanvasElement> {
  const page = viewer()
  if (!page) throw new Error('No se encontró la página visible')
  const scale = Math.min(1.45, Math.max(1, window.devicePixelRatio || 1))

  try {
    const captured = await html2canvas(page, {
      backgroundColor: getComputedStyle(page).backgroundColor || '#fbf7ed',
      logging: false,
      useCORS: true,
      allowTaint: false,
      scale,
      removeContainer: true,
    })
    if (averageColorDifference(captured) > 0.008) return captured
  } catch {
    // Fall through to direct EPUB iframe capture.
  }

  const frame = frameForDocument(sourceDocument)
  const root = sourceDocument.documentElement
  if (!frame || !root) throw new Error('No se pudo capturar el contenido EPUB')
  const width = Math.max(1, frame.clientWidth || sourceDocument.defaultView?.innerWidth || gesture.width)
  const height = Math.max(1, frame.clientHeight || sourceDocument.defaultView?.innerHeight || gesture.height)
  const view = sourceDocument.defaultView
  return html2canvas(root, {
    backgroundColor: getComputedStyle(sourceDocument.body || root).backgroundColor || '#fbf7ed',
    logging: false,
    useCORS: true,
    allowTaint: false,
    scale,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX: view?.scrollX || 0,
    scrollY: view?.scrollY || 0,
    removeContainer: true,
  })
}

function opposite(direction: CurlDirection): CurlDirection {
  return direction === 'next' ? 'prev' : 'next'
}

function clickMargin(direction: CurlDirection): void {
  const selector = direction === 'next' ? '.tap-zone.right' : '.tap-zone.left'
  const button = document.querySelector<HTMLButtonElement>(selector)
  if (!button) return
  manualClick = true
  button.click()
  manualClick = false
}

function cleanupRenderer(): void {
  renderer?.destroy()
  renderer = null
  readerStage()?.classList.remove('lectoria-curl-active')
  gesture.ready = false
  gesture.preparing = false
  gesture.underlyingMoved = false
}

async function restoreUnderlyingAndCleanup(direction: CurlDirection): Promise<void> {
  if (gesture.underlyingMoved) {
    await delay(120)
    clickMargin(opposite(direction))
    await delay(115)
  }
  cleanupRenderer()
}

async function settleGesture(): Promise<void> {
  if (!renderer || !gesture.ready) return
  const direction = gesture.direction
  if (gesture.commitWanted) {
    suppressClickUntil = performance.now() + 650
    const targetX = direction === 'next' ? -gesture.width * 1.02 : gesture.width * 2.02
    const drift = clamp((gesture.lastY - gesture.startY) * 0.16, -gesture.height * 0.12, gesture.height * 0.12)
    const targetY = clamp(gesture.lastY + drift, -gesture.height * 0.12, gesture.height * 1.12)
    const duration = clamp(255 - Math.abs(gesture.velocityX) * 105, 145, 255)
    await renderer.animateTo(targetX, targetY, duration)
    cleanupRenderer()
  } else {
    const edgeX = direction === 'next' ? gesture.width : 0
    await renderer.animateTo(edgeX, gesture.startY, 185)
    await restoreUnderlyingAndCleanup(direction)
  }
}

async function prepareCurl(generation: number): Promise<void> {
  if (gesture.preparing || gesture.ready || !gesture.sourceDocument) return
  gesture.preparing = true
  const sourceDocument = gesture.sourceDocument
  const direction = gesture.direction
  try {
    const snapshot = await captureCurrentPage(sourceDocument)
    if (generation !== gesture.generation) return
    if (gesture.ended && !gesture.commitWanted) {
      gesture.preparing = false
      return
    }
    const stage = readerStage()
    const page = viewer()
    if (!stage || !page) throw new Error('El lector dejó de estar disponible')

    stage.classList.add('lectoria-curl-active')
    renderer = new PageCurlRenderer(stage, page, snapshot, direction, gesture.startY)
    renderer.setPointer(gesture.lastX, gesture.lastY)
    clickMargin(direction)
    gesture.underlyingMoved = true
    gesture.ready = true
    gesture.preparing = false

    if (gesture.ended) void settleGesture()
  } catch (error) {
    console.warn('Lectoria: no se pudo iniciar la curvatura renderizada', error)
    gesture.preparing = false
    gesture.ready = false
    cleanupRenderer()
    if (gesture.ended && gesture.commitWanted) clickMargin(direction)
  }
}

function toggleReaderControls(): void {
  document.querySelector<HTMLElement>('.reader-shell')?.click()
}

function localTouch(touch: Touch, sourceDocument: Document): { x: number; y: number } {
  if (sourceDocument === document) {
    const rect = viewer()?.getBoundingClientRect()
    if (rect) return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
  }
  return { x: touch.clientX, y: touch.clientY }
}

function resetGesture(): void {
  gesture.active = false
  gesture.blocked = false
  gesture.dragging = false
  gesture.preparing = false
  gesture.ready = false
  gesture.ended = false
  gesture.commitWanted = false
  gesture.underlyingMoved = false
  gesture.sourceDocument = null
}

function startGesture(event: Event, sourceDocument: Document): void {
  if (!paginatedMode() || renderer) return
  const e = event as TouchEvent
  if (e.touches.length !== 1) return
  const target = e.target as Element | null
  if (target?.closest('input,textarea,select,button')) return
  const touch = e.touches[0]
  const rect = viewer()?.getBoundingClientRect()
  const point = localTouch(touch, sourceDocument)

  gesture.generation += 1
  gesture.active = true
  gesture.blocked = false
  gesture.dragging = false
  gesture.preparing = false
  gesture.ready = false
  gesture.ended = false
  gesture.commitWanted = false
  gesture.underlyingMoved = false
  gesture.startX = point.x
  gesture.startY = point.y
  gesture.lastX = point.x
  gesture.lastY = point.y
  gesture.lastAt = performance.now()
  gesture.velocityX = 0
  gesture.width = Math.max(1, sourceDocument === document ? rect?.width || window.innerWidth : sourceDocument.defaultView?.innerWidth || window.innerWidth)
  gesture.height = Math.max(1, sourceDocument === document ? rect?.height || window.innerHeight : sourceDocument.defaultView?.innerHeight || window.innerHeight)
  gesture.direction = 'next'
  gesture.sourceDocument = sourceDocument
}

function moveGesture(event: Event): void {
  if (!gesture.active || gesture.blocked || !gesture.sourceDocument) return
  const e = event as TouchEvent
  if (e.touches.length !== 1) return
  const point = localTouch(e.touches[0], gesture.sourceDocument)
  const dx = point.x - gesture.startX
  const dy = point.y - gesture.startY
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  if (!gesture.dragging) {
    if (absX < 7 && absY < 7) return
    if (absY > absX * 1.18) {
      gesture.blocked = true
      return
    }
    if (absX <= absY) return
    gesture.dragging = true
    gesture.direction = dx < 0 ? 'next' : 'prev'
    void prepareCurl(gesture.generation)
  }

  if (e.cancelable) e.preventDefault()
  const now = performance.now()
  const elapsed = Math.max(1, now - gesture.lastAt)
  gesture.velocityX = (point.x - gesture.lastX) / elapsed
  gesture.lastX = point.x
  gesture.lastY = point.y
  gesture.lastAt = now
  renderer?.setPointer(point.x, point.y)
}

function endGesture(event: Event): void {
  if (!gesture.active) return
  const e = event as TouchEvent
  const sourceDocument = gesture.sourceDocument
  const touch = e.changedTouches[0]
  if (touch && sourceDocument) {
    const point = localTouch(touch, sourceDocument)
    const now = performance.now()
    const elapsed = Math.max(1, now - gesture.lastAt)
    gesture.velocityX = (point.x - gesture.lastX) / elapsed
    gesture.lastX = point.x
    gesture.lastY = point.y
    gesture.lastAt = now
    renderer?.setPointer(point.x, point.y)
  }

  const wasDragging = gesture.dragging
  const wasBlocked = gesture.blocked
  const dx = gesture.lastX - gesture.startX
  const dy = gesture.lastY - gesture.startY
  const distance = Math.abs(dx)
  const target = e.target as Element | null
  gesture.active = false

  if (wasBlocked) {
    resetGesture()
    return
  }

  if (!wasDragging) {
    if (sourceDocument && sourceDocument !== document && distance < 9 && Math.abs(dy) < 9) {
      const selection = sourceDocument.defaultView?.getSelection()?.toString().trim() || ''
      if (!selection && !target?.closest('a,input,textarea,button,select')) {
        if (gesture.startX > gesture.width * 0.82) clickMargin('next')
        else if (gesture.startX < gesture.width * 0.18) clickMargin('prev')
        else toggleReaderControls()
      }
    }
    resetGesture()
    return
  }

  if (e.cancelable) e.preventDefault()
  const threshold = Math.min(150, gesture.width * 0.20)
  const fastFlick = Math.abs(gesture.velocityX) >= 0.52 && distance >= 30
  gesture.commitWanted = distance >= threshold || fastFlick
  gesture.ended = true

  if (gesture.ready) void settleGesture()
  else if (!gesture.preparing) {
    if (gesture.commitWanted) clickMargin(gesture.direction)
    resetGesture()
  }
}

function cancelGesture(event: Event): void {
  if (!gesture.active) return
  const e = event as TouchEvent
  if (gesture.dragging && e.cancelable) e.preventDefault()
  gesture.active = false
  gesture.ended = true
  gesture.commitWanted = false
  if (gesture.ready) void settleGesture()
  else if (!gesture.preparing) resetGesture()
}

function attachDocument(doc: Document): void {
  if (seenDocuments.has(doc)) return
  seenDocuments.add(doc)
  doc.documentElement.style.touchAction = 'pan-y pinch-zoom'
  if (doc.body) doc.body.style.touchAction = 'pan-y pinch-zoom'
  doc.addEventListener('touchstart', event => startGesture(event, doc), { passive: true })
  doc.addEventListener('touchmove', moveGesture, { passive: false })
  doc.addEventListener('touchend', endGesture, { passive: false })
  doc.addEventListener('touchcancel', cancelGesture, { passive: false })
}

function attachFrame(frame: HTMLIFrameElement): void {
  if (seenFrames.has(frame)) return
  seenFrames.add(frame)
  const attach = (): void => {
    try {
      if (frame.contentDocument) attachDocument(frame.contentDocument)
    } catch {
      // EPUB.js normally renders same-origin iframe content.
    }
  }
  frame.addEventListener('load', () => window.setTimeout(attach, 0))
  attach()
}

function attachStage(stage: HTMLElement): void {
  if (seenStages.has(stage)) return
  seenStages.add(stage)
  stage.addEventListener('touchstart', event => startGesture(event, document), { capture: true, passive: true })
  stage.addEventListener('touchmove', moveGesture, { capture: true, passive: false })
  stage.addEventListener('touchend', endGesture, { capture: true, passive: false })
  stage.addEventListener('touchcancel', cancelGesture, { capture: true, passive: false })
  stage.addEventListener('click', event => {
    if (!manualClick && performance.now() < suppressClickUntil) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)
}

function scanReader(): void {
  document.querySelectorAll<HTMLElement>('.reader-stage').forEach(attachStage)
  document.querySelectorAll<HTMLIFrameElement>('.epub-viewer iframe').forEach(attachFrame)
}

function startObserver(): void {
  scanReader()
  const observer = new MutationObserver(scanReader)
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true })
else startObserver()
