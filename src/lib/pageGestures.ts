type PageDirection = 'next' | 'prev'
type Point = { x: number; y: number }
type Line = { normal: Point; midpoint: Point }

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
  height: number
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
  height: 1,
  direction: 'next',
  sourceDocument: null,
}

const seenDocuments = new WeakSet<Document>()
const seenStages = new WeakSet<HTMLElement>()
const seenFrames = new WeakSet<HTMLIFrameElement>()
let curlBack: HTMLDivElement | null = null
let curlShadow: HTMLDivElement | null = null
let underPage: HTMLDivElement | null = null
let manualClick = false
let suppressClickUntil = 0
let animationFrame = 0

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

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

function signedDistance(line: Line, point: Point): number {
  return line.normal.x * (point.x - line.midpoint.x) + line.normal.y * (point.y - line.midpoint.y)
}

function clipHalfPlane(polygon: Point[], line: Line, keepSign: number): Point[] {
  const result: Point[] = []
  if (!polygon.length) return result
  const inside = (point: Point): boolean => signedDistance(line, point) * keepSign >= -0.01

  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]
    const previous = polygon[(i + polygon.length - 1) % polygon.length]
    const currentInside = inside(current)
    const previousInside = inside(previous)

    if (currentInside !== previousInside) {
      const a = signedDistance(line, previous)
      const b = signedDistance(line, current)
      const denominator = a - b
      if (Math.abs(denominator) > 0.0001) {
        const t = a / denominator
        result.push({
          x: previous.x + (current.x - previous.x) * t,
          y: previous.y + (current.y - previous.y) * t,
        })
      }
    }
    if (currentInside) result.push(current)
  }
  return result
}

function reflectPoint(point: Point, line: Line): Point {
  const length = Math.hypot(line.normal.x, line.normal.y) || 1
  const nx = line.normal.x / length
  const ny = line.normal.y / length
  const distance = nx * (point.x - line.midpoint.x) + ny * (point.y - line.midpoint.y)
  return { x: point.x - 2 * distance * nx, y: point.y - 2 * distance * ny }
}

function lineIntersections(line: Line, width: number, height: number): Point[] {
  const points: Point[] = []
  const { normal: n, midpoint: m } = line
  const add = (point: Point): void => {
    if (point.x < -0.5 || point.x > width + 0.5 || point.y < -0.5 || point.y > height + 0.5) return
    if (!points.some(existing => Math.hypot(existing.x - point.x, existing.y - point.y) < 1)) points.push(point)
  }

  if (Math.abs(n.y) > 0.0001) {
    add({ x: 0, y: m.y - n.x * (0 - m.x) / n.y })
    add({ x: width, y: m.y - n.x * (width - m.x) / n.y })
  }
  if (Math.abs(n.x) > 0.0001) {
    add({ x: m.x - n.y * (0 - m.y) / n.x, y: 0 })
    add({ x: m.x - n.y * (height - m.y) / n.x, y: height })
  }

  if (points.length <= 2) return points
  let best: [Point, Point] = [points[0], points[1]]
  let bestDistance = 0
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      if (distance > bestDistance) {
        bestDistance = distance
        best = [points[i], points[j]]
      }
    }
  }
  return best
}

function polygonCss(points: Point[], width: number, height: number): string {
  if (points.length < 3) return 'polygon(0 0, 0 0, 0 100%, 0 100%)'
  return `polygon(${points.map(point => `${(point.x / width) * 100}% ${(point.y / height) * 100}%`).join(',')})`
}

function ensureCurlLayers(): void {
  const stage = readerStage()
  if (!stage) return
  if (!underPage || !underPage.isConnected) {
    underPage = document.createElement('div')
    underPage.className = 'lectoria-under-page'
    stage.appendChild(underPage)
  }
  if (!curlBack || !curlBack.isConnected) {
    curlBack = document.createElement('div')
    curlBack.className = 'lectoria-curl-back'
    stage.appendChild(curlBack)
  }
  if (!curlShadow || !curlShadow.isConnected) {
    curlShadow = document.createElement('div')
    curlShadow.className = 'lectoria-curl-shadow'
    stage.appendChild(curlShadow)
  }
}

function geometry(direction: PageDirection, x: number, y: number): { line: Line; visible: Point[]; folded: Point[]; crease: Point[]; progress: number } | null {
  const width = gesture.width
  const height = gesture.height
  const edgeX = direction === 'next' ? width : 0
  const currentX = clamp(x, -width * 1.05, width * 2.05)
  const currentY = clamp(y, -height * 0.15, height * 1.15)
  const anchor = { x: edgeX, y: clamp(gesture.startY, 0, height) }
  const finger = { x: currentX, y: currentY }
  const normal = { x: finger.x - anchor.x, y: finger.y - anchor.y }
  if (Math.hypot(normal.x, normal.y) < 1.5) return null

  const line: Line = {
    normal,
    midpoint: { x: (anchor.x + finger.x) / 2, y: (anchor.y + finger.y) / 2 },
  }
  const rect: Point[] = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
  const safePoint = direction === 'next' ? { x: 0, y: height / 2 } : { x: width, y: height / 2 }
  const safeDistance = signedDistance(line, safePoint)
  const keepSign = safeDistance >= 0 ? 1 : -1
  const visible = clipHalfPlane(rect, line, keepSign)
  const hidden = clipHalfPlane(rect, line, -keepSign)
  const folded = hidden.map(point => reflectPoint(point, line))
  const crease = lineIntersections(line, width, height)
  const progress = clamp(Math.abs(edgeX - currentX) / width, 0, 1)
  return { line, visible, folded, crease, progress }
}

function applyCurl(direction: PageDirection, x: number, y: number): void {
  const stage = readerStage()
  const page = viewer()
  if (!stage || !page) return
  const calculated = geometry(direction, x, y)
  if (!calculated) return
  ensureCurlLayers()

  const { visible, folded, crease, progress } = calculated
  stage.classList.add('lectoria-gesture-active')
  page.classList.add('lectoria-dragging')
  page.style.clipPath = polygonCss(visible, gesture.width, gesture.height)
  page.style.setProperty('-webkit-clip-path', polygonCss(visible, gesture.width, gesture.height))

  if (underPage) {
    underPage.style.opacity = String(0.42 + progress * 0.38)
  }

  if (curlBack) {
    curlBack.className = `lectoria-curl-back ${direction}`
    const foldedShape = polygonCss(folded, gesture.width, gesture.height)
    curlBack.style.clipPath = foldedShape
    curlBack.style.setProperty('-webkit-clip-path', foldedShape)
    curlBack.style.opacity = String(clamp(0.4 + progress * 0.6, 0, 1))
  }

  if (curlShadow && crease.length >= 2) {
    const first = crease[0]
    const second = crease[1]
    const dx = second.x - first.x
    const dy = second.y - first.y
    const length = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx) * 180 / Math.PI - 90
    curlShadow.className = `lectoria-curl-shadow ${direction}`
    curlShadow.style.left = `${first.x + 8}px`
    curlShadow.style.top = `${first.y + 8}px`
    curlShadow.style.height = `${length}px`
    curlShadow.style.width = `${22 + progress * 56}px`
    curlShadow.style.opacity = String(clamp(0.12 + progress * 0.58, 0, 0.72))
    curlShadow.style.transform = `translateX(-50%) rotate(${angle}deg)`
  }
}

function finishVisualReset(): void {
  cancelAnimationFrame(animationFrame)
  const stage = readerStage()
  const page = viewer()
  if (page) {
    page.classList.remove('lectoria-dragging')
    page.style.clipPath = ''
    page.style.removeProperty('-webkit-clip-path')
    page.style.transform = ''
    page.style.transformOrigin = ''
    page.style.boxShadow = ''
  }
  stage?.classList.remove('lectoria-gesture-active')
  curlBack?.remove()
  curlShadow?.remove()
  underPage?.remove()
  curlBack = null
  curlShadow = null
  underPage = null
}

function animateCurl(direction: PageDirection, toX: number, toY: number, duration: number, done: () => void): void {
  cancelAnimationFrame(animationFrame)
  const fromX = gesture.lastX
  const fromY = gesture.lastY
  const startedAt = performance.now()

  const frame = (now: number): void => {
    const raw = clamp((now - startedAt) / duration, 0, 1)
    const eased = 1 - Math.pow(1 - raw, 3)
    const x = fromX + (toX - fromX) * eased
    const y = fromY + (toY - fromY) * eased
    gesture.lastX = x
    gesture.lastY = y
    applyCurl(direction, x, y)
    if (raw < 1) animationFrame = requestAnimationFrame(frame)
    else done()
  }
  animationFrame = requestAnimationFrame(frame)
}

function cancelPageCurl(direction: PageDirection): void {
  const edgeX = direction === 'next' ? gesture.width : 0
  animateCurl(direction, edgeX, gesture.startY, 185, finishVisualReset)
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
  const targetX = direction === 'next' ? -gesture.width * 0.98 : gesture.width * 1.98
  const drift = (gesture.lastY - gesture.startY) * 0.12
  const targetY = clamp(gesture.lastY + drift, -gesture.height * 0.08, gesture.height * 1.08)
  const speed = Math.abs(gesture.velocityX)
  const duration = clamp(245 - speed * 90, 145, 245)
  suppressClickUntil = performance.now() + 700

  animateCurl(direction, targetX, targetY, duration, () => {
    clickMargin(direction)
    window.setTimeout(finishVisualReset, 210)
  })
}

function toggleReaderControls(): void {
  document.querySelector<HTMLElement>('.reader-shell')?.click()
}

function localTouch(touch: Touch, sourceDocument: Document): Point {
  if (sourceDocument === document) {
    const rect = viewer()?.getBoundingClientRect()
    if (rect) return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
  }
  return { x: touch.clientX, y: touch.clientY }
}

function startGesture(event: Event, sourceDocument: Document): void {
  if (!paginatedMode()) return
  const e = event as TouchEvent
  if (e.touches.length !== 1) return
  const touch = e.touches[0]
  const target = e.target as Element | null
  if (target?.closest('input,textarea,select')) return
  const rect = viewer()?.getBoundingClientRect()
  const point = localTouch(touch, sourceDocument)

  gesture.active = true
  gesture.blocked = false
  gesture.dragging = false
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
  if (!gesture.active || gesture.blocked) return
  const e = event as TouchEvent
  if (e.touches.length !== 1 || !gesture.sourceDocument) return
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
  }

  if (e.cancelable) e.preventDefault()
  const now = performance.now()
  const elapsed = Math.max(1, now - gesture.lastAt)
  gesture.velocityX = (point.x - gesture.lastX) / elapsed
  gesture.lastX = point.x
  gesture.lastY = point.y
  gesture.lastAt = now
  applyCurl(gesture.direction, point.x, point.y)
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
  }

  const wasDragging = gesture.dragging
  const wasBlocked = gesture.blocked
  const dx = gesture.lastX - gesture.startX
  const dy = gesture.lastY - gesture.startY
  const distance = Math.abs(dx)
  const direction = gesture.direction
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
  const threshold = Math.min(145, gesture.width * 0.18)
  const correctDirection = direction === 'next' ? dx < 0 : dx > 0
  const fastFlick = correctDirection && Math.abs(gesture.velocityX) >= 0.48 && distance >= 26
  if (correctDirection && (distance >= threshold || fastFlick)) commitPageTurn(direction)
  else cancelPageCurl(direction)
}

function cancelGesture(event: Event): void {
  if (!gesture.active) return
  const e = event as TouchEvent
  const direction = gesture.direction
  if (gesture.dragging && e.cancelable) e.preventDefault()
  const hadDrag = gesture.dragging
  gesture.active = false
  gesture.dragging = false
  gesture.blocked = false
  gesture.sourceDocument = null
  if (hadDrag) cancelPageCurl(direction)
  else finishVisualReset()
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
      // EPUB.js suele renderizar el contenido en un iframe del mismo origen.
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
