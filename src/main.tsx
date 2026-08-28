import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './page-turn.css'
import './mobile-fixes.css'
import './mobile-v4.css'
import './android-input-fix.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)

type ReaderTheme = 'paper' | 'sepia' | 'dark' | 'oled'
const themedFrames = new WeakSet<HTMLIFrameElement>()

function currentReaderTheme(): ReaderTheme {
  const value = document.documentElement.dataset.readerTheme
  return value === 'sepia' || value === 'dark' || value === 'oled' ? value : 'paper'
}

function readerPalette(theme: ReaderTheme) {
  if (theme === 'oled') return { bg: '#000000', fg: '#f4f4f2', muted: '#c8cec9', link: '#7fd7b8', selection: '#235f50' }
  if (theme === 'dark') return { bg: '#17211d', fg: '#edf1ee', muted: '#c2cbc6', link: '#83d2b6', selection: '#315f51' }
  if (theme === 'sepia') return { bg: '#efe2c7', fg: '#352d22', muted: '#685f51', link: '#386b58', selection: '#d6c399' }
  return { bg: '#fbf7ed', fg: '#211f1b', muted: '#62665f', link: '#246a55', selection: '#bfe1d5' }
}

function applyThemeInsideEpub(doc: Document) {
  try {
    const theme = currentReaderTheme()
    const p = readerPalette(theme)
    const dark = theme === 'dark' || theme === 'oled'
    let style = doc.getElementById('lectoria-epub-theme') as HTMLStyleElement | null
    if (!style) {
      style = doc.createElement('style')
      style.id = 'lectoria-epub-theme'
      ;(doc.head || doc.documentElement).appendChild(style)
    }
    style.textContent = `:root{color-scheme:${dark ? 'dark' : 'light'}!important;background:${p.bg}!important;color:${p.fg}!important}html,body{background:${p.bg}!important;color:${p.fg}!important}body,p,div,span,li,dt,dd,blockquote,figcaption,h1,h2,h3,h4,h5,h6,em,strong,b,i,small,sub,sup,td,th,caption,label{color:${p.fg}!important}a,a:visited{color:${p.link}!important}hr{border-color:${p.muted}!important}code,pre{color:${p.fg}!important;background:${theme === 'oled' ? '#0b0b0b' : theme === 'dark' ? '#202b26' : 'rgba(80,70,50,.06)'}!important}::selection{background:${p.selection}!important;color:${dark ? '#fff' : '#172c25'}!important}`
    doc.documentElement.style.backgroundColor = p.bg
    if (doc.body) { doc.body.style.backgroundColor = p.bg; doc.body.style.color = p.fg }
  } catch { /* no romper la lectura por un EPUB atípico */ }
}

function applyReaderThemeToFrames() {
  document.querySelectorAll<HTMLIFrameElement>('.epub-viewer iframe').forEach(frame => {
    try { if (frame.contentDocument) applyThemeInsideEpub(frame.contentDocument) } catch { /* noop */ }
    if (themedFrames.has(frame)) return
    themedFrames.add(frame)
    frame.addEventListener('load', () => {
      try { if (frame.contentDocument) applyThemeInsideEpub(frame.contentDocument) } catch { /* noop */ }
    })
  })
}

function startReaderThemeRuntime() {
  applyReaderThemeToFrames()
  new MutationObserver(() => applyReaderThemeToFrames()).observe(document.body, { childList: true, subtree: true })
  new MutationObserver(records => {
    if (records.some(record => record.attributeName === 'data-reader-theme')) applyReaderThemeToFrames()
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-reader-theme'] })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startReaderThemeRuntime, { once: true })
else startReaderThemeRuntime()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`) })
}
