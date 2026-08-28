import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { clearAiConfig, getAiConfig, getAiUsageLedger, saveAiConfig, setAiStartingBalance, testAiConnection, type AiModel, type AiUsageLedger } from '../lib/ai'
import type { BookRecord, PageMode, ReaderSettings, ThemeMode } from '../types'

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
  const [model, setModel] = useState<AiModel>('gpt-5-mini')
  const [rememberKey, setRememberKey] = useState(false)
  const [aiStatus, setAiStatus] = useState('')
  const [testing, setTesting] = useState(false)
  const [usage, setUsage] = useState<AiUsageLedger>(getAiUsageLedger())
  const [balanceDraft, setBalanceDraft] = useState('5.00')

  useEffect(() => {
    if (!open) return
    const cfg = getAiConfig(), currentUsage = getAiUsageLedger()
    setApiKey(cfg.apiKey); setModel(cfg.model); setRememberKey(cfg.rememberKey)
    setUsage(currentUsage); setBalanceDraft(currentUsage.startingBalance.toFixed(2))
    setAiStatus(cfg.apiKey ? 'Conexión guardada en este dispositivo.' : '')
  }, [open])

  useEffect(() => {
    const update = (event: Event) => setUsage((event as CustomEvent<AiUsageLedger>).detail || getAiUsageLedger())
    window.addEventListener('lectoria-ai-usage', update)
    return () => window.removeEventListener('lectoria-ai-usage', update)
  }, [])

  async function connectAi() {
    const previous = getAiConfig()
    const config = { apiKey: apiKey.trim(), model, rememberKey, responseLength: previous.responseLength }
    if (!config.apiKey) { setAiStatus('Escribe una clave API para conectar el Tutor.'); return }
    setTesting(true); setAiStatus('Comprobando conexión…')
    try {
      const result = await testAiConnection(config)
      saveAiConfig(config); setUsage(getAiUsageLedger()); setAiStatus(result || 'Conexión correcta.')
    } catch (error) { setAiStatus(error instanceof Error ? error.message : 'No se pudo conectar.') }
    finally { setTesting(false) }
  }

  function disconnectAi() {
    clearAiConfig(); setApiKey(''); setRememberKey(false); setAiStatus('Tutor desconectado. Se usará el modo local.')
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

  return <AnimatePresence>{open && <motion.aside className="settings-sheet" initial={{ y: '105%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 370, damping: 34 }}>
    <div className="tutor-grabber"/><header className="side-header"><div><strong>Apariencia y lectura</strong><span>Los cambios se muestran en tiempo real</span></div><button onClick={onClose}>×</button></header>
    <div className="settings-grid">
      <section className="reading-preview-card">
        <div className="reading-preview-label"><b>Vista previa</b><span>{settings.fontSize}% · interlineado {settings.lineHeight.toFixed(2)} · margen {settings.margins}vw</span></div>
        <div className="reading-preview-page" style={{ background: previewPalette.bg, color: previewPalette.fg, paddingInline: `${10 + settings.margins * 1.5}px` }}>
          <strong style={{ fontSize: `${Math.max(14, 18 * settings.fontSize / 100)}px` }}>Una idea cambia cuando cambia la forma de leerla.</strong>
          <p style={{ fontSize: `${Math.max(12, 15 * settings.fontSize / 100)}px`, lineHeight: settings.lineHeight }}>Este ejemplo reacciona al tamaño de letra, interlineado, márgenes y tema para que puedas decidir antes de volver al libro.</p>
          <small style={{ color: previewPalette.muted }}>Lectoria · vista de lectura</small>
        </div>
      </section>

      <label><span>Tamaño de texto <b>{settings.fontSize}%</b></span><input type="range" min="80" max="160" value={settings.fontSize} onChange={e => set('fontSize', Number(e.target.value))}/></label>
      <label><span>Interlineado <b>{settings.lineHeight.toFixed(2)}</b></span><input type="range" min="1.35" max="2.15" step="0.05" value={settings.lineHeight} onChange={e => set('lineHeight', Number(e.target.value))}/></label>
      <label><span>Márgenes <b>{settings.margins}vw</b></span><input type="range" min="3" max="13" step="1" value={settings.margins} onChange={e => set('margins', Number(e.target.value))}/></label>
      <label><span>Velocidad de voz <b>{settings.ttsRate.toFixed(1)}×</b></span><input type="range" min="0.7" max="1.7" step="0.1" value={settings.ttsRate} onChange={e => set('ttsRate', Number(e.target.value))}/></label>
      <label><span>Tema</span><select value={settings.theme} onChange={e => set('theme', e.target.value as ThemeMode)}><option value="paper">Papel</option><option value="sepia">Sepia</option><option value="dark">Oscuro</option><option value="oled">OLED</option></select></label>
      <label><span>Navegación</span><select value={settings.pageMode} onChange={e => set('pageMode', e.target.value as PageMode)}><option value="curl">Página física</option><option value="slide">Deslizamiento</option><option value="scroll">Desplazamiento continuo</option></select></label>
      <label><span>Tipo de libro</span><select value={bookType || 'essay'} onChange={e => onBookType(e.target.value as NonNullable<BookRecord['type']>)}><option value="novel">Novela</option><option value="essay">Ensayo</option><option value="philosophy">Filosofía</option><option value="social_science">Ciencias sociales</option><option value="science">Ciencia</option><option value="academic">Académico</option><option value="manual">Manual</option><option value="study">Estudio</option></select></label>
      <label><span>Política de adelantos</span><select value={settings.spoilerPolicy} onChange={e => set('spoilerPolicy', e.target.value as 'strict' | 'allowed')}><option value="strict">No usar contenido posterior</option><option value="allowed">Permitir contenido posterior</option></select></label>
      <label className="toggle-row"><span><b>Previa hablada automática</b><small>Antes de cada nueva página o ubicación</small></span><input type="checkbox" checked={settings.prepAudio} onChange={e => set('prepAudio', e.target.checked)}/></label>

      <section className="ai-config-card">
        <div className="ai-config-heading"><div><b>Tutor IA</b><small>Conexión generativa para análisis profundo</small></div><span className={apiKey ? 'ai-dot connected' : 'ai-dot'}/></div>
        <div className="ai-balance-card">
          <div className="ai-balance-main"><span>Saldo estimado</span><strong>${remaining.toFixed(2)}</strong></div>
          <div className="ai-balance-details"><span>Gastado en texto <b>${usage.spentText.toFixed(4)}</b></span><span>Voz y dictado estimados <b>${usage.spentAudio.toFixed(4)}</b></span><span>Consultas registradas <b>{usage.requests}</b></span></div>
          <label className="balance-reference"><span>Crédito de referencia (USD)</span><input type="number" min="0" step="0.01" inputMode="decimal" value={balanceDraft} onChange={e => setBalanceDraft(e.target.value)} onBlur={commitBalance}/></label>
          <small>Estimación local del consumo generado por Lectoria; no sustituye el saldo oficial de OpenAI.</small>
        </div>
        <label><span>Modelo</span><select value={model} onChange={e => setModel(e.target.value as AiModel)}><option value="gpt-5-mini">GPT-5 mini · recomendado</option><option value="gpt-5">GPT-5 · mayor profundidad</option></select></label>
        <label><span>Clave API de OpenAI</span><input className="api-key-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="off" placeholder="sk-…"/></label>
        <label className="toggle-row ai-remember"><span><b>Recordar clave</b><small>Prototipo personal. Para la versión final usaremos un servidor seguro.</small></span><input type="checkbox" checked={rememberKey} onChange={e => setRememberKey(e.target.checked)}/></label>
        {aiStatus && <p className="ai-config-status">{aiStatus}</p>}
        <div className="ai-config-actions"><button type="button" onClick={() => void connectAi()} disabled={testing}>{testing ? 'Conectando…' : 'Conectar y probar'}</button><button type="button" className="secondary" onClick={disconnectAi}>Desconectar</button></div>
      </section>
    </div>
  </motion.aside>}</AnimatePresence>
}
