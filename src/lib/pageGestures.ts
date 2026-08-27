type PageDirection = 'next' | 'prev'

type GestureState = {
  active: boolean
  blocked: boolean
  dragging: boolean
  startX: number
  startY: number
  lastX: number
  lastY: number
  lastAt: number
  velocityX: number
  width: number
  direction: PageDirection
  sourceDocument: Document | null
}

const gesture: GestureState = {
  active: false,
  blocked: false,
  dragging: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  lastAt: 0,
  velocityX: 0,
  width: 1,
  direction: 'next',
  sourceDocument: null,
}

const seenDocuments = new WeakSet<Document>()
const seenStages = new WeakSet<HTMLElement>()
const seenFrames = new WeakSet<HTMLIFrameElement>()
let fold: HTMLDivElement | null = null
let manualClick = false
let suppressClickUntil = 0

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

function pageAngle(progress: number): number {
  const projectedWidth = Math.max(0.04, 1 - progress * 0.96)
  return Math.acos(projectedWidth) * 180 / Math.PI
}

function ensureFold(direction: PageDirection): HTMLDivElement | null {
  const stage = readerStage()
  if (!stage) return null
  if (!fold || !fold.isConnected) {
    fold = document.createElement('div')
    stage.appendChild(fold)
  }
  fold.className = `lectoria-page-fold ${direction}`
  return fold
}

function applyPageLift(direction: PageDirection, progress: number, settling = false): void {
  const stage = readerStage()
  const page = viewer()
  if (!stage || !page) return

  const p = Math.max(0, Math.min(0.995, progress))
  const angle = pageAngle(p)
  const sign = direction === 'next' ? -1 : 1

  stage.classList.add('lectoria-gesture-active')
  page.classList.toggle('lectoria-dragging', !settling)
  page.classList.toggle('lectoria-settling', settling)
  page.style.transformOrigin = direction === 'next' ? 'left center' : 'right center'
  page.style.transform = `perspective(1600px) rotateY(${sign * angle}deg)`
  page.style.boxShadow = `${direction === 'next' ? -1 : 1 * 1}px 10px ${24 + p * 34}px rgba(21,35,29,${0.08 + p * 0.18})`

  const crease = ensureFold(direction)
  if (crease) {
    const edge = direction === 'next' ? 100 - p * 96 : p * 96
    crease.style.left = `${edge}%`
    crease.style.opacity = String(Math.min(0.72, 0.12 + p * 0.58))
    crease.style.transform = `translateX(-50%) scaleX(${0.72 + p * 0.72})`
  }
}

function finishVisualReset(): void {
  const stage = readerStage()
  const page = viewer()
  if (page) {
    page.classList.remove('lectoria-dragging', 'lectoria-settling')
    page.style.transform = ''
    page.style.transformOrigin = ''
    page.style.boxShadow = ''
    page.style.transition = ''
  }
  stage?.classList.remove('lectoria-gesture-active')
  fold?.remove()
  fold = null
}

function cancelPageLift(): void {
  const page = viewer()
  if (!page) {
    finishVisualReset()
    return
  }
  page.classList.remove('lectoria-dragging')
  page.classList.add('lectoria-settling')
  page.style.transform = 'perspective(1600px) rotateY(0deg)'
  page.style.boxShadow = ''
  if (fold) fold.style.opacity = '0'
  window.setTimeout(finishVisualReset, 190)
}

function clickMargin(direction: PageDirection): void {
  const selector = direction === 'next' ? '.tap-zone.right' : '.tap-zone.left'
  const button = document.querySelector<HTMLButtonElement>(selector)
  if (!button) return
  manualClick = true
  button.click()
  manualClick = false
}

function commitPageTurn(direction: PageDirection): void {
  applyPageLift(direction, 0.995, true)
  suppressClickUntil = performance.now() + 550
  window.setTimeout(() => {
    clickMargin(direction)
    window.setTimeout(() => {
      const page = viewer()
      if (page) {
        page.classList.remove('lectoria-dragging', 'lectoria-settling')
        page.style.transition = 'none'
        page.style.transform = ''
        page.style.transformOrigin = ''
        page.style.boxShadow = ''
      }
      if (fold) fold.style.opacity = '0'
      window.setTimeout(finishVisualReset, 230)
    }, 150)
  }, 95)
}

function toggleReaderControls(): void {
  document.querySelector<HTMLElement>('.reader-shell')?.click()
}

function startGesture(event: Event, sourceDocument: Document): void {
  if (!paginatedMode()) return
  const e = event as TouchEvent
  if (e.touches.length !== 1) return
  const touch = e.touches[0]
  const target = e.target as Element | null
  if (target?.closest('input,textarea,select')) return

  gesture.active = true
  gesture.blocked = false
  gesture.dragging = false
  gesture.startX = touch.clientX
  gesture.startY = touch.clientY
  gesture.lastX = touch.clientX
  gesture.lastY = touch.clientY
  gesture.lastAt = performance.now()
  gesture.velocityX = 0
  gesture.width = Math.max(1, sourceDocument.defaultView?.innerWidth || window.innerWidth)
  gesture.direction = 'next'
  gesture.sourceDocument = sourceDocument
}

function moveGesture(event: Event): void {
  if (!gesture.active || gesture.blocked) return
  const e = event as TouchEvent
  if (e.touches.length !== 1) return
  const touch = e.touches[0]
  const dx = touch.clientX - gesture.startX
  const dy = touch.clientY - gesture.startY
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  if (!gesture.dragging) {
    if (absX < 7 && absY < 7) return
    if (absY > absX * 1.12) {
      gesture.blocked = true
      return
    }
    if (absX <= absY) return
    gesture.dragging = true
  }

  if (e.cancelable) e.preventDefault()
  const now = performance.now()
  const elapsed = Math.max(1, now - gesture.lastAt)
  gesture.velocityX = (touch.clientX - gesture.lastX) / elapsed
  gesture.lastX = touch.clientX
  gesture.lastY = touch.clientY
  gesture.lastAt = now
  gesture.direction = dx < 0 ? 'next' : 'prev'
  applyPageLift(gesture.direction, absX / gesture.width)
}

function endGesture(event: Event): void {
  if (!gesture.active) return
  const e = event as TouchEvent
  const touch = e.changedTouches[0]
  if (touch) {
    const now = performance.now()
    const elapsed = Math.max(1, now - gesture.lastAt)
    gesture.velocityX = (touch.clientX - gesture.lastX) / elapsed
    gesture.lastX = touch.clientX
    gesture.lastY = touch.clientY
    gesture.lastAt = now
  }

  const wasDragging = gesture.dragging
  const wasBlocked = gesture.blocked
  const sourceDocument = gesture.sourceDocument
  const dx = gesture.lastX - gesture.startX
  const dy = gesture.lastY - gesture.startY
  const distance = Math.abs(dx)
  const direction: PageDirection = dx < 0 ? 'next' : 'prev'
  const target = e.target as Element | null

  gesture.active = false
  gesture.dragging = false
  gesture.blocked = false
  gesture.sourceDocument = null

  if (wasBlocked) return

  if (!wasDragging) {
    if (sourceDocument && sourceDocument !== document && distance < 9 && Math.abs(dy) < 9) {
      const selection = sourceDocument.defaultView?.getSelection()?.toString().trim() || ''
      if (selection || target?.closest('a,input,textarea,button,select')) return
      if (gesture.startX > gesture.width * 0.82) clickMargin('next')
      else if (gesture.startX < gesture.width * 0.18) clickMargin('prev')
      else toggleReaderControls()
    }
    return
  }

  if (e.cancelable) e.preventDefault()
  const threshold = Math.min(140, gesture.width * 0.18)
  const fastFlick = Math.abs(gesture.velocityX) >= 0.5 && distance >= 28
  if (distance >= threshold || fastFlick) commitPageTurn(direction)
  else cancelPageLift()
}

function cancelGesture(event: Event): void {
  if (!gesture.active) return
  const e = event as TouchEvent
  if (gesture.dragging && e.cancelable) e.preventDefault()
  gesture.active = false
  gesture.dragging = false
  gesture.blocked = false
  gesture.sourceDocument = null
  cancelPageLift()
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
  const attach = () => {
    try {
      if (frame.contentDocument) attachDocument(frame.contentDocument)
    } catch {
      // EPUB.js normally renders same-origin iframe content; inaccessible frames are simply skipped.
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
