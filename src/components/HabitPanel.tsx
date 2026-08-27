import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { DEFAULT_HABIT_SETTINGS, getHabitSettings, requestReminderPermission, saveHabitSettings } from '../lib/habit'
import type { HabitSettings } from '../types'

export default function HabitPanel({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (settings: HabitSettings) => void }) {
  const [settings, setSettings] = useState<HabitSettings>(DEFAULT_HABIT_SETTINGS)
  const [permission, setPermission] = useState<string>('')
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (open) void getHabitSettings().then(setSettings) }, [open])

  async function persist() {
    const next = {
      ...settings,
      dailyGoalMinutes: Math.max(5, Math.min(240, settings.dailyGoalMinutes)),
      maxSessionMinutes: Math.max(0, Math.min(360, settings.maxSessionMinutes)),
      reentryHours: Math.max(1, Math.min(720, settings.reentryHours))
    }
    setSettings(next); await saveHabitSettings(next); onSaved?.(next); setSaved(true); window.setTimeout(() => setSaved(false), 1600)
  }

  async function enableNotifications() {
    const result = await requestReminderPermission()
    setPermission(result)
    if (result === 'granted') await persist()
  }

  return <AnimatePresence>{open && <motion.aside className="habit-panel side-panel" initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }} transition={{ type: 'spring', stiffness: 340, damping: 34 }}>
    <header className="panel-header"><div><div className="eyebrow">HÁBITO DE LECTURA</div><h2>Metas y recordatorios</h2><p>Incentivos discretos: sin convertir la lectura en una colección de puntos.</p></div><button onClick={onClose} aria-label="Cerrar">×</button></header>
    <div className="habit-content">
      <label className="habit-switch"><input type="checkbox" checked={settings.enabled} onChange={e => setSettings(s => ({ ...s, enabled: e.target.checked }))}/><span><strong>Recordatorios de lectura</strong><small>Pueden pausarse en cualquier momento.</small></span></label>

      <section className="habit-card"><h3>Meta diaria</h3><div className="number-setting"><input type="number" min="5" max="240" value={settings.dailyGoalMinutes} onChange={e => setSettings(s => ({ ...s, dailyGoalMinutes: Number(e.target.value) }))}/><span>minutos al día</span></div><p>La racha solo cuenta cuando alcanzas tu propia meta.</p></section>

      <section className="habit-card"><h3>Hora de lectura</h3><label>Primer recordatorio <input type="time" value={settings.reminderTime} onChange={e => setSettings(s => ({ ...s, reminderTime: e.target.value }))}/></label><label className="habit-switch compact"><input type="checkbox" checked={settings.secondReminderEnabled} onChange={e => setSettings(s => ({ ...s, secondReminderEnabled: e.target.checked }))}/><span>Segundo recordatorio</span></label>{settings.secondReminderEnabled && <label>Segundo aviso <input type="time" value={settings.secondReminderTime} onChange={e => setSettings(s => ({ ...s, secondReminderTime: e.target.value }))}/></label>}</section>

      <section className="habit-card"><h3>Límite de sesión</h3><div className="number-setting"><input type="number" min="0" max="360" value={settings.maxSessionMinutes} onChange={e => setSettings(s => ({ ...s, maxSessionMinutes: Number(e.target.value) }))}/><span>minutos</span></div><p>Al llegar al límite, la app te propone cerrar la sesión. No bloquea el libro.</p></section>

      <section className="habit-card"><h3>Reentrada inteligente</h3><div className="number-setting"><input type="number" min="1" max="720" value={settings.reentryHours} onChange={e => setSettings(s => ({ ...s, reentryHours: Number(e.target.value) }))}/><span>horas sin leer</span></div><p>Después de ese tiempo aparecerá “Recuérdame dónde estaba” con notas, preguntas, subrayados y pendientes.</p></section>

      <section className="habit-card"><h3>Horas silenciosas</h3><div className="time-pair"><label>Desde <input type="time" value={settings.quietStart} onChange={e => setSettings(s => ({ ...s, quietStart: e.target.value }))}/></label><label>Hasta <input type="time" value={settings.quietEnd} onChange={e => setSettings(s => ({ ...s, quietEnd: e.target.value }))}/></label></div></section>

      <section className="habit-card"><h3>Mensaje</h3><textarea rows={3} maxLength={180} value={settings.reminderText} onChange={e => setSettings(s => ({ ...s, reminderText: e.target.value }))}/><label className="habit-switch compact"><input type="checkbox" checked={settings.motivationalNudges} onChange={e => setSettings(s => ({ ...s, motivationalNudges: e.target.checked }))}/><span>Mensajes de continuidad y racha</span></label></section>

      <div className="notification-note"><strong>Android:</strong> al empaquetar la app con Capacitor, estos horarios se conectan a notificaciones locales reales del teléfono. En la versión web/PWA, el navegador solo puede garantizar avisos mientras la aplicación está activa o cuando vuelves a abrirla.</div>
      <div className="habit-actions"><button className="secondary-button" onClick={() => void enableNotifications()}>Permitir notificaciones</button><button className="import-button" onClick={() => void persist()}>{saved ? 'Guardado ✓' : 'Guardar hábitos'}</button></div>
      {permission && permission !== 'granted' && <p className="muted">Estado de notificaciones: {permission}</p>}
    </div>
  </motion.aside>}</AnimatePresence>
}
