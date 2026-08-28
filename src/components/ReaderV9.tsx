import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { db } from '../lib/db'
import { speakInstant } from '../lib/tts'
import type { BookRecord, HighlightCategory } from '../types'
import NavigationPanel from './NavigationPanel'
import NotebookPanel from './NotebookPanel'
import StudyPanel from './StudyPanel'
import SettingsPanel from './SettingsPanel'
import TutorPanel from './TutorPanel'
import ReadingHistoryPanel from './ReadingHistoryPanel'
import { ReaderControls, ReaderProgress, type ControlItem } from './ReaderControls'
import { useReaderEngine } from './useReaderEngine'

const COLORS=['#F5D547','#7ED9A8','#79B8FF','#F39AB5','#C7A6FF','#FFB46A','#B5E4E8','#D8D8D8']
const LABELS:Record<HighlightCategory,string>={idea:'Idea',concept:'Concepto',question:'Pregunta',quote:'Cita',argument:'Argumento',evidence:'Evidencia',contradiction:'Contradicción'}
type SelectionIcon='highlight'|'question'|'audio'|'note'|'close'
function SelectionActionIcon({name}:{name:SelectionIcon}){
  const common={width:24,height:24,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.9,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,'aria-hidden':true}
  if(name==='highlight')return <svg {...common}><path d="m5 15 7.8-7.8 4 4L9 19H5v-4Z"/><path d="m14.5 5.5 4 4M4 21h16"/></svg>
  if(name==='question')return <svg {...common}><path d="M20 11.2a7.8 7.8 0 0 1-8 7.6 9.5 9.5 0 0 1-3.2-.55L4 20l1.45-4.05A7.2 7.2 0 0 1 4 11.2a7.8 7.8 0 0 1 8-7.6 7.8 7.8 0 0 1 8 7.6Z"/><path d="M9.8 9a2.35 2.35 0 1 1 3.65 1.96c-.9.58-1.45 1.05-1.45 2.04M12 16h.01"/></svg>
  if(name==='audio')return <svg {...common}><path d="M5 10v4h3l4 3V7l-4 3H5Z"/><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10"/></svg>
  if(name==='note')return <svg {...common}><path d="M5 4h10l4 4v12H5V4Z"/><path d="M14 4v5h5M8 13h8M8 16h6"/></svg>
  return <svg {...common}><path d="M6 6l12 12M18 6 6 18"/></svg>
}

export default function ReaderV9({bookRecord,onBack}:{bookRecord:BookRecord;onBack:()=>void}){
  const [controls,setControls]=useState(false),[tutor,setTutor]=useState(false),[nav,setNav]=useState(false),[notes,setNotes]=useState(false),[study,setStudy]=useState(false),[prefs,setPrefs]=useState(false),[history,setHistory]=useState(false)
  const [highlightMenu,setHighlightMenu]=useState(false),[color,setColor]=useState('#F5D547'),[opacity,setOpacity]=useState(.5),[category,setCategory]=useState<HighlightCategory>('idea')
  const e=useReaderEngine(bookRecord,()=>setControls(v=>!v),()=>setHistory(true))
  async function addNote(){const n=window.prompt('Nota sobre este fragmento:')?.trim();if(n)await e.saveHighlight('idea',color,opacity,n)}
  const close=()=>setControls(false)
  const items:ControlItem[]=[
    {label:'Volver',icon:'back',action:onBack},{label:'Índice',icon:'contents',action:()=>{setNav(true);close()}},{label:'Historia',icon:'history',action:()=>{setHistory(true);close()}},{label:'Cuaderno',icon:'notebook',action:()=>{setNotes(true);close()}},{label:'Estudiar',icon:'study',action:()=>{setStudy(true);close()}},{label:'Escuchar',icon:'audio',action:()=>{if(e.nearby)void speakInstant(e.nearby.slice(0,2200),e.settings.ttsRate);close()}},{label:'Apariencia',icon:'appearance',action:()=>{setPrefs(true);close()}},{label:'Tutor IA',icon:'tutor',action:()=>{setTutor(true);close()}}
  ]
  return <div className={`reader-shell reader-minimal theme-${e.settings.theme} ${highlightMenu?'highlight-sheet-open':''}`}>
    <ReaderControls open={controls} onToggle={()=>setControls(v=>!v)} items={items}/>
    <div ref={e.stage} className="reader-stage"><button className="tap-zone left" aria-label="Página anterior" onClick={x=>{x.stopPropagation();void e.navigatePage('prev')}}/><div ref={e.host} className="epub-viewer"/><button className="tap-zone right" aria-label="Página siguiente" onClick={x=>{x.stopPropagation();void e.navigatePage('next')}}/></div>
    {!highlightMenu&&<ReaderProgress progress={e.progress} chapter={e.chapter} location={e.location}/>} 

    {e.selectedText&&!tutor&&<>
      {!highlightMenu&&<motion.div className="selection-actions selection-actions-icons" initial={{scale:.94,opacity:0,y:8}} animate={{scale:1,opacity:1,y:0}} transition={{type:'spring',stiffness:430,damping:30}}>
        <motion.button aria-label="Resaltar texto" title="Resaltar" onClick={()=>setHighlightMenu(true)} whileTap={{scale:.86}}><SelectionActionIcon name="highlight"/></motion.button>
        <motion.button aria-label="Preguntar al Tutor IA" title="Preguntar al Tutor" onClick={()=>setTutor(true)} whileTap={{scale:.86}}><SelectionActionIcon name="question"/></motion.button>
        <motion.button aria-label="Escuchar texto seleccionado" title="Escuchar" onClick={()=>speakInstant(e.selectedText,e.settings.ttsRate)} whileTap={{scale:.86}}><SelectionActionIcon name="audio"/></motion.button>
        <motion.button aria-label="Añadir nota" title="Nota" onClick={()=>void addNote()} whileTap={{scale:.86}}><SelectionActionIcon name="note"/></motion.button>
        <motion.button aria-label="Cerrar acciones" title="Cerrar" onClick={()=>{e.clearSelection();setHighlightMenu(false)}} whileTap={{scale:.86}}><SelectionActionIcon name="close"/></motion.button>
      </motion.div>}
      <AnimatePresence>{highlightMenu&&<>
        <motion.button className="highlight-sheet-backdrop" aria-label="Cerrar resaltado" onClick={()=>setHighlightMenu(false)} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}/>
        <motion.section className="highlight-palette highlight-bottom-sheet" initial={{y:'100%',opacity:.98}} animate={{y:0,opacity:1}} exit={{y:'100%',opacity:.98}} transition={{type:'spring',stiffness:360,damping:34,mass:.8}}>
          <div className="highlight-sheet-grabber" aria-hidden="true"/>
          <header><div><strong>Resaltado</strong><span>Color, intensidad y tipo</span></div><button aria-label="Cerrar paleta de resaltado" onClick={()=>setHighlightMenu(false)}>×</button></header>
          <div className="highlight-colors">{COLORS.map(c=><button key={c} aria-label={`Color ${c}`} className={color===c?'active':''} style={{background:c}} onClick={()=>setColor(c)}/>)}<label className="custom-color" title="Color personalizado"><input aria-label="Elegir color personalizado" type="color" value={color} onChange={x=>setColor(x.target.value)}/><span>＋</span></label></div>
          <label className="highlight-opacity"><span>Intensidad <b>{Math.round(opacity*100)}%</b></span><input type="range" min="20" max="90" step="5" value={Math.round(opacity*100)} onChange={x=>setOpacity(Number(x.target.value)/100)}/></label>
          <div className="highlight-categories">{(Object.keys(LABELS) as HighlightCategory[]).map(c=><button key={c} className={category===c?'active':''} onClick={()=>setCategory(c)}>{LABELS[c]}</button>)}</div>
          <button className="apply-highlight" onClick={()=>{void e.saveHighlight(category,color,opacity);setHighlightMenu(false)}}>Aplicar resaltado</button>
        </motion.section>
      </>}</AnimatePresence>
    </>}

    <NavigationPanel open={nav} onClose={()=>setNav(false)} toc={e.toc} bookId={bookRecord.id} progress={e.progress} strictSpoilers={e.settings.spoilerPolicy==='strict'} onNavigate={x=>{void e.rendition.current?.display(x);setNav(false)}}/>
    <NotebookPanel open={notes} onClose={()=>setNotes(false)} bookId={bookRecord.id} onNavigateHighlight={x=>{void e.rendition.current?.display(x);setNotes(false)}}/>
    <StudyPanel open={study} onClose={()=>setStudy(false)} context={e.context}/>
    <SettingsPanel open={prefs} onClose={()=>setPrefs(false)} settings={e.settings} onChange={e.setSettings} bookType={bookRecord.type} onBookType={type=>void db.books.update(bookRecord.id,{type})}/>
    <TutorPanel open={tutor} onClose={()=>setTutor(false)} context={e.context}/>
    <ReadingHistoryPanel open={history} onClose={()=>setHistory(false)} book={{...bookRecord,progress:e.progress}} context={e.context}/>
    <AnimatePresence>{e.limit&&<motion.div className="session-limit-notice" initial={{y:25,opacity:0}} animate={{y:0,opacity:1}}><div><strong>Límite de sesión alcanzado</strong><p>Llevas aproximadamente {e.minutes} min. Puedes descansar o continuar.</p></div><button onClick={()=>e.setLimit(false)}>Seguir leyendo</button><button onClick={onBack}>Terminar</button></motion.div>}</AnimatePresence>
  </div>
}
