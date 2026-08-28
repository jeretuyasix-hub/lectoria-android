import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './page-turn.css'
import './mobile-fixes.css'
import './mobile-v4.css'
import './mobile-v6.css'
import './mobile-v7.css'
import './reader-minimal.css'
import './android-input-fix.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)

type ReaderTheme = 'paper' | 'sepia' | 'dark' | 'oled'

function palette(theme: ReaderTheme) {
  if (theme === 'oled') return { bg: '#000000', fg: '#f4f4f1', link: '#80d8bd', selection: '#2d7e66aa', code: '#101713' }
  if (theme === 'dark') return { bg: '#17211d', fg: '#edf1ee', link: '#79cfb5', selection: '#2b725c99', code: '#101713' }
  if (theme === 'sepia') return { bg: '#efe2c8', fg: '#3f3326', link: '#255f50', selection: '#d8b96580', code: '#e1d1b3' }
  return { bg: '#fbf7ed', fg: '#17342b', link: '#1f6d56', selection: '#82cbb080', code: '#f0eadf' }
}

function applyReaderTheme(doc: Document, theme: ReaderTheme) {
  const p = palette(theme)
  let style = doc.getElementById('lectoria-reader-theme') as HTMLStyleElement | null
  if (!style) { style = doc.createElement('style'); style.id = 'lectoria-reader-theme'; (doc.head || doc.documentElement).appendChild(style) }
  style.textContent = `
    html, body { background: ${p.bg} !important; color: ${p.fg} !important; }
    body, p, div, span, section, article, li, h1, h2, h3, h4, h5, h6, blockquote, td, th { color: ${p.fg} !important; }
    a { color: ${p.link} !important; }
    code, pre { background: ${p.code} !important; color: ${p.fg} !important; }
    ::selection { background: ${p.selection} !important; color: ${p.fg} !important; }
  `
  doc.documentElement.style.background = p.bg
  if (doc.body) { doc.body.style.background = p.bg; doc.body.style.color = p.fg }
}

function currentTheme(): ReaderTheme {
  const value = document.documentElement.dataset.readerTheme
  return value === 'oled' || value === 'dark' || value === 'sepia' ? value : 'paper'
}

function syncThemeToFrames() {
  const theme = currentTheme()
  document.querySelectorAll('iframe').forEach(frame => { try { const doc = (frame as HTMLIFrameElement).contentDocument; if (doc) applyReaderTheme(doc, theme) } catch {} })
}

const observer = new MutationObserver(() => syncThemeToFrames())
observer.observe(document.documentElement, { subtree: true, childList: true })
window.setInterval(syncThemeToFrames, 850)
