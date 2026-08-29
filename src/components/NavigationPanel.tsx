import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { searchBook } from '../lib/rag'
import type { SearchResult, TocItem } from '../types'

type NavTarget={href?:string;progress?:number}
function TocRows({ items, onNavigate, depth = 0 }: { items: TocItem[]; onNavigate: (target: NavTarget) => void; depth?: number }) {
  return <>{items.map((item, index) => <div key={`${item.href}-${index}`}><button className="toc-row" style={{ paddingLeft: `${14 + depth * 16}px` }} onClick={() => onNavigate({href:item.href})}>{item.label}</button>{item.subitems?.length ? <TocRows items={item.subitems} onNavigate={onNavigate} depth={depth + 1} /> : null}</div>)}</>
}

export default function NavigationPanel({ open, onClose, toc, bookId, progress, strictSpoilers, onNavigate }: {
  open: boolean; onClose: () => void; toc: TocItem[]; bookId: string; progress: number; strictSpoilers: boolean; onNavigate: (target: NavTarget) => void
}) {
  const [tab, setTab] = useState<'toc' | 'search'>('toc'),[query,setQuery]=useState(''),[results,setResults]=useState<SearchResult[]>([]),[loading,setLoading]=useState(false),[searched,setSearched]=useState(false),[error,setError]=useState('')
  const searchSeq=useRef(0),debounce=useRef<number|undefined>(undefined)

  async function search(raw=query) {
    const q=raw.trim(),seq=++searchSeq.current
    if (q.length<2){setResults([]);setSearched(false);setError('');setLoading(false);return}
    setLoading(true);setError('');setSearched(false)
    try{const next=await searchBook(bookId,q,progress,strictSpoilers,24);if(seq!==searchSeq.current)return;setResults(next);setSearched(true)}
    catch{if(seq!==searchSeq.current)return;setResults([]);setSearched(true);setError('No se pudo buscar en el índice local. Inténtalo nuevamente.')}
    finally{if(seq===searchSeq.current)setLoading(false)}
  }
  function changeQuery(value:string){setQuery(value);setSearched(false);setError('');window.clearTimeout(debounce.current);if(value.trim().length>=2)debounce.current=window.setTimeout(()=>void search(value),240);else{searchSeq.current+=1;setResults([]);setLoading(false)}}
  useEffect(()=>()=>window.clearTimeout(debounce.current),[])

  function go(target:NavTarget){onNavigate(target);onClose()}
  return <AnimatePresence>{open&&<><motion.button className="panel-backdrop" aria-label="Cerrar navegación" onClick={onClose} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}/><motion.aside role="dialog" aria-modal="true" aria-label="Navegación del libro" tabIndex={-1} className="side-panel navigation-panel premium-side-panel" initial={{ x: '-105%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '-105%', opacity: 0 }} transition={{ type: 'spring', stiffness: 390, damping: 38, mass:.82 }}>
    <header className="side-header"><div><strong>Navegación</strong><span>Índice, búsqueda y posición</span></div><button onClick={onClose} aria-label="Cerrar navegación">×</button></header>
    <div className="segmented premium-segmented" role="tablist"><button role="tab" aria-selected={tab==='toc'} className={tab==='toc'?'active':''} onClick={()=>setTab('toc')}>Contenido</button><button role="tab" aria-selected={tab==='search'} className={tab==='search'?'active':''} onClick={()=>setTab('search')}>Buscar</button></div>
    {tab==='toc'?<div className="toc-list">{toc.length?<TocRows items={toc} onNavigate={go}/>:<p className="muted">Este EPUB no proporciona un índice navegable.</p>}</div>:<div className="search-pane">
      <div className="search-scope"><span>{strictSpoilers?'🔒 Solo material alcanzado':'Contenido completo permitido'}</span><b>{Math.round(progress*100)}%</b></div>
      <form className="search-form premium-search" onSubmit={e=>{e.preventDefault();void search()}}><input autoFocus value={query} onChange={e=>changeQuery(e.target.value)} placeholder="Concepto, frase o idea…" aria-label="Buscar dentro del libro"/><button disabled={loading||query.trim().length<2}>{loading?'…':'Buscar'}</button></form>
      <div className="search-results" aria-live="polite">{loading&&<div className="search-loading"><i/><i/><i/><span>Buscando en el texto…</span></div>}{error&&<p className="muted">{error}</p>}{!loading&&results.map((r,i)=><motion.button key={`${r.id??r.href}-${i}`} className="search-result premium-search-result" onClick={()=>go({href:r.href,progress:r.progress})} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:Math.min(.16,i*.018)}}><div><strong>{r.chapterLabel||'Resultado'}</strong><small>{Math.round(r.progress*100)}%</small></div><span>{r.text.slice(0,260)}{r.text.length>260?'…':''}</span></motion.button>)}{!loading&&searched&&!error&&!results.length&&<p className="muted">Sin coincidencias en el índice local.</p>}{!loading&&!searched&&query.trim().length<2&&<p className="muted">Escribe al menos dos caracteres. La búsqueda es local y funciona sin conexión.</p>}</div>
    </div>}
  </motion.aside></>}</AnimatePresence>
}
