import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { searchBook } from '../lib/rag'
import type { SearchResult, TocItem } from '../types'

function TocRows({ items, onNavigate, depth = 0 }: { items: TocItem[]; onNavigate: (href: string) => void; depth?: number }) {
  return <>{items.map((item, index) => <div key={`${item.href}-${index}`}>
    <button className="toc-row" style={{ paddingLeft: `${14 + depth * 16}px` }} onClick={() => onNavigate(item.href)}>{item.label}</button>
    {item.subitems?.length ? <TocRows items={item.subitems} onNavigate={onNavigate} depth={depth + 1} /> : null}
  </div>)}</>
}

export default function NavigationPanel({ open, onClose, toc, bookId, progress, strictSpoilers, onNavigate }: {
  open: boolean
  onClose: () => void
  toc: TocItem[]
  bookId: string
  progress: number
  strictSpoilers: boolean
  onNavigate: (href: string) => void
}) {
  const [tab, setTab] = useState<'toc' | 'search'>('toc')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])

  async function search() {
    if (!query.trim()) return setResults([])
    setResults(await searchBook(bookId, query, progress, strictSpoilers, 20))
  }

  return <AnimatePresence>{open && <motion.aside className="side-panel navigation-panel" initial={{ x: '-105%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '-105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 370, damping: 35 }}>
    <header className="side-header"><div><strong>Navegación</strong><span>Índice y búsqueda del libro</span></div><button onClick={onClose}>×</button></header>
    <div className="segmented"><button className={tab === 'toc' ? 'active' : ''} onClick={() => setTab('toc')}>Contenido</button><button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Buscar</button></div>
    {tab === 'toc' ? <div className="toc-list"><TocRows items={toc} onNavigate={href => { onNavigate(href); onClose() }} /></div> : <div className="search-pane">
      <form className="search-form" onSubmit={e => { e.preventDefault(); void search() }}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Concepto, frase o idea…"/><button>Buscar</button></form>
      <div className="search-results">{results.map((r, i) => <button key={`${r.href}-${i}`} className="search-result" onClick={() => { onNavigate(r.href); onClose() }}><strong>{r.chapterLabel}</strong><span>{r.text.slice(0, 220)}…</span></button>)}{query && !results.length && <p className="muted">Sin coincidencias en el índice local.</p>}</div>
    </div>}
  </motion.aside>}</AnimatePresence>
}
