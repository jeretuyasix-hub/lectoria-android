import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { clearAiConfig, getAiConfig, getAiModelLabel, getAiUsageLedger, saveAiConfig, setAiStartingBalance, testAiConnection, type AiModel, type AiUsageLedger } from '../lib/ai'
import type { BookRecord, FontFamilyMode, PageMode, ReaderSettings, TextAlignMode, ThemeMode } from '../types'

const fontStacks: Record<FontFamilyMode, string> = {
  publisher: 'Georgia, serif',
  literary: 'Iowan Old Style, Palatino Linotype, Georgia, serif',
  modern: 'Inter, system-ui, sans-serif',
  accessible: 'Atkinson Hyperlegible, Verdana, system-ui, sans-serif'
}

export default function SettingsPanel({ open, onClose, settings, onChange, bookType, onBookType }: {
  open: boolean
  onClose: () => void
  settings: ReaderSettings
  onChange: (settings: ReaderSettings) => void
  bookType: BookRecord['type']
  onBookType: (type: NonNullable<BookRecord['type']>) => void
}) {
  const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => onChange({ ...settings, [key]: value })
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState<AiModel>('gpt-5.6-terra')
  const [aiStatus, setAiStatus] = useState('')
  const [testing, setTesting] = useState(false)
  const [usage, setUsage] = useState<AiUsageLedger>(getAiUsageLedger())
  const [balanceDraft, setBalanceDraft] = useState('5.00')

  useEffect(() => {
    if (!open) return
    const cfg = getAiConfig(), currentUsage = getAiUsageLedger()
    setApiKey(cfg.apiKey); setModel(cfg.model)
    setUsage(currentUsage); setBalanceDraft(currentUsage.startingBalance.toFixed(2))
    setAiStatus(cfg.apiKey ? `${getAiModelLabel(cfg.model)} conectado durante esta sesión.` : '')
  }, [open])

  useEffect(() => {
    const update = (event: Event) => setUsage((event as CustomEvent<AiUsageLedger>).detail || getAiUsageLedger())
    window.addEventListener('lectoria-ai-usage', update)
    return () => window.removeEventListener('lectoria-ai-usage', update)
  }, [])

  async function connectAi() {
    const previous = getAiConfig()
    const config = { apiKey: apiKey.trim(), model, rememberKey: false, responseLength: previous.responseLength }
    if (!config.apiKey) { setAiStatus('Escribe una clave API para conectar el Tutor.'); return }
    setTesting(true); setAiStatus(`Comprobando ${getAiModelLabel(model)}…`)
    try {
      const result = await testAiConnection(config)
      saveAiConfig(config); setUsage(getAiUsageLedger()); setAiStatus(`${result || 'Conexión correcta.'} · ${getAiModelLabel(model)}`)
    } catch (error) { setAiStatus(error instanceof Error ? error.message : 'No se pudo conectar.') }
    finally { setTesting(false) }
  }

  function disconnectAi() {
    clearAiConfig(); setApiKey(''); setAiStatus('Tutor desconectado. Se usará el modo local.')
  }

  function commitBalance() {
    const value = Number(balanceDraft.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) { setBalanceDraft(usage.startingBalance.toFixed(2)); return }
    const next = setAiStartingBalance(value); setUsage(next); setBalanceDraft(next.startingBalance.toFixed(2))
  }

  const spent = usage.spentText + usage.spentAudio
  const remaining = Math.max(0, usage.startingBalance - spent)
  const previewPalette = settings.theme === 'oled' ? { bg: '#000000', fg: '#f4f4f1', muted: '#b8bdb9' }
    : settings.theme === 'dark' ? { bg: '#17211d', fg: '#edf1ee', muted: '#aab5af' }
    : settings.theme === 'sepia' ? { bg: '#efe2c8', fg: '#3f3326', muted: '#786957' }
    : { bg: '#fbf7ed', fg: '#17342b', muted: '#6f7c76' }
  const previewStyle = useMemo(() => ({ fontFamily: fontStacks[settings.fontFamily], textAlign: settings.textAlign === 'publisher' ? undefined : settings.textAlign as 'left'|'justify' }), [settings.fontFamily, settings.textAlign])

  return <AnimatePresence>{open && <>
    <motion.button className="panel-backdrop" aria-label="Cerrar ajustes" onClick={onClose} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}/>
    <motion.aside className="settings-sheet premium-sheet" role="dialog" aria-modal="true" aria-label="Apariencia y lectura" tabIndex={-1} initial={{ y: '105%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 390, damping: 38, mass:.82 }}>
      <div className="tutor-grabber"/><header className="side-header"><div><strong>Apariencia y lectura</strong><span>Una página precisa, cómoda y tuya</span></div><button onClick={onClose} aria-label="Cerrar ajustes">×</button></header>
      <div className="settings-grid premium-settings-grid">
        <section className="reading-preview-card premium-preview">
          <div className="reading-preview-label"><b>Vista viva</b><span>{settings.fontSize}% · {settings.pageMode === 'curl' ? 'página física' : settings.pageMode === 'slide' ? 'deslizamiento' : 'continuo'}</span></div>
          <div className="reading-preview-page" style={{ background: previewPalette.bg, color: previewPalette.fg, paddingInline: `${10 + settings.margins * 1.5}px`, ...previewStyle }}>
            <strong style={{ fontSize: `${Math.max(14, 18 * settings.fontSize / 100)}px` }}>La forma de la página también forma la lectura.</strong>
            <p style={{ fontSize: `${Math.max(12, 15 * settings.fontSize / 100)}px`, lineHeight: settings.lineHeight, marginBottom: settings.paragraphSpacing ? '1em' : '.35em' }}>Ajusta tipografía, ritmo y espacio hasta que el texto desaparezca como interfaz y quede solo la lectura.</p>
            <p style={{ fontSize: `${Math.max(12, 15 * settings.fontSize / 100)}px`, lineHeight: settings.lineHeight }}>Los cambios se aplican al EPUB sin perder la ubicación actual.</p>
            <small style={{ color: previewPalette.muted }}>Lectoria · lectura inmersiva</small>
          </div>
        </section>

        <section className="settings-section"><header><b>Tipografía</b><span>Legibilidad y densidad</span></header>
          <label><span>Tamaño de texto <b>{settings.fontSize}%</b></span><input type="range" min="80" max="170" value={settings.fontSize} onChange={e => set('fontSize', Number(e.target.value))}/></label>
          <label><span>Interlineado <b>{settings.lineHeight.toFixed(2)}</b></span><input type="range" min="1.3" max="2.25" step="0.05" value={settings.lineHeight} onChange={e => set('lineHeight', Number(e.target.value))}/></label>
          <label><span>Márgenes <b>{settings.margins}vw</b></span><input type="range" min="2" max="15" step="1" value={settings.margins} onChange={e => set('margins', Number(e.target.value))}/></label>
          <label><span>Familia tipográfica</span><select value={settings.fontFamily} onChange={e => set('fontFamily', e.target.value as FontFamilyMode)}><option value="publisher">Original del libro</option><option value="literary">Literaria</option><option value="modern">Moderna</option><option value="accessible">Alta legibilidad</option></select></label>
          <label><span>Alineación</span><select value={settings.textAlign} onChange={e => set('textAlign', e.target.value as TextAlignMode)}><option value="publisher">Original del libro</option><option value="left">Izquierda</option><option value="justify">Justificada</option></select></label>
          <label className="toggle-row"><span><b>Espacio entre párrafos</b><small>Aumenta la separación visual sin alterar el contenido</small></span><input type="checkbox" checked={settings.paragraphSpacing} onChange={e => set('paragraphSpacing', e.target.checked)}/></label>
        </section>

        <section className="settings-section"><header><b>Página y movimiento</b><span>Cómo se desplaza el libro</span></header>
          <label><span>Tema</span><select value={settings.theme} onChange={e => set('theme', e.target.value as ThemeMode)}><option value="paper">Papel</option><option value="sepia">Sepia</option><option value="dark">Oscuro</option><option value="oled">OLED</option></select></label>
          <label><span>Navegación</span><select value={settings.pageMode} onChange={e => set('pageMode', e.target.value as PageMode)}><option value="curl">Página física · WebGL</option><option value="slide">Deslizamiento rápido</option><option value="scroll">Desplazamiento continuo</option></select></label>
          <label><span>Velocidad de voz <b>{settings.ttsRate.toFixed(1)}×</b></span><input type="range" min="0.7" max="1.8" step="0.1" value={settings.ttsRate} onChange={e => set('ttsRate', Number(e.target.value))}/></label>
          <label className="toggle-row"><span><b>Previa hablada automática</b><small>Antes de una nueva ubicación cuando corresponda</small></span><input type="checkbox" checked={settings.prepAudio} onChange={e => set('prepAudio', e.target.checked)}/></label>
        </section>

        <section className="settings-section"><header><b>Contexto intelectual</b><span>Cómo debe trabajar el Tutor</span></header>
          <label><span>Tipo de libro</span><select value={bookType || 'essay'} onChange={e => onBookType(e.target.value as NonNullable<BookRecord['type']))}><option value="novel">Novela</option><option value="essay">Ensayo</option><option value="philosophy">Filosofía</option><option value="social_science">Ciencias sociales</option><option value="science">Ciencia</option><option value="academic">Académico</option><option value="manual">Manual</option><option value="study">Estudio</option></select></label>
          <label><span>Política de adelantos</span><select value={settings.spoilerPolicy} onChange={e => set('spoilerPolicy', e.target.value as 'strict' | 'allowed')}><option value="strict">Estricto · solo material alcanzado</option><option value="allowed">Permitir contenido posterior</option></select></label>
        </section>

        <section className="ai-config-card premium-ai-card">
          <div className="ai-config-heading"><div><b>Tutor IA</b><small>Elige potencia según la tarea</small></div><span className={apiKey ? 'ai-dot connected' : 'ai-dot'}/></div>
          <div className="model-tier-grid" role="radiogroup" aria-label="Modelo del Tutor">
            {([
              ['gpt-5.6-luna','Luna','Ágil y económico'],
              ['gpt-5.6-terra','Terra','Equilibrio recomendado'],
              ['gpt-5.6-sol','Sol','Máxima profundidad']
            ] as const).map(([value,title,caption])=><button type="button" role="radio" aria-checked={model===value} key={value} className={model===value?'active':''} onClick={()=>setModel(value)}><strong>{title}</strong><span>{caption}</span></button>)}
          </div>
          <div className="ai-balance-card"><div className="ai-balance-main"><span>Saldo estimado</span><strong>${remaining.toFixed(2)}</strong></div><div className="ai-balance-details"><span>Texto <b>${usage.spentText.toFixed(4)}</b></span><span>Voz/dictado <b>${usage.spentAudio.toFixed(4)}</b></span><span>Consultas <b>{usage.requests}</b></span></div><label className="balance-reference"><span>Crédito de referencia (USD)</span><input type="number" min="0" step="0.01" inputMode="decimal" value={balanceDraft} onChange={e => setBalanceDraft(e.target.value)} onBlur={commitBalance}/></label><small>Estimación local; no sustituye la facturación oficial del proveedor.</small></div>
          <label><span>Clave API de OpenAI</span><input className="api-key-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="off" placeholder="sk-…"/></label>
          <p className="security-note"><b>Sesión privada:</b> la clave se mantiene en almacenamiento de sesión y se elimina al cerrar la sesión del navegador/WebView.</p>
          {aiStatus && <p className="ai-config-status" aria-live="polite">{aiStatus}</p>}
          <div className="ai-config-actions"><button type="button" onClick={() => void connectAi()} disabled={testing}>{testing ? 'Conectando…' : `Conectar ${getAiModelLabel(model)}`}</button><button type="button" className="secondary" onClick={disconnectAi}>Desconectar</button></div>
        </section>
      </div>
    </motion.aside>
  </>}</AnimatePresence>
}
