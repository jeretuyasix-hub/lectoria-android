import { AnimatePresence, motion } from 'framer-motion'
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
  return <AnimatePresence>{open && <motion.aside className="settings-sheet" initial={{ y: '105%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 370, damping: 34 }}>
    <div className="tutor-grabber"/><header className="side-header"><div><strong>Apariencia y lectura</strong><span>Preferencias guardadas en este dispositivo</span></div><button onClick={onClose}>×</button></header>
    <div className="settings-grid">
      <label><span>Tamaño de texto <b>{settings.fontSize}%</b></span><input type="range" min="80" max="160" value={settings.fontSize} onChange={e => set('fontSize', Number(e.target.value))}/></label>
      <label><span>Interlineado <b>{settings.lineHeight.toFixed(2)}</b></span><input type="range" min="1.35" max="2.15" step="0.05" value={settings.lineHeight} onChange={e => set('lineHeight', Number(e.target.value))}/></label>
      <label><span>Márgenes <b>{settings.margins}vw</b></span><input type="range" min="3" max="13" step="1" value={settings.margins} onChange={e => set('margins', Number(e.target.value))}/></label>
      <label><span>Velocidad de voz <b>{settings.ttsRate.toFixed(1)}×</b></span><input type="range" min="0.7" max="1.7" step="0.1" value={settings.ttsRate} onChange={e => set('ttsRate', Number(e.target.value))}/></label>
      <label><span>Tema</span><select value={settings.theme} onChange={e => set('theme', e.target.value as ThemeMode)}><option value="paper">Papel</option><option value="sepia">Sepia</option><option value="dark">Oscuro</option><option value="oled">OLED</option></select></label>
      <label><span>Navegación</span><select value={settings.pageMode} onChange={e => set('pageMode', e.target.value as PageMode)}><option value="curl">Página física</option><option value="slide">Deslizamiento</option><option value="scroll">Scroll continuo</option></select></label>
      <label><span>Tipo de libro</span><select value={bookType || 'essay'} onChange={e => onBookType(e.target.value as NonNullable<BookRecord['type']>)}><option value="novel">Novela</option><option value="essay">Ensayo</option><option value="philosophy">Filosofía</option><option value="social_science">Ciencias sociales</option><option value="science">Ciencia</option><option value="academic">Académico</option><option value="manual">Manual</option><option value="study">Estudio</option></select></label>
      <label><span>Política de spoilers</span><select value={settings.spoilerPolicy} onChange={e => set('spoilerPolicy', e.target.value as 'strict' | 'allowed')}><option value="strict">No usar contenido posterior</option><option value="allowed">Permitir contenido posterior</option></select></label>
      <label className="toggle-row"><span><b>Previa hablada automática</b><small>Antes de cada nueva página o ubicación</small></span><input type="checkbox" checked={settings.prepAudio} onChange={e => set('prepAudio', e.target.checked)}/></label>
    </div>
  </motion.aside>}</AnimatePresence>
}
