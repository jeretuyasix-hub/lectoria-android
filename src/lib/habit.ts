import { LocalNotifications } from '@capacitor/local-notifications'
import { db } from './db'
import type { HabitSettings, ReadingSessionRecord } from '../types'

export const DEFAULT_HABIT_SETTINGS: HabitSettings = {
  enabled: true,
  dailyGoalMinutes: 20,
  reminderTime: '19:30',
  secondReminderTime: '21:00',
  secondReminderEnabled: false,
  maxSessionMinutes: 60,
  reentryHours: 72,
  quietStart: '22:30',
  quietEnd: '07:00',
  motivationalNudges: true,
  reminderText: 'Tu libro sigue donde lo dejaste. ¿Leemos un poco?'
}

const PREF_KEY = 'habit-settings-v1'

export async function getHabitSettings(): Promise<HabitSettings> {
  const pref = await db.preferences.get(PREF_KEY)
  if (!pref) return DEFAULT_HABIT_SETTINGS
  try { return { ...DEFAULT_HABIT_SETTINGS, ...JSON.parse(pref.value) } }
  catch { return DEFAULT_HABIT_SETTINGS }
}

export async function saveHabitSettings(settings: HabitSettings) {
  await db.preferences.put({ key: PREF_KEY, value: JSON.stringify(settings), updatedAt: Date.now() })
  await syncNativeReminderSchedule(settings)
}

function localDateKey(time = Date.now()) {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function startReadingSession(bookId: string): Promise<number | undefined> {
  return db.readingSessions.add({ bookId, startedAt: Date.now(), minutes: 0 })
}

export async function finishReadingSession(id: number | undefined, startedAt: number) {
  if (!id) return
  const endedAt = Date.now()
  const minutes = Math.max(1, Math.round((endedAt - startedAt) / 60000))
  await db.readingSessions.update(id, { endedAt, minutes })
}

export async function getTodayMinutes() {
  const today = localDateKey()
  const rows = await db.readingSessions.toArray()
  return rows.filter(row => localDateKey(row.startedAt) === today).reduce((sum, row) => sum + Math.max(0, row.minutes || 0), 0)
}

export async function getHabitStats(settings?: HabitSettings) {
  const cfg = settings || await getHabitSettings()
  const sessions = await db.readingSessions.toArray()
  const totals = new Map<string, number>()
  for (const row of sessions) {
    const key = localDateKey(row.startedAt)
    totals.set(key, (totals.get(key) || 0) + Math.max(0, row.minutes || 0))
  }
  const today = localDateKey()
  const todayMinutes = totals.get(today) || 0
  let streak = 0
  const cursor = new Date()
  for (let i = 0; i < 3650; i++) {
    const key = localDateKey(cursor.getTime())
    const minutes = totals.get(key) || 0
    if (minutes >= cfg.dailyGoalMinutes) streak += 1
    else if (i === 0) {
      // During the current day, yesterday's streak is still alive until the day ends.
    } else break
    cursor.setDate(cursor.getDate() - 1)
  }
  return {
    todayMinutes,
    dailyGoalMinutes: cfg.dailyGoalMinutes,
    progress: Math.min(1, todayMinutes / Math.max(1, cfg.dailyGoalMinutes)),
    streak
  }
}

export async function requestReminderPermission() {
  if (!('Notification' in window)) return 'unsupported' as const
  if (Notification.permission === 'granted') return 'granted' as const
  if (Notification.permission === 'denied') return 'denied' as const
  return Notification.requestPermission()
}

function inQuietHours(now: Date, settings: HabitSettings) {
  const minute = now.getHours() * 60 + now.getMinutes()
  const toMin = (value: string) => {
    const [h, m] = value.split(':').map(Number)
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
  }
  const start = toMin(settings.quietStart)
  const end = toMin(settings.quietEnd)
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end
}

function dueAt(now: Date, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return now.getHours() === h && now.getMinutes() === m
}

async function showBrowserReminder(settings: HabitSettings) {
  if (!settings.enabled || inQuietHours(new Date(), settings)) return
  const stats = await getHabitStats(settings)
  if (stats.todayMinutes >= settings.dailyGoalMinutes) return
  const remaining = Math.max(1, settings.dailyGoalMinutes - stats.todayMinutes)
  const body = `${settings.reminderText} Te faltan ${remaining} min para tu meta de hoy.`
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready
        await registration.showNotification('Lector IA · momento de leer', { body, tag: 'lector-ia-daily-reminder' })
      } else new Notification('Lector IA · momento de leer', { body, tag: 'lector-ia-daily-reminder' })
    } catch { /* noop */ }
  }
  window.dispatchEvent(new CustomEvent('lector-ia-reminder', { detail: { body } }))
}

export async function getOpeningNudge(settings: HabitSettings) {
  if (!settings.enabled || inQuietHours(new Date(), settings)) return ''
  const stats = await getHabitStats(settings)
  if (stats.todayMinutes >= settings.dailyGoalMinutes) return ''
  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()
  const [rh, rm] = settings.reminderTime.split(':').map(Number)
  const reminder = rh * 60 + rm
  if (current < reminder) return ''
  const remaining = Math.max(1, settings.dailyGoalMinutes - stats.todayMinutes)
  if (settings.motivationalNudges && stats.streak > 0) return `Tu continuidad sigue viva: te faltan ${remaining} min para completar la meta de hoy.`
  return `${settings.reminderText} Te faltan ${remaining} min para tu meta de hoy.`
}

export function startReminderEngine(settings: HabitSettings) {
  let lastKey = ''
  const check = () => {
    const now = new Date()
    const key = `${localDateKey(now.getTime())}-${now.getHours()}:${now.getMinutes()}`
    if (key === lastKey) return
    const due = dueAt(now, settings.reminderTime) || (settings.secondReminderEnabled && dueAt(now, settings.secondReminderTime))
    if (due) { lastKey = key; void showBrowserReminder(settings) }
  }
  check()
  const timer = window.setInterval(check, 30000)
  return () => window.clearInterval(timer)
}

export async function syncNativeReminderSchedule(settings: HabitSettings) {
  try {
    const permission = await LocalNotifications.requestPermissions()
    if (permission?.display !== 'granted') return false
    await LocalNotifications.cancel({ notifications: [{ id: 7101 }, { id: 7102 }] })
    if (!settings.enabled) return true
    const build = (id: number, hhmm: string) => {
      const [hour, minute] = hhmm.split(':').map(Number)
      return {
        id,
        title: 'Lectoria · momento de leer',
        body: settings.reminderText,
        schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
        extra: { route: 'library' }
      }
    }
    const notifications = [build(7101, settings.reminderTime)]
    if (settings.secondReminderEnabled) notifications.push(build(7102, settings.secondReminderTime))
    await LocalNotifications.schedule({ notifications })
    return true
  } catch {
    return false
  }
}

export function sessionMinutesSince(startedAt: number) {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 60000))
}

export function formatMinutes(value: number) {
  if (value < 60) return `${value} min`
  const h = Math.floor(value / 60)
  const m = value % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export async function recentSessions(bookId?: string): Promise<ReadingSessionRecord[]> {
  const rows = bookId ? await db.readingSessions.where('bookId').equals(bookId).toArray() : await db.readingSessions.toArray()
  return rows.sort((a, b) => b.startedAt - a.startedAt).slice(0, 40)
}
