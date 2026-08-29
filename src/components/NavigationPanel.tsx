import { AnimatePresence, motion } from 'framer-motion'
import { useRef, useState } from 'react'
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
  const [loading,setLoading]=useState(false)
  const [searched,setSearched]=useState(false)
  const [error,setError]=useState('')
  const searchSeq=useRef(0)

  async function search() {
    const q=query.trim(),seq=++searchSeq.current
    if (!q){setResults([]);setSearched(false);setError('');return}
    setLoading(true);setError('');setSearched(false)
    try{
      const next=await searchBook(bookId,q,progress,strictSpoilers,20)
      if(seq!==searchSeq.current)return
      setResults(next);setSearched(true)
    }catch{
      if(seq!==searchSeq.current)return
      setResults([]);setSearched(true);setError('No se pudo buscar en el índice local. Inténtalo nuevamente.')
    }finally{if(seq===searchSeq.current)setLoading(false)}
  }

  return <AnimatePresence>{open && <motion.aside role="dialog" aria-modal="true" aria-label="Navegación del libro" tabIndex={-1} className="side-panel navigation-panel" initial={{ x: '-105%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '-105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 370, damping: 35 }}>
    <header className="side-header"><div><strong>Navegación</strong><span>Índice y búsqueda del libro</span></div><button onClick={onClose} aria-label="Cerrar navegación">×</button></header>
    <div className="segmented" role="tablist"><button role="tab" aria-selected={tab==='toc'} className={tab === 'toc' ? 'active' : ''} onClick={() => setTab('toc')}>Contenido</button><button role="tab" aria-selected={tab==='search'} className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Buscar</button></div>
    {tab === 'toc' ? <div className="toc-list">{toc.length?<TocRows items={toc} onNavigate={href => { onNavigate(href); onClose() }} />:<p className="muted">Este EPUB no proporciona un índice navegable.</p>}</div> : <div className="search-pane">
      <form className="search-form" onSubmit={e => { e.preventDefault(); void search() }}><input value={query} onChange={e => {setQuery(e.target.value);setSearched(false);setError('')}} placeholder="Concepto, frase o idea…" aria-label="Buscar dentro del libro"/><button disabled={loading}>{loading?'Buscando…':'Buscar'}</button></form>
      <div className="search-results" aria-live="polite">{loading&&<p className="muted">Buscando en lo leído…</p>}{error&&<p className="muted">{error}</p>}{!loading&&results.map((r, i) => <button key={`${r.href}-${i}`} className="search-result" onClick={() => { onNavigate(r.href); onClose() }}><strong>{r.chapterLabel||'Resultado'}</strong><span>{r.text.slice(0, 220)}{r.text.length>220?'…':''}</span></button>)}{!loading&&searched&&!error&&!results.length&&<p className="muted">Sin coincidencias en el índice local.</p>}</div>
    </div>}
  </motion.aside>}</AnimatePresence>
}
