export type CurlDirection = 'next' | 'prev'

export type CurlPoint = { x: number; y: number }

const VERTEX_SHADER = `
attribute vec2 a_uv;
uniform vec2 u_finger;
uniform float u_startY;
uniform float u_direction;
uniform float u_aspect;
varying vec2 v_uv;
varying float v_bend;
varying float v_height;
varying float v_foldSide;

const float PI = 3.141592653589793;

void main() {
  float x = a_uv.x;
  float y = a_uv.y;
  float edge = u_direction > 0.0 ? 1.0 : 0.0;
  float pullX = clamp(u_finger.x, -1.05, 2.05);
  float pullY = clamp(u_finger.y, -0.2, 1.2);
  float baseFold = (edge + pullX) * 0.5;
  float verticalPull = clamp(pullY - u_startY, -0.75, 0.75);
  float tilt = verticalPull * 0.28 / max(u_aspect, 0.45);
  float fold = baseFold + tilt * (y - 0.5);
  float distanceToFold = u_direction > 0.0 ? x - fold : fold - x;
  float available = max(abs(edge - fold), 0.001);
  float t = clamp(distanceToFold / available, 0.0, 1.0);
  float onFoldedSide = step(0.0001, distanceToFold);

  float smoothBend = smoothstep(0.0, 0.82, t);
  float reflected = 2.0 * fold - x;
  float foldedX = mix(x, reflected, smoothBend);
  float height = sin(PI * t) * available * 0.46 * onFoldedSide;

  float yDrag = verticalPull * t * 0.075 * onFoldedSide;
  float edgeTaper = sin(PI * y);
  height *= 0.82 + 0.18 * edgeTaper;

  x = mix(x, foldedX, onFoldedSide);
  y += yDrag;

  float depthScale = 1.0 + height * 0.22;
  vec2 centered = vec2((x - 0.5) * 2.0, (0.5 - y) * 2.0);
  centered *= depthScale;
  centered.x += u_direction * height * 0.055;
  centered.y += (0.5 - y) * height * 0.035;

  gl_Position = vec4(centered.x, centered.y, -height * 0.72, 1.0);
  v_uv = a_uv;
  v_bend = t * onFoldedSide;
  v_height = height;
  v_foldSide = onFoldedSide;
}
`

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_uv;
varying float v_bend;
varying float v_height;
varying float v_foldSide;

void main() {
  vec4 color = texture2D(u_texture, v_uv);
  float crease = exp(-pow((v_bend - 0.08) * 10.0, 2.0));
  float ridge = sin(3.141592653589793 * v_bend);
  float underside = smoothstep(0.46, 1.0, v_bend) * v_foldSide;
  float highlight = exp(-pow((v_bend - 0.28) * 6.5, 2.0));
  float shade = 1.0 - crease * 0.34 - ridge * 0.12 + highlight * 0.10;
  color.rgb *= shade;
  color.rgb = mix(color.rgb, vec3(0.945, 0.925, 0.865), underside * 0.28);
  color.rgb += min(v_height * 0.12, 0.06);
  gl_FragColor = color;
}
`

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('No se pudo crear el shader de página')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Error de shader desconocido'
    gl.deleteShader(shader)
    throw new Error(info)
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!program) throw new Error('No se pudo crear el programa WebGL')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Error de enlace WebGL desconocido'
    gl.deleteProgram(program)
    throw new Error(info)
  }
  return program
}

function buildGrid(columns = 72, rows = 30): Float32Array {
  const data: number[] = []
  for (let y = 0; y < rows; y += 1) {
    const v0 = y / rows
    const v1 = (y + 1) / rows
    for (let x = 0; x < columns; x += 1) {
      const u0 = x / columns
      const u1 = (x + 1) / columns
      data.push(u0, v0, u1, v0, u0, v1)
      data.push(u0, v1, u1, v0, u1, v1)
    }
  }
  return new Float32Array(data)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export class PageCurlRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly shadow: HTMLDivElement
  private readonly gl: WebGLRenderingContext
  private readonly program: WebGLProgram
  private readonly buffer: WebGLBuffer
  private readonly texture: WebGLTexture
  private readonly vertexCount: number
  private readonly fingerLocation: WebGLUniformLocation | null
  private readonly startYLocation: WebGLUniformLocation | null
  private readonly directionLocation: WebGLUniformLocation | null
  private readonly aspectLocation: WebGLUniformLocation | null
  private readonly width: number
  private readonly height: number
  private readonly direction: CurlDirection
  private readonly startY: number
  private pointer: CurlPoint
  private animationFrame = 0

  constructor(stage: HTMLElement, viewer: HTMLElement, source: HTMLCanvasElement, direction: CurlDirection, startY: number) {
    const stageRect = stage.getBoundingClientRect()
    const viewerRect = viewer.getBoundingClientRect()
    this.width = Math.max(1, viewerRect.width)
    this.height = Math.max(1, viewerRect.height)
    this.direction = direction
    this.startY = clamp(startY / this.height, 0, 1)
    this.pointer = { x: direction === 'next' ? this.width : 0, y: startY }

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'lectoria-curl-canvas'
    this.canvas.width = source.width
    this.canvas.height = source.height
    Object.assign(this.canvas.style, {
      left: `${viewerRect.left - stageRect.left}px`,
      top: `${viewerRect.top - stageRect.top}px`,
      width: `${viewerRect.width}px`,
      height: `${viewerRect.height}px`,
    })
    stage.appendChild(this.canvas)

    this.shadow = document.createElement('div')
    this.shadow.className = `lectoria-curl-cast-shadow ${direction}`
    Object.assign(this.shadow.style, {
      left: `${viewerRect.left - stageRect.left}px`,
      top: `${viewerRect.top - stageRect.top}px`,
      height: `${viewerRect.height}px`,
    })
    stage.appendChild(this.shadow)

    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL no está disponible para el cambio de página')
    this.gl = gl
    this.program = createProgram(gl)
    gl.useProgram(this.program)

    const grid = buildGrid()
    this.vertexCount = grid.length / 2
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('No se pudo crear la malla de página')
    this.buffer = buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW)
    const uvLocation = gl.getAttribLocation(this.program, 'a_uv')
    gl.enableVertexAttribArray(uvLocation)
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0)

    const texture = gl.createTexture()
    if (!texture) throw new Error('No se pudo crear la textura de página')
    this.texture = texture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_texture'), 0)

    this.fingerLocation = gl.getUniformLocation(this.program, 'u_finger')
    this.startYLocation = gl.getUniformLocation(this.program, 'u_startY')
    this.directionLocation = gl.getUniformLocation(this.program, 'u_direction')
    this.aspectLocation = gl.getUniformLocation(this.program, 'u_aspect')

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.CULL_FACE)
    gl.clearColor(0, 0, 0, 0)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.render()
  }

  setPointer(x: number, y: number): void {
    this.pointer = { x, y }
    this.render()
  }

  async animateTo(targetX: number, targetY: number, duration: number): Promise<void> {
    cancelAnimationFrame(this.animationFrame)
    const from = { ...this.pointer }
    const start = performance.now()
    return new Promise(resolve => {
      const tick = (now: number): void => {
        const raw = clamp((now - start) / Math.max(1, duration), 0, 1)
        const eased = 1 - Math.pow(1 - raw, 3)
        this.pointer = {
          x: from.x + (targetX - from.x) * eased,
          y: from.y + (targetY - from.y) * eased,
        }
        this.render()
        if (raw < 1) this.animationFrame = requestAnimationFrame(tick)
        else resolve()
      }
      this.animationFrame = requestAnimationFrame(tick)
    })
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame)
    const gl = this.gl
    gl.deleteTexture(this.texture)
    gl.deleteBuffer(this.buffer)
    gl.deleteProgram(this.program)
    this.canvas.remove()
    this.shadow.remove()
  }

  private render(): void {
    const gl = this.gl
    const x = this.pointer.x / this.width
    const y = this.pointer.y / this.height
    gl.useProgram(this.program)
    gl.uniform2f(this.fingerLocation, x, y)
    gl.uniform1f(this.startYLocation, this.startY)
    gl.uniform1f(this.directionLocation, this.direction === 'next' ? 1 : -1)
    gl.uniform1f(this.aspectLocation, this.width / this.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
    this.positionShadow(x, y)
  }

  private positionShadow(x: number, y: number): void {
    const edge = this.direction === 'next' ? 1 : 0
    const foldX = (edge + x) * 0.5
    const verticalPull = clamp(y - this.startY, -0.75, 0.75)
    const tilt = verticalPull * 0.28 / Math.max(this.width / this.height, 0.45)
    const foldPixels = foldX * this.width
    const angle = Math.atan(tilt * this.width / this.height) * 180 / Math.PI
    const progress = clamp(Math.abs(edge - x), 0, 1)
    this.shadow.style.transform = `translateX(${foldPixels}px) rotate(${angle}deg)`
    this.shadow.style.width = `${28 + progress * 74}px`
    this.shadow.style.opacity = String(0.08 + progress * 0.36)
  }
}
